# Contributing to schemalock

Thank you for helping make LLM contract testing better. This guide covers everything you need to contribute.

---

## Table of Contents

- [Local Setup](#local-setup)
- [Project Structure](#project-structure)
- [Adding a New Model or Provider](#adding-a-new-model-or-provider)
- [Adding a New Command](#adding-a-new-command)
- [Code Style](#code-style)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)

---

## Local Setup

```bash
git clone https://github.com/genieincodebottle/schemalock.git
cd schemalock
npm install

# Link globally so you can run `schemalock` from anywhere
npm link

# Verify it works
schemalock --version
schemalock --help
```

Set up at least one API key to run real tests:

```bash
schemalock config set ANTHROPIC_API_KEY sk-ant-...
# or
schemalock config set OPENAI_API_KEY sk-...
# or use Ollama locally (free, no key needed)
ollama pull llama3.2
```

---

## Project Structure

```
bin/
  schemalock.js         # Entry point - shebang + error handlers + dynamic import
src/
  cli.js                # Commander setup - registers all commands
  commands/             # One file per subcommand
    define.js           # schemalock define
    test.js             # schemalock test
    diff.js             # schemalock diff
    list.js             # schemalock list
    report.js           # schemalock report
    delete.js           # schemalock delete
    config.js           # schemalock config
  core/                 # Business logic (no Commander, no chalk)
    runner.js           # Anthropic + OpenAI API calls
    validator.js        # JSON Schema + field + expected value validation
    store.js            # SQLite persistence
    contracts.js        # YAML contract load/save/delete
  utils/                # Pure helpers (no side effects)
    config.js           # ~/.schemalock/ paths + SCHEMALOCK_DB
    models.js           # Model registry, pricing, pricing overrides
    cases.js            # Case ID sanitization, count guards, structure validation
examples/
  cases/                # Example test case JSON files
  contracts/            # Example contract YAML files
  prompts/              # Example system prompt text files
```

**Rule:** Commands handle CLI parsing and output only. Business logic lives in `core/`. Utilities in `utils/` have no side effects and no imports from `core/` or `commands/`.

---

## Adding a New Model or Provider

### Case 1: New model on an existing provider

Open `src/utils/models.js` and add an entry to `MODELS_BASE`:

```javascript
// Inside the MODELS_BASE object:
'gpt-4o-2024-11-20': { provider: 'openai', inputCost: 2.50, outputCost: 10.00, maxTokens: 16384 },
```

Fields:
- `provider` - must match a key in `PROVIDERS` (anthropic, openai, groq, mistral, ollama, custom)
- `inputCost` / `outputCost` - dollars per 1M tokens (check provider pricing page)
- `maxTokens` - provider's hard limit for this model (not your preferred default)

Then update the README models table and CHANGELOG.

### Case 2: New provider entirely

1. Add provider config to `PROVIDERS` in `models.js`:

```javascript
export const PROVIDERS = {
  // ... existing providers ...
  together: {
    envKey:  'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.xyz/v1',
    label:   'Together AI',
  },
};
```

2. Add models for the new provider to `MODELS_BASE`.

3. If the provider uses a non-standard API (not OpenAI-compatible), add a branch in `src/core/runner.js` in `runLLM()` following the existing Anthropic/OpenAI pattern.

4. Add the `envKey` to `.env.example`.

5. Update README models table, `schemalock config list-keys` output in `config.js`, and CHANGELOG.

---

## Adding a New Command

1. Create `src/commands/yourcommand.js` following this pattern:

```javascript
import { Command } from 'commander';
import chalk from 'chalk';

export function yourCommand() {
  return new Command('yourcommand')
    .description('What it does')
    .argument('<name>', 'What name means')
    .option('--flag <value>', 'What flag does', 'default')
    .action(async (name, options) => {
      // Validate options early - fail before doing any work
      // Use console.error() for all error output (keeps stdout clean for --output json)
      // Use process.exit(1) on error, process.exit(0) on success
    });
}
```

2. Import and register in `src/cli.js`:

```javascript
import { yourCommand } from './commands/yourcommand.js';
program.addCommand(yourCommand());
```

3. Add the command section to README.md.

4. Add an entry to CHANGELOG.md under `### Added`.

---

## Code Style

No linter is enforced, but match the existing style:

- **ESM imports** - `import/export`, never `require()`
- **`console.error()`** for all warnings and errors - never `console.log()` for errors
- **`process.exit(1)`** on any error - no silent failures
- **Early validation** - parse and validate all options before doing any real work
- **Chalk padding** - pad raw strings before colorizing: `chalk.green(str.padEnd(n))` not `chalk.green(str).padEnd(n)` (ANSI codes inflate `.padEnd` length)
- **`warnOnce(key, msg)`** in `runner.js` - use for any warning that might fire per API call
- **No dotenv in commands** - `runner.js` loads env vars; commands should not import dotenv
- **Align related assignments** with spaces for readability:
  ```javascript
  const foo    = 'bar';
  const longer = 'baz';
  ```

---

## Submitting a Pull Request

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Test manually with a real contract:
   ```bash
   schemalock define test-contract --format json --must-contain "result"
   # add a cases file, run test, verify output looks right
   ```
4. Update README.md if you added/changed any command, flag, or model
5. Add an entry to CHANGELOG.md under `## [Unreleased]`
6. Open a PR - fill in the PR template

### What gets reviewed

- Does it match the code style above?
- Does every error path `console.error` + `process.exit(1)`?
- Does `--output json` still produce clean JSON (no stray console.log)?
- Does it work with `--base-url` custom endpoints?
- Is the README updated?

---

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) on GitHub Issues.

For security vulnerabilities, see [SECURITY.md](SECURITY.md) - do **not** open a public issue.
