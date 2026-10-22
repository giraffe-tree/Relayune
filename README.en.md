# Relayune

[简体中文](README.md) | English

Relayune lets you continue AI coding tasks on your computer from a browser,
iPhone, iPad or Android phone. Agents run on the computer; the Web and mobile
clients display sessions, send instructions and handle approvals.

The project includes a **Node.js + MongoDB** server, a **Tauri Desktop** client
and a **Flutter Mobile** client. The initial coordinated release targets
**macOS, Android and iOS**, prioritizing Codex users in China and the complete
Codex, Claude Code and Kimi Code workflows. Windows source remains available,
but Windows installers are outside the initial release.

Project-owned code and assets use the [MIT License](LICENSE).
Copyright (c) 2026 Ernest Chen. Third-party components retain their original
licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and
[licensing notes](docs/licensing.md).

Username authentication, local first-run setup and runtime instance switching are implemented.
The 0.3.33 macOS and Android packages have passed signing and license checks and their
public files are uploaded. iOS is uploaded to Apple with `VALID_BINARY`; TestFlight
installability has not been checked. The production Web/API and public download entries
have completed their coordinated upgrade: macOS and Android are 0.3.33, with Android
build 43. The installed official Mac application connects to production with the original
account, client authorizations and working-directory preference retained.
Android has only limited sign-in/relaunch validation; pairing and task workflows remain
unverified. Remaining Android acceptance was cancelled and is not a release gate for this run.
See the [official release checklist](docs/official-deployment.md) for current delivery status
and the [release plan](docs/open-source-roadmap.md) for the overall scope. Most detailed
documentation is currently in Chinese.

The pre-publication source changes remove Feishu integration and patch dependencies and
legacy shared-key entry points. These source changes have not been shipped in new signed
clients or deployed to production; the existing live 0.3.33 release does not establish their validation.

## Using Relayune

The normal workflow is: **install on your computer → sign in and prepare an
Agent → connect your phone or browser → continue a task**.

### 1. Install the clients

