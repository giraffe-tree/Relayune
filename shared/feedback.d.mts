export const MAX_FEEDBACK_IMAGES: number;
export const MAX_FEEDBACK_IMAGE_BYTES: number;
export const MAX_FEEDBACK_REQUEST_BYTES: number;
export function feedbackEmailValid(value: string): boolean;
export interface FeedbackImage { mime_type: 'image/jpeg'; data: string; }
export interface FeedbackSubmission {
  id: string;
  category: 'bug' | 'suggestion';
  description: string;
  environment: { app_version: string; device_model: string; os_version: string };
  client: 'desktop' | 'mobile';
  contact: { email: string; wechat: string };
  images: FeedbackImage[];
}
export function parseFeedback(value: unknown): FeedbackSubmission | null;
