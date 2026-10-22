// Optional public client metadata; never use this value for authorization.
export function clientVersion(request: Request): string | null {
  const value = request.headers.get("X-Relay-Client-Version")?.trim();
  return value &&
    value.length <= 64 &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : null;
}
