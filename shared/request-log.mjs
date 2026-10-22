import routes from './request-log-routes.json' with { type: 'json' };

const templates = new Set(routes.map(({ template }) => template));
const patterns = routes.map(({ pattern, template }) => ({ pattern: new RegExp(pattern), template }));
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']);

/** Only fixed, known labels may enter logs or monitoring dimensions. */
export function routeTemplate(value) {
  if (typeof value !== 'string' || value.length > 4096) return 'unmatched';
  const pathname = value.split(/[?#]/, 1)[0];
  if (templates.has(pathname)) return pathname;
  return patterns.find(({ pattern }) => pattern.test(pathname))?.template ?? 'unmatched';
}

export function requestMethod(value) {
  return methods.has(value) ? value : 'UNKNOWN';
}
