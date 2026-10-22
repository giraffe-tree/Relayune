export const MAX_FEEDBACK_IMAGES = 3;
export const MAX_FEEDBACK_IMAGE_BYTES = 1024 * 1024;
export const MAX_FEEDBACK_REQUEST_BYTES = 4 * 1024 * 1024 + 24000;
export const feedbackEmailValid = value => value === '' || (value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

// Only explicitly displayed fields, contact details and user-selected images.
export function parseFeedback(value) {
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  const required = ['id', 'category', 'description', 'environment', 'client'];
  if (!object(value) || !required.every(k => Object.hasOwn(value, k)) ||
      Object.keys(value).some(k => ![...required, 'contact', 'images'].includes(k)) ||
      typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id) ||
      !['bug', 'suggestion'].includes(value.category) || !['desktop', 'mobile'].includes(value.client) ||
      typeof value.description !== 'string' || !value.description.trim() ||
      new TextEncoder().encode(value.description).length > 8000 ||
      !exact(value.environment, ['app_version', 'device_model', 'os_version'])) return null;
  const environment = {};
  for (const key of ['app_version', 'device_model', 'os_version']) {
    const field = value.environment[key];
    if (typeof field !== 'string' || !field.trim() || field.length > 256) return null;
    environment[key] = field;
  }
  const contact = value.contact ?? { email: '', wechat: '' };
  if (!exact(contact, ['email', 'wechat']) || typeof contact.email !== 'string' ||
      typeof contact.wechat !== 'string' || !feedbackEmailValid(contact.email.trim()) ||
      contact.wechat.trim().length > 64 || /[\u0000-\u001f]/.test(contact.wechat)) return null;
  const images = value.images ?? [];
  if (!Array.isArray(images) || images.length > MAX_FEEDBACK_IMAGES) return null;
  const normalizedImages = [];
  for (const image of images) {
    if (!exact(image, ['mime_type', 'data']) || image.mime_type !== 'image/jpeg' ||
        typeof image.data !== 'string' || image.data.length > 4 * Math.ceil(MAX_FEEDBACK_IMAGE_BYTES / 3) ||
        !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image.data) || image.data.length % 4 !== 0) return null;
    const length = image.data.length * 3 / 4 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
    if (length > MAX_FEEDBACK_IMAGE_BYTES || length < 4) return null;
    normalizedImages.push({ mime_type: 'image/jpeg', data: image.data });
  }
  return { id: value.id, category: value.category, description: value.description.trim(), environment,
    client: value.client, contact: { email: contact.email.trim(), wechat: contact.wechat.trim() }, images: normalizedImages };
}
