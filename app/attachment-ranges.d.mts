export const ATTACHMENT_PART_BYTES: number;
export const ATTACHMENT_MAX_BYTES: number;
export type AttachmentPart = {
  base64: string;
  mime_type: string;
  offset?: number;
  next_offset?: number;
  total_size?: number;
  has_more?: boolean;
  content_digest?: string;
};
export function readAttachmentRanges(readPart: (offset: number, maxBytes: number) => Promise<AttachmentPart>): Promise<{
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
}>;
