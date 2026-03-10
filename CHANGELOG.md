# Changelog

All notable changes to schemalock will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Google Gemini support via OpenAI-compatible endpoint
- `GOOGLE_API_KEY` added to `.env.example` and `schemalock config list-keys`
- **Anthropic**: updated `claude-opus-4-6` pricing ($5/$25) and `claude-haiku-4-5` pricing ($1/$5)
- **OpenAI GPT-5 family**: `gpt-5` ($1.25/$10.00), `gpt-5-mini` ($0.25/$2.00), `gpt-5-nano` ($0.05/$0.40)
- **OpenAI GPT-4.1 family**: `gpt-4.1` ($2.00/$8.00), `gpt-4.1-mini` ($0.40/$1.60), `gpt-4.1-nano` ($0.10/$0.40)
- **OpenAI reasoning**: `o3` ($2.00/$8.00), `o4-mini` ($1.10/$4.40)
- **Google Gemini 2.5**: `gemini-2.5-pro` ($1.25/$10.00), `gemini-2.5-flash` ($0.30/$2.50)
- **Mistral**: updated `mistral-large-latest` pricing ($0.50/$1.50), added `mistral-medium-latest` ($0.40/$2.00) and `codestral-latest` ($0.30/$0.90)
- **Groq**: `meta-llama/llama-4-scout-17b-16e-instruct` ($0.11/$0.34)
- **Ollama**: `ollama/llama4`, `ollama/llama3.3`

---

## [0.1.0] - 2026-03-10

### Added
- `schemalock define <name>` - create output contracts with JSON Schema, required fields, banned phrases, and test cases
- `schemalock test <name>` - run contract tests against any LLM, exit code 0/1 for CI
- `schemalock diff <model1> <model2>` - compare two models on the same contract, find regressions
- `schemalock list` - list all contracts with last run status; `--models` flag shows all supported models with pricing
- `schemalock report <name>` - view test run history, full per-case detail with `--run <id>`
- `schemalock delete <name>` - delete a contract and optionally its test history
- `schemalock config` - manage API keys persistently in `~/.schemalock/.env`
  - `config set / get / delete / list-keys` - key management
  - `config update-pricing` - export editable pricing template to `~/.schemalock/models.json`
  - `config env` - show active paths and env var overrides
- Support for 21 models across 6 providers: Anthropic, OpenAI, Groq, Mistral, Ollama (local), and any OpenAI-compatible custom endpoint
- `--delay <ms>` flag on `test` and `diff` for rate limit avoidance
- `--base-url` and `--api-key` flags for custom/self-hosted endpoints
- `--output json` on `test` for machine-readable CI output
- `--threshold` on `test` for configurable pass rate (default 80%)
- `SCHEMALOCK_DB` env var for per-project database isolation
- User-editable pricing overrides via `~/.schemalock/models.json`
- Fail-fast after 3 consecutive API errors in `diff` (avoids runaway API spend)
- Case count guard: warns at 500 cases, hard-stops at 10,000
- ANSI injection protection on case IDs from untrusted input files
- Expected value type validation against JSON Schema (warns on impossible assertions)
- SQLite WAL mode with 30s busy timeout for concurrent CI safety
- Path traversal prevention on contract names (regex `/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/`)
- YAML CORE_SCHEMA on contract save (prevents YAML injection)
- Per-process warning deduplication for base URL and custom model notices

[0.1.0]: https://github.com/genieincodebottle/schemalock/releases/tag/v0.1.0
