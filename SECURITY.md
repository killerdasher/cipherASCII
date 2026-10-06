# Security policy

## Supported versions

cipherASCII is pre-1.0; security fixes land on `main` and ship with the next
tagged release.

| Version | Supported |
| --- | --- |
| latest release | yes |
| older releases | best effort |

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

- Use GitHub's private reporting: **Security → Report a vulnerability** on this
  repository, or
- Email the maintainer through the contact on
  [github.com/killerdasher](https://github.com/killerdasher).

Include the affected version/commit, reproduction steps, impact, and any known
workarounds. You should get an acknowledgement within a few days and a fix or
public disclosure timeline once the issue is confirmed.

## Threat model notes

cipherASCII runs locally: files you open, export and save never leave your
machine. The attack surface worth reporting includes:

- Path traversal or arbitrary file write in the import/export and
  project-serialization code (`src/core/export`, `src/core/project`).
- Code execution through malformed project files (`.aap` / `.json`) or
  crafted images decoded in the render worker.
- The Electron shell: renderer sandbox escape, missing `contextIsolation`
  hardening, or `shell.openExternal` / protocol-handler misuse
  (`electron/main.ts`).
- ffmpeg.wasm invocation: command-line arguments built from untrusted
  project data (`src/core/export`, `src/services`).

Out of scope: denial of service via very large images (there are size limits),
and issues that require a compromised OS account.
