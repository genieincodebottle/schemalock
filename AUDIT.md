# schemalock - Audit & Change Tracking

## v0.1.0 - Initial Release Audit (2026-03-10)

### Summary
Full pre-publish audit conducted before npm release. Identified and fixed **31 issues** across 13 files.
Severity breakdown: 2 CRITICAL, 8 HIGH, 12 MEDIUM, 6 LOW, 3 PRE-PUBLISH.

---

## CRITICAL (Would cause silent wrong results or crashes)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| C1 | `src/commands/test.js` | Test cases with `expected` values that contradict the JSON Schema type would always fail with no explanation - false security (tests pass schema but expected values are wrong type) | Added `validateExpected(cases, contract)` in `validator.js` that checks expected value types against schema property definitions. Prints warnings at test start, not errors - expected is often a partial subset |
| C2 | `src/core/store.js` | `busy_timeout` was 5000ms - concurrent CI runs on same DB would get `SQLITE_BUSY` errors and silently drop test results | Increased to 30000ms. Added SQLITE_BUSY-specific error message with `SCHEMALOCK_DB` override hint |

---

## HIGH (Bad UX, data loss, or security gaps)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| H1 | `src/commands/define.js` | System prompt stored as relative path. If user ran `schemalock test` from a different directory, the prompt file would not be found | Changed to `resolve(options.prompt)` - stores absolute path via Node `path.resolve()` |
| H2 | `src/commands/define.js`, `test.js`, `diff.js` | Case IDs loaded from user-supplied JSON files were passed directly to terminal output without sanitization - ANSI escape code injection possible (could corrupt terminal, spoof output) | Added `sanitizeCaseId()` in `src/utils/cases.js` - strips ANSI codes and control characters, truncates to 100 chars. Applied in define, test, and diff |
| H3 | `src/utils/models.js` | Pricing was hardcoded with no way to update when providers change rates | Added `loadPricingOverrides()` - reads `~/.schemalock/models.json` and merges over base pricing. Added `schemalock config update-pricing` command to create editable template |
| H4 | `src/core/runner.js` | Unknown custom models (via `--base-url`) showed `$0` cost with no explanation - users thought testing was free when estimates were just unavailable | Added `_isCustom` flag on getModel() return. Emits one-time warning per model: "unknown model - cost estimates will show $0" |
| H5 | `src/utils/config.js` | All users shared `~/.schemalock/results.db` globally - running two different projects' tests would mix history. CI jobs for different repos would interfere | Added `SCHEMALOCK_DB` env var override. Added `export const DB_PATH` for consistent use across store.js and config command |
| H6 | (missing command) | No way to delete a contract or its test history - users would need to manually rm YAML files and hack the SQLite DB | Created `src/commands/delete.js` with `--yes` (CI skip prompt) and `--keep-history` flags. Added `deleteContract()` to contracts.js and `deleteRunsByContract()` to store.js |
| H7 | `src/core/validator.js` | AJV errors showed only rule name and path (e.g. "type mismatch at /total_amount") with no indication of what the actual value was | Added `formatAjvError(err, parsed)` - walks the parsed object to extract the actual failing value: `"total_amount must be number (got: "100")"` |
| H8 | `src/commands/diff.js` | No fail-fast - if API key was wrong or provider was down, diff would hammer the API for all N cases on both models before reporting the error | Added `consecutiveErrors` counter with `FAIL_FAST_THRESHOLD = 3`. After 3 consecutive API errors per model, stops and fills remaining cases as errors |

---

