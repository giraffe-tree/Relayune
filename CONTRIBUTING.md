# Contributing to Relayune

Relayune is open source under the [MIT License](LICENSE).
Third-party components keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
The [publication checklist](docs/publication-checklist.md) records source checks and the boundaries of validation performed.

## Before opening a change

Read [AGENTS.md](AGENTS.md) and [the architecture and security constraints](docs/security-and-architecture.md).
Discuss changes to pairing, encryption, credential storage, public protocols, application identifiers,
or update trust before implementing them. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

Use Node.js 22.13 or newer and install the exact dependency versions with `npm ci`
and `npm ci --prefix desktop`. Follow [the README](README.md) and
[self-hosting notes](docs/self-hosting.md) for platform prerequisites and configuration.
Use synthetic accounts and isolated state. Do not run production verification, signing,
installation, notarization, or publication scripts as routine test commands.

## Pull requests

Use [GitHub Issues](https://github.com/giraffe-tree/Relayune/issues) for ordinary bugs and feature requests.
Maintenance is best effort, with no guaranteed response time. The first coordinated installer release
targets macOS, Android and iOS; Windows source remains available but is outside that release.
There is no current compatibility commitment for third-party client implementations.

Explain the user-visible problem, the resulting behavior, and the checks you actually ran.
Include a minimal reproduction for a bug. For UI changes, use synthetic content in screenshots.
Document untested platforms, external service requirements, and compatibility effects.

Typical checks are `npm run typecheck`, `npm run lint`, `npm test`, and
`npm --prefix desktop test`. Mobile changes also need `npm run mobile:check`.
The complete root Node fixture suite currently targets macOS/Linux (or WSL),
because some fixtures invoke POSIX shell tools. On native Windows, use the
TypeScript checks, Desktop unit tests, and `node --test tests/windows-desktop.test.mjs`;
the Windows workflow covers native compilation and installer lifecycle separately.
Choose additional integration or device checks based on the changed behavior;
fixtures and a successful build are not evidence of a full user journey.

Never include credentials, signing keys, account data, local Agent histories, personal paths,
runtime databases, or raw diagnostic logs. Keep lockfiles and third-party notices.
The publication scan described in the checklist checks the actual candidate files before upload.

## Contribution rights

Submit only work you have the right to contribute. Clearly identify third-party code and its
original license. Contributions to Relayune are offered under the repository's project license
unless a separately identified component has a different license. Contributors keep their copyright.
No copyright assignment is requested by this document. Maintainers and downstream users must
preserve the MIT notice and the applicable original notices of separately licensed components.

The Relayune name and logos identify the official project. Permission to use source code does not
authorize implying that a fork, service, or release is official. See [licensing notes](docs/licensing.md).
