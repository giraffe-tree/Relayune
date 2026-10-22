import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { createServer } from "node:net";
import { createServer as createTlsServer, createSecureContext, TLSSocket } from "node:tls";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("邮箱验证后设置密码，再使用密码登录", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-auth-"));
  const capture = join(temporary, "mail.txt");
  const sendmail = join(temporary, "sendmail");
  try {
    await writeFile(
      sendmail,
      `#!/bin/sh\n/usr/bin/tee '${capture}' >/dev/null\n`,
      "utf8",
    );
    await chmod(sendmail, 0o700);
    const bundle = join(temporary, "email-auth.cjs");
    await build({
      entryPoints: ["server/email-auth.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: bundle,
      logLevel: "silent",
    });
    const { EmailAuth, EMAIL_LOCALES, emailLocale, magicLinkEmail } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    assert.deepEqual(EMAIL_LOCALES, [
      "en", "zh-CN", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur",
    ]);
    assert.equal(emailLocale("pt-BR"), "pt");
    assert.equal(emailLocale(undefined, "de;q=0.9, ar;q=0.8, es;q=0.7"), "ar");
    assert.equal(emailLocale(undefined, "ur-PK, en;q=0.5"), "ur");
    assert.equal(emailLocale("zh-Hans-CN"), "zh-CN");
    assert.equal(emailLocale("zh-Hant-TW"), "en");
    assert.equal(emailLocale(undefined, "zh-TW, fr-FR;q=0.8"), "fr");
    assert.equal(emailLocale(undefined, "ar;q=0., fr;q=1."), "fr");
    assert.equal(emailLocale(undefined, "ar;q=0.1234, es;q=0.8"), "es");
    for (const locale of EMAIL_LOCALES) {
      const localized = magicLinkEmail({
        locale,
        link: "https://relay.test/api/auth/verify?token=test",
        expiresMinutes: 10,
      });
      assert.ok(localized.subject.trim(), `${locale} subject`);
      assert.match(localized.text, /Relayune/);
      assert.match(localized.html, new RegExp(`<html lang="${locale}" dir="`));
      assert.doesNotMatch(localized.html, /undefined|null/);
    }
    assert.match(
      magicLinkEmail({
        locale: "ar",
        link: "https://relay.test/api/auth/verify?token=test",
        expiresMinutes: 10,
      }).html,
      /<html lang="ar" dir="rtl">/,
    );
    const database = new AuthDatabase();
    const auth = new EmailAuth(database, {
      publicOrigin: "https://relay.test",
      mailFrom: "relay@example.com",
      sendmailPath: sendmail,
    });
    const email = "new-user@qq.com";
    const password = "relay-test-password";
    const pairingId = `pair_${"A".repeat(43)}`;

    const initialStatus = new CapturedResponse();
    assert.equal(
      await auth.handle(
        jsonRequest("/api/auth/email-status", { email }),
        initialStatus,
      ),
      true,
    );
    assert.deepEqual(JSON.parse(initialStatus.body), {
      next_action: "password",
    });

    const request = jsonRequest("/api/auth/magic-link", {
      email,
      pairing_id: pairingId,
      locale: "zh-CN",
    });
    const response = new CapturedResponse();
    assert.equal(await auth.handle(request, response), true);
    assert.equal(response.status, 202);
    assert.equal(
      database.documents("auth_magic_links")[0].pairing_id,
      pairingId,
    );

    const mail = await readFile(capture, "utf8");
    const [plainText, html] = decodeMimeBodies(mail);
    assert.match(mail, /Content-Type: multipart\/alternative/);
    assert.equal(decodeMimeSubject(mail), "验证邮箱并继续使用 Relayune");
    assert.match(plainText, /验证你的邮箱/);
    assert.match(plainText, /10 分钟后失效/);
    assert.match(html, /<html lang="zh-CN" dir="ltr">/);
    assert.match(html, />验证邮箱<\/a>/);
    assert.match(html, /绝不会通过邮件向你索要密码或 8 位连接码/);
    const magicUrl = plainText.match(
      /https:\/\/relay\.test\/api\/auth\/verify\?token=[A-Za-z0-9_-]+/,
    )?.[0];
    assert.ok(magicUrl, "sendmail should receive the one-time URL");
    const verify = requestFor(
      new URL(magicUrl).pathname + new URL(magicUrl).search,
    );
    const verified = new CapturedResponse();
    assert.equal(await auth.handle(verify, verified), true);
    assert.equal(verified.status, 303);
    assert.equal(
      verified.headers.Location,
      `/?auth=set-password&pair=${pairingId}`,
    );
    assert.match(verified.headers["Set-Cookie"], /^relay_setup=/);
    assert.equal(
      database.documents("auth_magic_links")[0].used_at instanceof Date,
      true,
    );
    assert.equal(database.documents("auth_sessions").length, 0);
    assert.equal(database.documents("auth_setup_sessions").length, 1);

    const setupCookie = verified.headers["Set-Cookie"].split(";", 1)[0];
    const setPassword = new CapturedResponse();
    assert.equal(
      await auth.handle(
        jsonRequest(
          "/api/auth/set-password",
          { password },
          { cookie: setupCookie },
        ),
        setPassword,
      ),
      true,
    );
    assert.equal(setPassword.status, 200);
    assert.equal(JSON.parse(setPassword.body).authenticated, true);
    assert.equal(Array.isArray(setPassword.headers["Set-Cookie"]), true);
    const user = database.documents("auth_users")[0];
    assert.equal(user.email, email);
    assert.equal(user.password_algorithm, "scrypt-v1");
    assert.doesNotMatch(JSON.stringify(user), /trial_|access_expires_at|entitlement|referral|redeemed_code/);
    assert.notEqual(user.password_hash, password);
    assert.doesNotMatch(JSON.stringify(user), new RegExp(password));

    const registeredStatus = new CapturedResponse();
    await auth.handle(
      jsonRequest("/api/auth/email-status", { email }),
      registeredStatus,
    );
    assert.deepEqual(JSON.parse(registeredStatus.body), {
      next_action: "password",
    });

    const rejected = new CapturedResponse();
    await auth.handle(
      jsonRequest("/api/auth/password", {
        email,
        password: "incorrect-password",
        pairing_id: pairingId,
      }),
      rejected,
    );
    assert.equal(rejected.status, 401);
    assert.equal(JSON.parse(rejected.body).error.code, "invalid_credentials");

    const loggedIn = new CapturedResponse();
    await auth.handle(
      jsonRequest("/api/auth/password", {
        email,
        password,
        pairing_id: pairingId,
      }),
      loggedIn,
    );
    assert.equal(loggedIn.status, 200);
    assert.match(loggedIn.headers["Set-Cookie"], /^relay_session=/);
    assert.equal(database.documents("auth_sessions").length, 2);

    const secondEmail = "another-user@163.com";
    const secondStatus = new CapturedResponse();
    await auth.handle(
      jsonRequest("/api/auth/email-status", { email: secondEmail }),
      secondStatus,
    );
    assert.deepEqual(JSON.parse(secondStatus.body), {
      next_action: "password",
    });
    const secondDelivery = new CapturedResponse();
    await auth.handle(
      jsonRequest(
        "/api/auth/magic-link",
        { email: secondEmail, locale: "en", return_to: "/account/" },
        {
          "x-real-ip": "203.0.113.7",
          "x-forwarded-for": "198.51.100.9",
        },
      ),
      secondDelivery,
    );
    assert.equal(secondDelivery.status, 202);
    const [englishText, englishHtml] = decodeMimeBodies(
      await readFile(capture, "utf8"),
    );
    assert.equal(
      decodeMimeSubject(await readFile(capture, "utf8")),
      "Verify your email to continue with Relayune",
    );
    assert.match(englishText, /Verify your email/);
    assert.match(englishText, /expires in 10 minutes/);
    assert.match(englishHtml, /<html lang="en" dir="ltr">/);
    assert.match(englishHtml, />Verify email<\/a>/);
    assert.match(englishHtml, /never ask for your password or 8-character connection code/);
    const secondLink = database.documents("auth_magic_links").at(-1);
    assert.equal(secondLink.email, secondEmail);
    assert.equal(secondLink.return_to, "/account/");
    assert.equal(
      secondLink.request_ip_hash,
      createHash("sha256").update("203.0.113.7").digest("hex"),
    );
    const accountMagicUrl = englishText.match(
      /https:\/\/relay\.test\/api\/auth\/verify\?token=[A-Za-z0-9_-]+/,
    )?.[0];
    assert.ok(accountMagicUrl);
    const accountVerified = new CapturedResponse();
    const accountUrl = new URL(accountMagicUrl);
    assert.equal(
      await auth.handle(
        requestFor(accountUrl.pathname + accountUrl.search),
        accountVerified,
      ),
      true,
    );
    assert.equal(accountVerified.status, 303);
    assert.equal(
      accountVerified.headers.Location,
      "/?auth=set-password&return_to=%2Faccount%2F",
    );
    await assert.rejects(
      auth.handle(
        jsonRequest("/api/auth/magic-link", {
          email,
          pairing_id: "pair_bad",
        }),
        new CapturedResponse(),
      ),
      (error) => error?.status === 400,
    );

    await assert.rejects(
      auth.handle(
        jsonRequest("/api/auth/magic-link", {
          email,
          return_to: "https://evil.test/",
        }),
        new CapturedResponse(),
      ),
      (error) => error?.status === 400,
    );

    const desktopLoginId = `dlogin_${"B".repeat(43)}`;
    const desktopDelivery = new CapturedResponse();
    assert.equal(
      await auth.handle(
        jsonRequest("/api/auth/magic-link", {
          email,
          desktop_login_id: desktopLoginId,
          locale: "zh-CN",
        }),
        desktopDelivery,
      ),
      true,
    );
    assert.equal(desktopDelivery.status, 202);
    const desktopLink = database.documents("auth_magic_links").at(-1);
    assert.equal(desktopLink.desktop_login_id, desktopLoginId);
    assert.equal(desktopLink.pairing_id, null);
    const desktopMail = await readFile(capture, "utf8");
    const [desktopText] = decodeMimeBodies(desktopMail);
    const desktopMagicUrl = desktopText.match(
      /https:\/\/relay\.test\/api\/auth\/verify\?token=[A-Za-z0-9_-]+/,
    )?.[0];
    assert.ok(desktopMagicUrl);
    const desktopVerified = new CapturedResponse();
    const desktopUrl = new URL(desktopMagicUrl);
    assert.equal(
      await auth.handle(
        requestFor(desktopUrl.pathname + desktopUrl.search),
        desktopVerified,
      ),
      true,
    );
    assert.equal(desktopVerified.status, 303);
    assert.equal(
      desktopVerified.headers.Location,
      `/?auth=set-password&desktop_login=${desktopLoginId}`,
    );
    assert.equal(
      database.documents("auth_setup_sessions").at(-1).desktop_login_id,
      desktopLoginId,
    );

    await assert.rejects(
      auth.handle(
        jsonRequest("/api/auth/magic-link", {
          email,
          pairing_id: pairingId,
          desktop_login_id: desktopLoginId,
        }),
        new CapturedResponse(),
      ),
      (error) => error?.status === 400,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function decodeMimeBodies(message) {
  const bodies = [...message.matchAll(
    /Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\n--relayune-/g,
  )].map((match) =>
    Buffer.from(match[1].replaceAll(/\s/g, ""), "base64").toString("utf8"),
  );
  assert.equal(bodies.length, 2, "email should contain plain-text and HTML bodies");
  return bodies;
}

function decodeMimeSubject(message) {
  const encoded = message.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=\r?$/m)?.[1];
  assert.ok(encoded, "email should contain an RFC 2047 UTF-8 subject");
  return Buffer.from(encoded, "base64").toString("utf8");
}

test("邮件失败只暴露稳定错误码并删除不可用链接", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-auth-"));
  try {
    const bundle = join(temporary, "email-auth.cjs");
    await build({
      entryPoints: ["server/email-auth.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: bundle,
      logLevel: "silent",
    });
    const { EmailAuth } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const database = new AuthDatabase();
    const auth = new EmailAuth(database, {
      publicOrigin: "https://relay.test",
      mailFrom: "relay@example.com",
      sendmailPath: "/bin/false",
    });

    await assert.rejects(
      auth.handle(
        jsonRequest("/api/auth/magic-link", { email: "user@163.com" }),
        new CapturedResponse(),
      ),
      (error) =>
        error?.status === 503 &&
        error?.code === "mail_delivery_failed" &&
        error?.message === "sendmail_transport_failed",
    );
    assert.equal(database.documents("auth_magic_links").length, 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

for (const mode of ["implicit", "starttls"]) test(`SMTP sends the generated multipart verification message through real ${mode} TLS`, async (t) => {
  const smtp = await smtpFixture(t, { mode });
  const { auth } = await smtpAuthFixture(t, smtp, { requireTls: mode === "starttls" });
  await auth.initialize();
  const response = new CapturedResponse();
  await auth.handle(jsonRequest("/api/auth/magic-link", {
    email: "smtp-user@example.test", locale: "en",
  }), response);
  assert.equal(response.status, 202);
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.messages[0], /Content-Type: multipart\/alternative/);
  assert.match(smtp.messages[0], /Content-Type: text\/plain/);
  assert.match(smtp.messages[0], /Content-Type: text\/html/);
  const decoded = smtp.messages[0].replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  assert.match(decoded, /https:\/\/relay\.test\/api\/auth\/verify\?token=/);
  assert.ok(smtp.commands.some((line) => line.startsWith("AUTH ")));
  assert.ok(smtp.encryptedCommands.some((line) => line.startsWith("AUTH ")), "authentication happens only inside TLS");
  assert.ok(smtp.commands.some((line) => /^RCPT TO:<smtp-user@example\.test>$/i.test(line)));
});

test("required SMTP TLS fails before authentication or message delivery when STARTTLS is refused", async (t) => {
  const smtp = await smtpFixture(t, { mode: "refuse" });
  const { auth } = await smtpAuthFixture(t, smtp, { requireTls: true });
  await assert.rejects(auth.initialize(), (error) => error?.code === "ETLS");
  assert.ok(smtp.commands.some((line) => line === "STARTTLS"));
  assert.ok(smtp.commands.every((line) => !/^(AUTH |MAIL FROM:|RCPT TO:)/i.test(line)));
  assert.equal(smtp.messages.length, 0);
});

test("SMTP transport blocks local and URL raw-message sources even when message policy tries to reopen access", async (t) => {
  const smtp = await smtpFixture(t);
  const { auth, temporary } = await smtpAuthFixture(t, smtp, { requireTls: false });
  const privateFixture = join(temporary, "private-fixture.txt");
  await writeFile(privateFixture, "synthetic-private-content");
  // TypeScript private is erased in the bundled test module. Exercise the actual
  // transport created by production EmailAuth with hostile future message data.
  for (const raw of [
    { path: privateFixture },
    { path: "http://127.0.0.1:1/fixture-must-not-be-fetched" },
  ]) {
    await assert.rejects(auth.smtpTransport.sendMail({
      from: "relay@example.test", to: "smtp-user@example.test", raw,
      disableFileAccess: false, disableUrlAccess: false,
    }), /(?:File|Url|URL|file|url) access rejected/i);
  }
  assert.equal(smtp.messages.length, 0);
  assert.equal(auth.smtpTransport.options.tls.rejectUnauthorized, true);
});

test("SMTP recipient rejection returns only the stable delivery error and removes the unusable link", async (t) => {
  const smtp = await smtpFixture(t, { rejectRecipient: true });
  const { auth, database } = await smtpAuthFixture(t, smtp, { requireTls: false });
  await assert.rejects(auth.handle(
    jsonRequest("/api/auth/magic-link", { email: "smtp-user@example.test" }),
    new CapturedResponse(),
  ), (error) => error?.status === 503 && error?.code === "mail_delivery_failed" && error?.message === "smtp_recipient_rejected");
  assert.equal(database.documents("auth_magic_links").length, 0);
  assert.equal(smtp.messages.length, 0);
});

test("SMTP configuration cannot disable both implicit TLS and STARTTLS", async t => {
  const smtp = await smtpFixture(t, { mode: "refuse" });
  await assert.rejects(smtpAuthFixture(t, smtp, { requireTls: false }), /SMTP requires implicit TLS or mandatory STARTTLS/);
  assert.equal(smtp.commands.length, 0);
});

test("self-hosted startup rejects plaintext SMTP configuration before database or mail connections", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-smtp-config-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let connections = 0;
  const trap = createServer(socket => { connections++; socket.destroy(); });
  await new Promise(resolve => trap.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => trap.close(resolve)));
  const bundle = join(temporary, "server.cjs");
  await build({ entryPoints: ["server/self-hosted.ts"], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent" });
  const child = spawn(process.execPath, [bundle], { env: {
    PATH: process.env.PATH, HOME: temporary, HOST: "127.0.0.1", PORT: "3192",
    PUBLIC_ORIGIN: "https://relay.test", RELAY_BLOB_DIR: join(temporary, "blobs"),
    MONGO_HOST: "127.0.0.1", MONGO_PORT: String(trap.address().port), MONGO_DATABASE: "isolated_smtp_test",
    MONGO_USER: "fixture", MONGO_PASSWORD: "synthetic-password", MAIL_FROM: "fixture@example.test",
    SMTP_HOST: "127.0.0.1", SMTP_PORT: String(trap.address().port), SMTP_SECURE: "false", SMTP_REQUIRE_TLS: "false",
    SMTP_USER: "fixture", SMTP_PASSWORD: "synthetic-password",
  }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  child.stdout.resume();
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(stderr, /SMTP requires implicit TLS or mandatory STARTTLS/);
  assert.equal(connections, 0);
});

test("SMTP rejects an untrusted certificate before authentication", async t => {
  const smtp = await smtpFixture(t);
  const { auth } = await smtpAuthFixture(t, smtp, { requireTls: false, trustCertificate: false });
  await assert.rejects(auth.initialize(), /self-signed|certificate/i);
  assert.ok(smtp.commands.every(line => !/^(AUTH |MAIL FROM:|RCPT TO:)/i.test(line)));
  assert.equal(smtp.messages.length, 0);
});

async function smtpAuthFixture(t, smtp, { requireTls, trustCertificate = true }) {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-smtp-fixture-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const bundle = join(temporary, "email-auth.cjs");
  await build({ entryPoints: ["server/email-auth.ts"], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent" });
  const { EmailAuth } = await import(pathToFileURL(bundle).href);
  const database = new AuthDatabase();
  const auth = new EmailAuth(database, {
    publicOrigin: "https://relay.test", mailFrom: "relay@example.test",
    smtp: { host: "127.0.0.1", port: smtp.port, secure: smtp.secure, requireTls, user: "fixture", password: "synthetic-password" },
  });
  // Trust only this ephemeral test certificate in this transport. Production
  // has no test injection or certificate bypass; rejectUnauthorized stays true.
  if (trustCertificate && smtp.certificate) auth.smtpTransport.transporter.options.tls.ca = smtp.certificate;
  t.after(() => auth.smtpTransport.close());
  return { auth, database, temporary };
}

async function smtpFixture(t, { rejectRecipient = false, mode = "implicit" } = {}) {
  const sockets = new Set();
  const fixture = { commands: [], encryptedCommands: [], messages: [], port: 0, secure: mode === "implicit", starttls: mode === "starttls" };
  let tlsOptions;
  if (mode !== "refuse") {
    const directory = await mkdtemp(join(tmpdir(), "relayune-smtp-tls-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
    const generated = spawnSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
    assert.equal(generated.status, 0, "OpenSSL must generate the ephemeral synthetic TLS certificate");
    await chmod(key, 0o600);
    tlsOptions = { key: await readFile(key), cert: await readFile(cert) };
    fixture.certificate = tlsOptions.cert;
  }
  const accept = (socket, encrypted = false, greeting = true) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    if (greeting) socket.write("220 fixture.example.test SMTP ready\r\n");
    let pending = "";
    let message = null;
    const onData = data => {
      pending += data.toString("utf8");
      let index;
      while ((index = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 2);
        if (message !== null) {
          if (line === ".") {
            fixture.messages.push(message.join("\r\n"));
            message = null;
            socket.write("250 accepted\r\n");
          } else message.push(line);
          continue;
        }
        fixture.commands.push(line);
        if (encrypted) fixture.encryptedCommands.push(line);
        if (/^EHLO |^HELO /i.test(line)) socket.write(`250-fixture.example.test\r\n${mode === "starttls" && !encrypted ? "250-STARTTLS\r\n" : ""}250 AUTH PLAIN\r\n`);
        else if (line === "STARTTLS") {
          if (mode !== "starttls" || encrypted) socket.write("454 TLS unavailable in fixture\r\n");
          else {
            socket.removeListener("data", onData);
            socket.write("220 begin TLS\r\n", () => {
              const secured = new TLSSocket(socket, { isServer: true, secureContext: createSecureContext(tlsOptions) });
              accept(secured, true, false);
            });
            return;
          }
        }
        else if (/^AUTH /i.test(line)) socket.write("235 authenticated\r\n");
        else if (/^MAIL FROM:/i.test(line)) socket.write("250 sender accepted\r\n");
        else if (/^RCPT TO:/i.test(line)) socket.write(rejectRecipient ? "550 recipient rejected\r\n" : "250 recipient accepted\r\n");
        else if (line === "DATA") { message = []; socket.write("354 end with dot\r\n"); }
        else if (line === "RSET") socket.write("250 reset\r\n");
        else if (line === "QUIT") socket.end("221 goodbye\r\n");
        else socket.write("500 unsupported fixture command\r\n");
      }
    };
    socket.on("data", onData);
  };
  const server = mode === "implicit" ? createTlsServer(tlsOptions, socket => accept(socket, true)) : createServer(socket => accept(socket));
  server.on("tlsClientError", () => {});
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  fixture.port = server.address().port;
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return fixture;
}

test("活跃会话按请求滑动续期，过期会话仍被拒绝", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-auth-"));
  try {
    const bundle = join(temporary, "email-auth.cjs");
    await build({
      entryPoints: ["server/email-auth.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: bundle,
      logLevel: "silent",
    });
    const { EmailAuth } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const database = new AuthDatabase();
    const auth = new EmailAuth(database, {
      publicOrigin: "https://relay.test",
      mailFrom: "relay@example.com",
      sendmailPath: "/bin/true",
    });
    const token = `tok_${"A".repeat(43)}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    database.documents("auth_users").push({
      _id: "desktop@example.com",
      email: "desktop@example.com",
    });
    database.documents("auth_sessions").push({
      token_hash: tokenHash,
      email: "desktop@example.com",
      created_at: new Date(),
      expires_at: new Date(Date.now() + 60 * 60_000),
      revoked_at: null,
    });
    const authenticated = () =>
      auth.authenticate(
        requestFor("/api/bootstrap", "", { cookie: `relay_session=${token}` }),
      );

    // 剩余不足阈值的活跃会话被续期约 60 天，用户无需重新登录
    assert.equal(await authenticated(), "desktop@example.com");
    const renewed = database.documents("auth_sessions")[0].expires_at;
    assert.ok(
      renewed.getTime() > Date.now() + 59 * 24 * 60 * 60_000,
      "临近过期的会话应被续期约 60 天",
    );

    // 剩余充足的会话不重复写库
    const fresh = new Date(Date.now() + 45 * 24 * 60 * 60_000);
    database.documents("auth_sessions")[0].expires_at = fresh;
    assert.equal(await authenticated(), "desktop@example.com");
    assert.equal(
      database.documents("auth_sessions")[0].expires_at.getTime(),
      fresh.getTime(),
    );

    // 已过期会话依然被拒绝
    database.documents("auth_sessions")[0].expires_at = new Date(
      Date.now() - 1_000,
    );
    assert.equal(await authenticated(), null);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

class AuthDatabase {
  collections = new Map();

  documents(name) {
    if (!this.collections.has(name)) this.collections.set(name, []);
    return this.collections.get(name);
  }

  collection(name) {
    const documents = this.documents(name);
    return {
      createIndex: async () => "test_index",
      countDocuments: async (filter = {}) =>
        documents.filter((document) => matches(document, filter)).length,
      findOne: async (filter) => {
        const document = documents.find((candidate) =>
          matches(candidate, filter),
        );
        return document ? structuredClone(document) : null;
      },
      insertOne: async (document) => {
        documents.push(structuredClone(document));
        return { acknowledged: true };
      },
      deleteOne: async (filter) => {
        const index = documents.findIndex((document) =>
          matches(document, filter),
        );
        if (index >= 0) documents.splice(index, 1);
      },
      deleteMany: async (filter) => {
        for (let index = documents.length - 1; index >= 0; index -= 1) {
          if (matches(documents[index], filter)) documents.splice(index, 1);
        }
      },
      updateOne: async (filter, update, options = {}) => {
        let document = documents.find((candidate) =>
          matches(candidate, filter),
        );
        if (!document && options.upsert) {
          document = {
            ...plainFilter(filter),
            ...(update.$setOnInsert || {}),
          };
          documents.push(document);
        }
        if (document) Object.assign(document, update.$set || {});
        return { acknowledged: true };
      },
      findOneAndUpdate: async (filter, update) => {
        const document = documents.find((candidate) =>
          matches(candidate, filter),
        );
        if (!document) return null;
        const before = structuredClone(document);
        Object.assign(document, update.$set || {});
        return before;
      },
    };
  }
}

class CapturedResponse {
  status = 0;
  headers = {};
  body = "";

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  end(content = "") {
    this.body += content;
  }
}

function jsonRequest(url, body, headers = {}) {
  return requestFor(url, JSON.stringify(body), {
    "content-type": "application/json",
    origin: "https://relay.test",
    ...headers,
  });
}

function requestFor(url, body = "", headers = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = body ? "POST" : "GET";
  request.url = url;
  request.headers = headers;
  request.socket = { remoteAddress: "127.0.0.1" };
  return request;
}

function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];
    if (
      expected &&
      typeof expected === "object" &&
      !(expected instanceof Date)
    ) {
      if ("$gt" in expected && !(actual > expected.$gt)) return false;
      if ("$gte" in expected && !(actual >= expected.$gte)) return false;
      return true;
    }
    return actual === expected;
  });
}

function plainFilter(filter) {
  return Object.fromEntries(
    Object.entries(filter).filter(
      ([, value]) =>
        !value || typeof value !== "object" || value instanceof Date,
    ),
  );
}
