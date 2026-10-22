import { createHash, randomUUID } from "node:crypto";

export function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashAction(action) {
  return `sha256:${createHash("sha256").update(canonicalJson(action)).digest("hex")}`;
}

