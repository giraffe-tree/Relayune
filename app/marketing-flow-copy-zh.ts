// Keep this locale separate so public entries download only their own flow copy.
export const zhMarketingFlowCopy = {
  intro: "在电脑安装 Relayune，用邮箱登录，再用电脑显示的 8 位码授权浏览器或手机。登录账户后，每个新客户端仍需单独授权。",
  accent: "接着完成手上的任务。",
  security: "任务内容只在你的电脑和已授权的客户端解密。Relayune 服务器无法读取任务内容或连接码，只处理邮箱和连接所需的信息。",
  steps: ["桌面端会发现电脑上的 Codex、Kimi Code 与 Claude Code 任务。", "用邮箱登录，将桌面端与账户关联。完成后返回 Relayune。", "在浏览器或手机客户端输入电脑显示的 8 位码，单独授权这个客户端；也可扫码连接。"],
} as const;