## MEDIUM (Functional gaps or confusing behavior)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| M1 | `src/cli.js` | `--version` was hardcoded as a string literal - would go stale after version bumps | Changed to `createRequire(import.meta.url)` to read version dynamically from `package.json` |
| M2 | `src/commands/test.js`, `diff.js` | No rate limiting between API calls - providers like Groq have strict RPM limits, would get 429 errors on larger test suites | Added `--delay <ms>` option to both commands. `sleep()` called between calls (not before first call) |
| M3 | `src/core/runner.js`, `src/utils/models.js` | `--base-url` accepted any URL including plain HTTP - sending API keys over HTTP silently | Added `validateBaseUrl(url)` in models.js - warns on non-HTTPS non-localhost endpoints. Warning fires once per unique URL per process (deduped) |
| M4 | `src/commands/diff.js` | Disagreements loop used filtered-array index for auto-generated case IDs (`case-1`, `case-2`) instead of original index - IDs shifted after filtering, pointing to wrong cases | Fixed: `.map((c, originalIdx) => ({ ...c, _originalIdx: originalIdx }))` before `.filter()`, then `c.id \|\| 'case-${c._originalIdx + 1}'` in the loop |
| M5 | `src/commands/diff.js` | Missing `--base-url`, `--api-key`, `--prompt`, `--cases` options - could not test custom endpoints or override prompts for diff runs | Added all four options, matching test command parity |
| M6 | `src/utils/cases.js` | No guard against runaway test suites - loading a 50,000-case file would silently run and cost hundreds of dollars | Added `checkCaseCount()`: warns at 500 cases, hard-stops at 10,000. Applied in both test and diff commands |
| M7 | Multiple commands | `console.log` used for error messages - errors went to stdout, breaking `--output json` pipelines and `2>` redirection | Changed all error output to `console.error` in define, test, diff, list, report |
| M8 | `src/commands/list.js`, `diff.js`, `report.js` | Chalk ANSI padding bug: `chalk.cyan(str).padEnd(n)` counts ANSI escape codes as visible chars, misaligning table columns | Fixed to pad raw string first then colorize: `chalk.cyan(str.padEnd(n))` or `const raw = str.padEnd(n); chalk.green(raw)` |
| M9 | `src/commands/define.js` | `--cases` file loaded with no structural validation - missing `input` field or wrong types would only fail at test runtime | Added `validateCaseStructure(cases)` in cases.js - requires non-empty string `input` field per case. Applied in define, test, and diff |
| M10 | `src/commands/test.js`, `diff.js` | No existence check before reading `--cases` or `--prompt` override files - Node would throw raw ENOENT with no context | Added `existsSync()` checks before all file reads with human-readable error messages |
| M11 | `src/core/contracts.js` | YAML saved with default schema - user-supplied contract names or descriptions with YAML-special characters (`:`, `{`, `>`) could corrupt the file | Changed to `yaml.dump(contract, { schema: yaml.CORE_SCHEMA })` - safe subset that always produces valid YAML |
| M12 | `src/commands/diff.js` | Missing `process.exit(0)` at end - diff returned exit code 1 on success when run in some shells | Added explicit `process.exit(0)` at the end of the diff action |

---

## LOW (Polish and edge cases)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| L1 | `src/commands/list.js` | Free/local models (Ollama) showed `$0.0000` in cost column - looks broken, not intentional | Changed to show `free` string for models with `cost.free === true` |
| L2 | `src/cli.js` | `dotenv` loaded via `import 'dotenv/config'` at CLI entry - loaded for every subcommand including `list` and `report` which make no API calls | Removed top-level dotenv import from cli.js. Each command that needs env vars (runner.js) loads dotenv lazily |
| L3 | `src/commands/config.js` | Config command with no subcommand printed nothing - blank output with exit 0 | Added `.action(() => cmd.help())` to show help when no subcommand is given |
| L4 | `src/commands/report.js` | Model name in report table was not truncated - long model IDs (e.g. `meta-llama/Meta-Llama-3-70B-Instruct`) broke table alignment | Truncated to 25 chars with `..` suffix |
| L5 | `src/core/contracts.js` | `listContracts()` returned contracts in filesystem order (unpredictable across OS) | Added `.sort()` to return alphabetical order |
| L6 | `src/commands/define.js` | Schema validation used `ajv.compile` without error handling - malformed JSON Schema would throw an unformatted stack trace | Wrapped in try/catch with `console.error` + `process.exit(1)` |

