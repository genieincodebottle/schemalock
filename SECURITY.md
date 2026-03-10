# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

Older versions will not receive security fixes. Always use the latest version.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** Public disclosure before a fix is available puts all users at risk.

### How to report

Email: **genieincodebottle@gmail.com**

Include in your report:
- A description of the vulnerability
- Steps to reproduce it
- The version of schemalock affected (`schemalock --version`)
- Your Node.js version (`node --version`)
- What impact you believe it has

### What to expect

- **Acknowledgement within 48 hours**
- **Status update within 7 days** (confirmed, investigating, or not a vulnerability)
- **Fix timeline** discussed with you before public disclosure
- **Credit in the CHANGELOG** if you want it (your choice)

We follow responsible disclosure - we will not take legal action against researchers who report vulnerabilities in good faith.

---

## Scope

### In scope

- Command injection via contract names, case IDs, or prompt file paths
- Path traversal allowing reads outside `~/.schemalock/`
- API key leakage (to stdout, log files, or error messages)
- SQLite injection via user-supplied contract names or case data
- YAML injection via contract save/load

### Out of scope

- Vulnerabilities in dependencies (report to the dependency maintainer; open a GitHub issue here to track it)
- API key security at the provider side (Anthropic, OpenAI, etc.)
- Issues requiring physical access to the machine
- Self-inflicted issues (user intentionally passing malicious input to their own CLI)

---

## Security Design Notes

schemalock stores data locally only (`~/.schemalock/`). It does not operate a server, collect telemetry, or phone home. The only network calls made are to the AI provider APIs you configure. Your API keys and test data never leave your machine except as part of normal API requests to providers you have chosen.

Key protections already in place:
- Contract names validated against `/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/` (prevents path traversal)
- Case IDs stripped of ANSI escape codes and control characters before display
- YAML saved with `CORE_SCHEMA` (prevents YAML code execution via crafted contracts)
- API keys masked in all CLI output (`schemalock config list-keys`)
- Non-HTTPS custom base URLs trigger a warning
