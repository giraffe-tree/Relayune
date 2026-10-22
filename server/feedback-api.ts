import { markAuthenticatedDevice } from "./request-log.mjs";
import { createHash } from 'node:crypto';
import { decode, encode } from 'jpeg-js';
import type { Db } from 'mongodb';
import { parseFeedback, MAX_FEEDBACK_REQUEST_BYTES, MAX_FEEDBACK_IMAGE_BYTES, type FeedbackSubmission } from '../shared/feedback.mjs';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const fail = (status: number, code: string) => reply(status, { error: { code, message: code } });

export class FeedbackApi {
  constructor(private db: Db, private origin: string) {}
  async initialize() {
    await this.db.collection('relay_feedback').createIndex({ owner: 1, created_at: -1 });
    await this.db.collection('relay_feedback_limits').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  }
  async handle(request: Request, email: string | null): Promise<Response | null> {
    const pathname = new URL(request.url).pathname;
    if (pathname !== '/api/feedback') return null;
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
    let owner = email ? hash(`email:${email.toLowerCase()}`) : null;
    if (!owner && token) {
      const device = await this.db.collection('relay_devices').findOne({ relay_token_hash: hash(token), revoked_at: null });
      if (device) {
        owner = hash(`user:${device.user_id}`);
        await markAuthenticatedDevice(async () => (await this.db.collection('relay_users').findOne({ id: device.user_id }))?.email);
      }
    }
    if (!owner) return fail(401, 'feedback_sign_in_required');
    if (request.method !== 'POST') return fail(405, 'method_not_allowed');
    if (request.headers.get('origin') !== this.origin) return fail(403, 'invalid_origin');
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_FEEDBACK_REQUEST_BYTES) return fail(413, 'feedback_too_large');
    let value: unknown;
    try { value = JSON.parse(text); } catch { return fail(400, 'feedback_invalid'); }
    const submission = parseFeedback(value);
    if (!submission) return fail(400, 'feedback_invalid');
    const { id, ...feedback } = submission;
    const submissionHash = hash(JSON.stringify(submission));
    const collection = this.db.collection<Record<string, unknown> & { _id: string }>('relay_feedback');
    const existing = await collection.findOne({ _id: id });
    if (existing) return existing.owner === owner && sameFeedback(existing, submission, submissionHash)
      ? reply(200, { id }) : fail(409, 'feedback_conflict');
    // Atomic daily counter bounds feedback storage, including concurrent requests.
    const now = new Date();
    const limit = await this.db.collection<{ _id: string; count: number; expires_at: Date }>('relay_feedback_limits')
      .findOneAndUpdate({ _id: `${owner}:${now.toISOString().slice(0, 10)}` },
        { $inc: { count: 1 }, $setOnInsert: { expires_at: new Date(now.getTime() + 2 * 86400000) } },
        { upsert: true, returnDocument: 'after' });
    if (!limit || limit.count > 20) return fail(429, 'feedback_rate_limited');
    // Decode and re-encode before storage: reject disguised/corrupt images and strip metadata.
    try {
      feedback.images = submission.images.map(image => {
        const decoded = decode(Buffer.from(image.data, 'base64'), {
          maxResolutionInMP: 4.2, maxMemoryUsageInMB: 128, tolerantDecoding: false,
        });
        if (decoded.width > 2048 || decoded.height > 2048) throw new Error('invalid_image');
        // Reconstruct only pixels; never carry EXIF or JPEG comments into storage.
        const pixels = { width: decoded.width, height: decoded.height, data: decoded.data };
        for (const quality of [85, 70, 55, 40]) {
          const data = encode(pixels, quality).data;
          if (data.length <= MAX_FEEDBACK_IMAGE_BYTES) return { mime_type: 'image/jpeg' as const, data: data.toString('base64') };
        }
        throw new Error('invalid_image');
      });
    } catch { return fail(400, 'feedback_invalid_image'); }
    try {
      await collection.insertOne({ _id: id, owner, ...feedback, submission_hash: submissionHash, created_at: now });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const duplicate = await collection.findOne({ _id: id });
      if (duplicate?.owner !== owner || !sameFeedback(duplicate, submission, submissionHash))
        return fail(409, 'feedback_conflict');
    }
    return reply(201, { id });
  }
}


function sameFeedback(record: Record<string, unknown>, submission: FeedbackSubmission, submissionHash: string) {
  if (typeof record.submission_hash === "string") return record.submission_hash === submissionHash;
  const saved = parseFeedback({ id: record._id, category: record.category,
    description: record.description, environment: record.environment, client: record.client, contact: record.contact, images: record.images });
  return JSON.stringify(saved) === JSON.stringify(submission);
}
