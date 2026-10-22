// Keep this locale separate so public entries download only their own flow copy.
export const enMarketingFlowCopy = {
  intro: "Install Relayune on your computer, sign in with email, then authorize your browser or phone with the 8-character code on your computer. Each new client needs its own authorization after sign-in.",
  accent: "pick up the task in front of you.",
  security: "Task content is decrypted only on your computer and authorized clients. Relayune servers cannot read your tasks or connection codes; they handle your email and the information needed to connect.",
  steps: ["The desktop app finds Codex, Kimi Code, and Claude Code tasks on your computer.", "Sign in with email to link the desktop app to your account, then return to Relayune.", "Enter the 8-character code from your computer in your browser or mobile app to authorize that client separately. Scanning is an optional shortcut."],
} as const;
