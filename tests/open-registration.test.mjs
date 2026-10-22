import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public registration has no runtime email allowlist", async () => {
  const [emailAuth, server, environment, productionVerifier, legal] =
    await Promise.all([
      readFile("server/email-auth.ts", "utf8"),
      readFile("server/self-hosted.ts", "utf8"),
      readFile(".env.mongo.example", "utf8"),
      readFile("scripts/verify-production-mongo-pake.mjs", "utf8"),
      readFile("app/legal/legal-content.tsx", "utf8"),
    ]);

  for (const source of [emailAuth, server, environment]) {
    assert.doesNotMatch(source, /RELAY_ALLOWED_EMAILS|allowedEmails/);
  }
  assert.match(productionVerifier, /required\("RELAY_WEB_EMAIL"\)/);
  assert.doesNotMatch(productionVerifier, /RELAY_ALLOWED_EMAILS/);
  assert.doesNotMatch(legal, /邀请制或邮箱白名单|invite-only|email-allowlisted/);
  assert.match(legal, /开放注册/);
});

test("account discovery stays opaque while registration remains actionable", async () => {
  const [emailAuth, workbench, language, mobileController, mobileScreen] =
    await Promise.all([
      readFile("server/email-auth.ts", "utf8"),
      readFile("app/workbench-page.tsx", "utf8"),
      readFile("app/auth-language.ts", "utf8"),
      readFile("mobile/lib/src/state/app_controller.dart", "utf8"),
      readFile("mobile/lib/src/ui/auth_screen.dart", "utf8"),
    ]);

  assert.match(
    emailAuth,
    /pathname === "\/api\/auth\/email-status"[\s\S]{0,260}requireEmail\(body\.email\)[\s\S]{0,120}next_action: "password"/,
  );
  assert.doesNotMatch(
    emailAuth.slice(
      emailAuth.indexOf('pathname === "/api/auth/email-status"'),
      emailAuth.indexOf('pathname === "/api/auth/password"'),
    ),
    /auth_users|hasPassword/,
  );
  assert.match(
    workbench,
    /next_action: "password"[\s\S]{0,320}setLoginState\("password"\)/,
  );
  assert.match(language, /首次使用或忘记密码？验证邮箱/);
  assert.match(language, /New here or forgot your password\? Verify email/);
  assert.match(
    mobileController,
    /if \(usernameLogin\) \{[\s\S]{0,650}\} else \{\s*await api\.emailStatus\(email\);\s*\}\s*loginStage = LoginStage\.password;/,
  );
  assert.match(mobileScreen, /context\.l10n\.authVerifyEmailAction/);
});

test("mail rate limits use the address supplied by the trusted reverse proxy", async () => {
  const emailAuth = await readFile("server/email-auth.ts", "utf8");
  const resolver = emailAuth.slice(
    emailAuth.indexOf("function clientAddress"),
    emailAuth.indexOf("function mailDeliveryError"),
  );

  assert.ok(
    resolver.indexOf('request.headers["x-real-ip"]') <
      resolver.indexOf('request.headers["x-forwarded-for"]'),
  );
  assert.match(resolver, /split\(","\)[\s\S]{0,80}\.at\(-1\)/);
});
