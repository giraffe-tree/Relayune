import { MAX_FEEDBACK_IMAGE_BYTES, type FeedbackImage } from '../../shared/feedback.mjs';

export async function prepareFeedbackImage(file: File): Promise<FeedbackImage> {
  if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) throw new Error('feedback_invalid_image');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = source;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024) throw new Error('feedback_invalid_image');
  const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('feedback_invalid_image');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [.85, .7, .55, .4]) {
    const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (data && atob(data).length <= MAX_FEEDBACK_IMAGE_BYTES) return { mime_type: 'image/jpeg', data };
  }
  throw new Error('feedback_image_too_large');
}
