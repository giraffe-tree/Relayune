export type GroupConfig = { image: string; expiresAt: string; updatedAt: string };

export function parseGroupConfig(value: unknown): GroupConfig {
  const config = value as Partial<GroupConfig> | null;
  if (!config || typeof config.image !== "string" ||
      !/^\/community\/assets\/wechat-group-[a-zA-Z0-9-]+\.png$/.test(config.image) ||
      typeof config.expiresAt !== "string" || !Number.isFinite(Date.parse(config.expiresAt)) ||
      typeof config.updatedAt !== "string" || !Number.isFinite(Date.parse(config.updatedAt))) {
    throw new Error("Invalid community QR configuration");
  }
  return config as GroupConfig;
}