---

## PRE-PUBLISH (Bugs found during final publish check)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| P1 | `src/commands/delete.js` | Confirmation prompt used `execSync` to spawn a child Node.js process to read stdin - broken on Windows and in CI pipelines | Replaced with `readline/promises` (Node 18+ built-in). Non-TTY environments (CI, pipes) now require `--yes` explicitly |
| P2 | `src/core/runner.js` | `validateBaseUrl()` warning and `_isCustom` model warning fired on every API call - 50-case test suite printed 50 identical warning lines | Added `_warnedOnce` Set + `warnOnce(key, msg)` helper at module level. Each warning key fires at most once per process |
| P3 | `README.md` | Outdated: said "Not on npm yet", used `git clone + npm link` quick start, missing `config`/`delete` commands, missing `--delay`/`--base-url`/`--api-key` flags, missing Groq/Mistral/Ollama/Together/Fireworks models | Full rewrite: `npm install -g schemalock` quick start, all 7 commands documented, all flags in tables, 21 models across 6 providers, `SCHEMALOCK_DB` env var, updated architecture diagram |

---

## New Files Created

| File | Purpose |
|------|---------|
| `src/commands/delete.js` | `schemalock delete <name>` command (H6) |
| `src/commands/config.js` | `schemalock config` command with set/get/delete/list-keys/update-pricing/env subcommands (H3, H5) |
| `src/utils/cases.js` | `sanitizeCaseId()`, `checkCaseCount()`, `validateCaseStructure()` shared utilities (H2, M6, M9) |

---

## Files Modified

| File | Changes |
|------|---------|
| `src/cli.js` | Dynamic version from package.json (M1), removed dotenv (L2), added delete + config commands |
| `src/commands/define.js` | Absolute prompt path (H1), sanitize case IDs (H2), validate case structure (M9), console.error (M7) |
| `src/commands/test.js` | `validateExpected` (C1), `--delay` option (M2), case count guard (M6), sanitize IDs (H2), validate structure (M9), file existence checks (M10), console.error (M7) |
| `src/commands/diff.js` | Disagreements index fix (M4), `--base-url`/`--api-key`/`--prompt`/`--cases` options (M5), `--delay` (M2), fail-fast (H8), chalk padding (M8), `process.exit(0)` (M12), console.error (M7) |
| `src/commands/list.js` | Free model cost display (L1), chalk padding (M8) |
| `src/commands/report.js` | Model name truncation (L4), chalk padding (M8) |
| `src/core/runner.js` | `validateBaseUrl` warning (M3), `_isCustom` warning (H4), `warnOnce` deduplication (P2) |
| `src/core/validator.js` | `formatAjvError` with actual value (H7), `validateExpected` export (C1) |
| `src/core/store.js` | busy_timeout 30s (C2), SQLITE_BUSY detection, `deleteRunsByContract()` export (H6) |
| `src/core/contracts.js` | CORE_SCHEMA on save (M11), `deleteContract()` export (H6), sorted `listContracts()` (L5) |
| `src/utils/config.js` | `DB_PATH` export with `SCHEMALOCK_DB` override (H5), `MODELS_PATH` export (H3) |
| `src/utils/models.js` | `loadPricingOverrides()` (H3), `buildPricingTemplate()` (H3), `validateBaseUrl()` (M3), `_isCustom` flag on unknown models (H4), corrected maxTokens limits |
| `package.json` | Added `prepublishOnly` script, `npm pkg fix` cleaned bin path |
| `README.md` | Full rewrite (P3) |

---

## Release Status

| Version | Date | Status |
|---------|------|--------|
| 0.1.0 | 2026-03-10 | Published to npm |
