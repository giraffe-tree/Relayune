# Security policy

## Report privately

Email [the maintainer](mailto:giraffetree1@gmail.com) with the subject
`Relayune security report`. Include affected versions, the attack prerequisites,
the expected and actual behavior, and a minimal reproduction using synthetic data.
Do not open a public issue containing exploit details, credentials, user data, pairing codes,
or session contents. Never send private keys or full Agent histories.

If the GitHub repository offers a **Report a vulnerability** button under its Security tab,
you may use that private reporting channel instead. Availability depends on repository settings;
email remains the documented fallback. See [GitHub's private reporting instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).

The maintainer will coordinate reproduction, fixes, and disclosure. No response-time or bounty
commitment is made. This policy does not authorize accessing other people's accounts or systems.

## Scope and support

Report issues in the current source and current official releases. Older releases may require
an upgrade rather than a backport; there is no promised long-term support branch.
Do not test against the official service or real user data without explicit permission.
Use a self-hosted loopback service and isolated synthetic accounts.

Relayune's SPAKE2 profile, browser/Desktop cryptographic stack, and mobile elliptic-curve
implementation have not completed an independent security or side-channel audit.
Passing test vectors, secret scans, integration tests, or an AI-assisted source review does not
establish that such an audit occurred. The current review and unresolved audit work are recorded
in [the cryptographic review](docs/crypto-security-review.md).
The supported guarantees and remaining metadata are documented in
[the threat model](docs/e2ee-threat-model.md) and [security constraints](docs/security-and-architecture.md).

Each client pairs independently. The server routes authenticated encrypted session payloads;
session keys and pairing codes must remain at endpoints. User-submitted feedback follows the
separate, explicitly readable feedback policy in the security constraints. Account authentication
credentials and routing metadata have separate rules; the server necessarily processes login
passwords and request bearer tokens in memory. Web clients also trust the server-delivered
JavaScript: a server that replaces that code can read plaintext at the browser endpoint.
The current protocol does not provide a per-message ratchet or forward secrecy against a later
client content-key compromise. These boundaries preclude a claim that all data passing through
the server is unconditionally inaccessible to it.

For an accidentally disclosed secret, revoke or rotate it with the provider first and contact
the maintainer privately. Removing a file or replacing repository history does not revoke a secret.