Visit the [official website](https://relayune.giraffetree.cn) for current download
links. macOS and Android 0.3.33 downloads and Chinese/English release notes are published;
iOS availability remains subject to the unverified TestFlight status below.

| Device | Current installation path |
| --- | --- |
| Mac, macOS 13+ | Download the DMG and move Relayune to Applications. |
| Android | Download the APK from the official website and follow the system installation prompts. |
| iPhone / iPad | Use the Web client in Safari, or the TestFlight link when available. The initial native release will use public TestFlight testing before a later App Store release. |
| Browser | Open the website and connect to the computer running Relayune. |
| Windows | Build from source using the [Windows development guide](docs/windows-desktop-development.md); no initial public installer is planned. |

Your computer must also run Relayune. A phone client alone cannot run the Agents
installed on your computer.

### 2. Sign in and prepare an Agent

1. On your Mac, open Relayune and choose **Sign in to Relayune**.
2. Sign in using your email and password in the browser. New accounts first use
   the verification email to set a password and confirm the computer login.
3. Return to Relayune and grant access to the folders containing your projects.
4. Prepare at least one of Codex, Claude Code or Kimi Code. Use the Agent panel
   to check installation and sign-in status.
5. Choose a default Agent and working directory if needed.

Your Relayune account connects devices. Each Agent still requires its own account
and model access. The Windows source build uses a different initial short-code
connection flow; see the Desktop documentation.

### 3. Connect a phone or browser

1. On the computer, choose **Connect device**, select the phone/tablet or browser
   option, and keep the eight-digit code visible.
2. Sign in to the same Relayune account on the phone or browser.
3. In the mobile app, scan the QR code or enter the code manually. In the Web
   client, follow the pairing instructions and enter the code.
4. Wait until the computer appears connected and the workbench opens.

Each client receives an independent authorization. Pair new devices and browsers
separately. Generate a new code if it expires, and never publish pairing codes or
QR codes in screenshots.

### 4. Continue a task

- Select an online computer, project and session to view history and new output.
- Create a session where supported, choose a working directory and send a task.
- Review commands and other requested actions before approving or rejecting them.
- Use the stop action to interrupt a task. Prioritize foreground use; background
  notification delivery depends on platform and provider setup and is not guaranteed.

Keep the computer online, awake and running Relayune. Closing the window may
leave the tray or menu bar process running; quitting the application or putting
the computer to sleep prevents new local work. Cached history may remain readable.
Devices do not need to share Wi-Fi when both can reach the same Relayune service.

### 5. Manage access and troubleshoot

Revoke an individual phone or browser from the computer's **Manage devices** list.
Other clients keep their own authorizations. Sign out from the Desktop client to
end its account session.

For connection failures, check whether the computer is awake, Relayune is running,
and the selected Agent is signed in. For file access failures, check the working
directory and folder permissions. Use **Help and diagnostics** for connection status.

## Architecture and security

The server manages accounts, device routing and bounded encrypted forwarding.
Session plaintext and client content keys stay at the clients and the Desktop
Relay. Each client pairs independently using the eight-digit-code PAKE flow.
Desktop credentials are kept in its encrypted local vault.

Account and routing metadata are not session ciphertext. Feedback submitted
explicitly by the user follows separate readable-data rules. See the
[security constraints](docs/security-and-architecture.md) and
[encryption threat model](docs/e2ee-threat-model.md).

Session confidentiality does not make all server data unreadable: account authentication,
routing metadata and deliberately submitted feedback have separate rules. Web clients trust
server-delivered JavaScript, so a server that replaces it can read plaintext in the browser.
The current protocol does not promise forward secrecy. A professional independent cryptographic
and side-channel audit remains incomplete; the [source review](docs/crypto-security-review.md)
is not a substitute for that audit.

## Development

Use Node.js **>=22.13.0** and install locked dependencies:

```bash
npm ci
npm ci --prefix desktop
npm run dev
```

`npm run dev` starts the Web frontend only; configure the API server separately.
The root TypeScript checks include Desktop source, so Web/Server builds also
require the Desktop dependencies. Use synthetic data and isolated state for tests.

Desktop development requires Rust and the platform's Tauri prerequisites.
Mobile development requires Flutter and the platform SDKs. Follow the
[Desktop](desktop/README.md) and [Mobile](mobile/README.md) guides.
macOS contributors can build an isolated ad-hoc development application without
the maintainer's Developer ID:

```bash
npm --prefix desktop run desktop:build:macos:adhoc
```

Development and official release identities, storage and update trust are separate.
Do not export Desktop vault credentials into plaintext for a manual Relay launch.

## Self-hosting

Username mode requires MongoDB and an HTTPS endpoint, without SMTP.
The operator chooses the initial administrator password locally. The preparation tool
generates a private CA and IP certificate for your VPN or public address; clients
still explicitly verify and trust the certificate. Official email mode remains
available with its own mail configuration and separate database. Start with [.env.mongo.example](.env.mongo.example)
and the [self-hosting guide](docs/self-hosting.md), then build:

```bash
npm run build:self-hosted
```

The outputs are `dist/self-hosted/` for static hosting and
`dist/self-hosted-server/server.cjs` for the API, started with `npm start`.
The API and MongoDB bind to loopback by default. Inject environment variables
through your process manager; `npm start` does not load the example environment
file. Store passwords in restricted files outside the repository and never expose
the private encrypted blob directory as static content.

Desktop and mobile clients now select the instance at runtime. A confirmed switch
clears the previous credentials and pairing state and requires fresh sign-in and pairing.
Self-hosted core operation does not require Relayune official services; automatic
official push and update access is disabled for custom instances. Native package
checks and iOS simulator acceptance are recorded separately from unverified real-phone
behavior and private-CA trust onboarding on other platforms. See the
[plan and acceptance criteria](docs/open-source-roadmap.md).

## Checks and publication boundaries

```bash
npm run typecheck
npm run lint
npm test
npm run desktop:check
npm run desktop:test
npm run mobile:check
```

The full root Node fixture suite targets macOS/Linux or WSL; some fixtures use
POSIX shell tools. Native Windows checks are documented separately.

Before publishing, inspect the actual Git candidates and staged blobs:

```bash
node scripts/install-gitleaks.mjs
GITLEAKS_BIN="$PWD/.public-prep/tools/gitleaks" npm run audit:publication -- --secrets
```

Do not upload the whole working directory. Keep credentials, signing keys, runtime
data, logs and local Agent history outside public candidates. Client-side build
variables are public and must never contain server secrets.

Builds and scans cover only their tested scope. Real devices, independent deployment,
native-package licenses and independent cryptographic review have separate
acceptance requirements. Read the [publication checklist](docs/publication-checklist.md)
and [dependency security notes](docs/dependency-security.md).

## Support and contributions

Use [GitHub Issues](https://github.com/giraffe-tree/Relayune/issues) for ordinary
bugs and suggestions. Maintenance is best effort, without a guaranteed response
time. There is no current third-party client protocol compatibility commitment.

See the [contribution guide](CONTRIBUTING.md) and [documentation index](docs/README.md).
Report vulnerabilities or exposed credentials privately using [SECURITY.md](SECURITY.md).
Use synthetic content in public reproductions and screenshots.
