# Relayune contributor instructions

## Scope and review

- Read this file and any more specific instructions before making changes.
- This repository is the primary source for Relayune. The maintainer has authorized
  local commits and the completed official 0.3.33 release. Keep credentials and
  private runtime state outside Git. Do not push or publish repository source
  until the maintainer explicitly authorizes that step. New release, upload,
  installation, or deployment work must stay within the current task authorization;
  routine source edits do not authorize those actions.
- Do not copy private repository history, internal research, or user data into
  publishable source. Credentials, signing material and runtime state must never
  enter Git or public artifacts. The maintainer-authorized local server configuration
  copy in ignored `.secrets/official/` is private: directories must be `0700`, files
  `0600`, and publication checks must continue to reject that path if staged.
- Public-source preparation status and remaining decisions are recorded in
  [the publication checklist](docs/publication-checklist.md).

## Architecture and security

- Read [the security and architecture constraints](docs/security-and-architecture.md)
  before changing the server, relay, login, pairing, encryption, or credential storage.
- Keep the self-hosted Node.js + MongoDB architecture. The server routes encrypted
  session payloads; pairing codes, content keys, and session plaintext must not
  enter server storage or logs. Explicitly submitted feedback has separate rules.
- Each client uses an independent PAKE authorization. Desktop credentials belong
  in the local encrypted vault, not platform credential managers or plain files.
- Never weaken authentication, encryption, signature verification, or authorization
  to make a development setup work.

## Development and validation

- Use Node.js >=22.13.0. Preserve lockfiles and third-party license notices.
- Choose checks based on the changed behavior. Distinguish static checks, fixtures,
  local integration tests, real agent execution, and user-journey acceptance.
- Never contact production services or use real user credentials for automated
  tests without explicit authorization. Use synthetic fixtures and isolated state.
- Do not install or launch a desktop/mobile application, change system settings,
  or run signing, notarization, deployment, store submission, or release scripts
  as a side effect of editing source or documentation.
- Existing official application identifiers, update public keys, domains, and
  copyright notices are not secrets. Changing them requires checking installation,
  update, storage, and protocol compatibility.
- A successful build or automated scan does not establish that source is safe to
  publish. Report unverified images, external-service dependencies, license
  decisions, and security-audit limitations explicitly.
