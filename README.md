# schemalock

**LLM output contract testing CLI.** Catch prompt regressions before they reach production.

When you update a prompt or switch models, your downstream code can break silently. `schemalock` gives you a test suite for LLM outputs - define what your pipeline must return, run it against any model, and get a clear pass/fail with cost tracking.

---

## Quick Start

```bash
# 1. Install globally
npm install -g schemalock

# 2. Set your API key (stored in ~/.schemalock/.env)
schemalock config set ANTHROPIC_API_KEY sk-ant-...

# 3. Define a contract
schemalock define invoice-extractor \
  --prompt prompts/invoice-extractor.txt \
  --must-contain "total_amount,currency,date" \
  --cases cases/invoice-cases.json

# 4. Run tests
schemalock test invoice-extractor --model claude-sonnet-4-6

# 5. Compare models before switching
schemalock diff claude-sonnet-4-6 gpt-4o --contract invoice-extractor
```

---

## Commands

### `schemalock define <name>`
Create or update a contract.

```bash
schemalock define sentiment-classifier \
  --prompt prompts/sentiment.txt \
  --format json \
  --must-contain "sentiment,confidence,reasoning" \
  --cases cases/sentiment-cases.json \
  --description "Classifies customer review sentiment"
```

| Flag | Description |
|------|-------------|
| `--prompt <file>` | System prompt file |
| `--format` | `json` (default), `text`, or `markdown` |
| `--must-contain <fields>` | Comma-separated required JSON fields |
| `--must-not-contain <phrases>` | Comma-separated banned phrases (for text output) |
| `--schema <file>` | JSON Schema file for strict validation |
| `--cases <file>` | JSON file with test cases |
| `--description <text>` | Human-readable description |
| `--overwrite` | Replace an existing contract |

---

### `schemalock test <name>`
Run the contract against a model. Exits 0 on pass, 1 on fail (CI-friendly).

```bash
schemalock test invoice-extractor --model claude-sonnet-4-6
schemalock test invoice-extractor --model gpt-4o --threshold 0.9
schemalock test invoice-extractor --model llama-3.3-70b-versatile  # Groq
schemalock test invoice-extractor --model ollama/llama3.2           # local
schemalock test invoice-extractor --output json                      # machine-readable
```

| Flag | Default | Description |
|------|---------|-------------|
| `--model` | `claude-sonnet-4-6` | Model to test |
| `--threshold` | `0.8` | Min pass rate (0.0-1.0) for exit code 0 |
| `--max-tokens` | `1024` | Max output tokens per call |
| `--output` | `console` | `console` or `json` |
| `--cases <file>` | - | Override test cases (JSON file) |
| `--prompt <file>` | - | Override system prompt file |
| `--base-url <url>` | - | Custom OpenAI-compatible endpoint (Ollama, Groq, LM Studio) |
| `--api-key <key>` | - | API key (defaults to env var for the chosen model) |
| `--delay <ms>` | `0` | Delay between API calls in ms (avoids rate limits) |

---

### `schemalock diff <model1> <model2>`
Find regressions before switching models. Runs the full test suite on both models and shows where they disagree.

```bash
schemalock diff claude-sonnet-4-6 gpt-4o --contract invoice-extractor
schemalock diff claude-sonnet-4-6 llama-3.3-70b-versatile --contract invoice-extractor
```

Output:
```
  Comparison
                 claude-sonnet-4-6        gpt-4o
  ──────────────────────────────────────────────────────
  Pass Rate      100%                     80%
  Avg Latency    1230ms                   890ms
  Total Cost     $0.0041                  $0.0028

  Disagreements (1/5 cases differ):
    european-invoice          claude-sonnet-4-6=PASS  gpt-4o=FAIL

  claude-sonnet-4-6 leads by 20 percentage points. Consider regression risk before switching to gpt-4o.
```

| Flag | Default | Description |
|------|---------|-------------|
| `--contract <name>` | required | Contract to test against |
| `--cases <file>` | - | Override test cases |
| `--prompt <file>` | - | Override system prompt |
| `--max-tokens` | `1024` | Max output tokens per call |
| `--base-url <url>` | - | Custom OpenAI-compatible endpoint |
| `--api-key <key>` | - | API key override |
| `--delay <ms>` | `0` | Delay between API calls in ms |

---

### `schemalock list`
List all your contracts with last run status.

```bash
schemalock list
schemalock list --models    # show available models + pricing
```

---

### `schemalock report <name>`
View test run history for a contract.

```bash
schemalock report invoice-extractor             # last 5 runs
schemalock report invoice-extractor --last 20   # last 20 runs
schemalock report invoice-extractor --run 7     # full case detail for run #7
```

---

### `schemalock delete <name>`
Delete a contract and optionally its test history.

```bash
schemalock delete invoice-extractor             # prompts for confirmation
schemalock delete invoice-extractor --yes       # skip prompt (CI/scripts)
schemalock delete invoice-extractor --keep-history  # remove contract, keep run data
```

| Flag | Description |
|------|-------------|
| `--yes` | Skip confirmation prompt (safe for CI/scripts) |
| `--keep-history` | Keep test run history in the database |

---

### `schemalock config`
Manage API keys and settings.

```bash
schemalock config set ANTHROPIC_API_KEY sk-ant-...
schemalock config set OPENAI_API_KEY sk-...
schemalock config set GROQ_API_KEY gsk_...
schemalock config get ANTHROPIC_API_KEY
schemalock config delete ANTHROPIC_API_KEY
schemalock config list-keys      # show all stored key names (values masked)
schemalock config update-pricing # write ~/.schemalock/models.json pricing template
schemalock config env            # show active paths and env var overrides
```

Keys are stored in `~/.schemalock/.env` - they persist across projects and terminals.

---

## Test Cases Format

```json
[
  {
    "id": "simple-invoice",
    "input": "Invoice from Acme Corp. Date: Jan 15 2024. Total: $100 USD",
    "expected": {
      "total_amount": 100,
      "currency": "USD",
      "vendor_name": "Acme Corp"
    }
  }
]
```

- `id` - unique identifier (shown in test output)
- `input` - the user message sent to the LLM
- `expected` - optional key/value pairs that must match the parsed output

---

## Supported Models

### Anthropic
| Model | Input $/1M | Output $/1M |
|-------|-----------|------------|
| `claude-sonnet-4-6` | $3.00 | $15.00 |
| `claude-opus-4-6` | $15.00 | $75.00 |
| `claude-haiku-4-5` | $0.80 | $4.00 |

### OpenAI
| Model | Input $/1M | Output $/1M |
|-------|-----------|------------|
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-4-turbo` | $10.00 | $30.00 |
| `o1` | $15.00 | $60.00 |
| `o1-mini` | $3.00 | $12.00 |
| `o3-mini` | $1.10 | $4.40 |

### Groq (fast inference)
| Model | Input $/1M | Output $/1M |
|-------|-----------|------------|
| `llama-3.3-70b-versatile` | $0.59 | $0.79 |
| `llama-3.1-8b-instant` | $0.05 | $0.08 |
| `mixtral-8x7b-32768` | $0.24 | $0.24 |
| `gemma2-9b-it` | $0.20 | $0.20 |

### Mistral
| Model | Input $/1M | Output $/1M |
|-------|-----------|------------|
| `mistral-large-latest` | $2.00 | $6.00 |
| `mistral-small-latest` | $0.10 | $0.30 |

### Ollama (local, free)
| Model | Notes |
|-------|-------|
| `ollama/llama3.2` | Requires `ollama serve` running locally |
| `ollama/mistral` | Requires `ollama serve` running locally |
| `ollama/phi4` | Requires `ollama serve` running locally |
| `ollama/qwen2.5` | Requires `ollama serve` running locally |

Any model served by Ollama works with `--model ollama/<model-name>`.

### Custom / Self-Hosted
Any OpenAI-compatible endpoint (LM Studio, Together AI, Fireworks AI, vLLM, etc.):

```bash
schemalock test my-contract \
  --model meta-llama/Meta-Llama-3-70B-Instruct \
  --base-url https://api.together.xyz/v1 \
  --api-key $TOGETHER_API_KEY
```

Run `schemalock list --models` to see all built-in models with current pricing.

---

## CI/CD Integration

```yaml
# .github/workflows/test-prompts.yml
- name: Run schemalock contract tests
  run: |
    npx schemalock test invoice-extractor \
      --model claude-sonnet-4-6 \
      --threshold 0.9 \
      --yes \
      --output json > schemalock-results.json
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The `--output json` flag produces machine-readable output:

```json
{
  "runId": 12,
  "contract": "invoice-extractor",
  "model": "claude-sonnet-4-6",
  "passRate": 0.95,
  "passedCount": 19,
  "total": 20,
  "passed": true,
  "totalCostUsd": 0.0041,
  "avgLatencyMs": 1230,
  "cases": [...]
}
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GROQ_API_KEY` | Groq API key |
| `MISTRAL_API_KEY` | Mistral API key |
| `TOGETHER_API_KEY` | Together AI API key |
| `FIREWORKS_API_KEY` | Fireworks AI API key |
| `SCHEMALOCK_DB` | Override SQLite DB path (useful for per-project isolation in CI) |

Keys can also be stored persistently with `schemalock config set <KEY> <value>`.

---

## Data Storage

All data stored locally in `~/.schemalock/`:
- `contracts/` - YAML contract definitions
- `results.db` - SQLite database of all test runs and case results
- `.env` - API keys set via `schemalock config set`
- `models.json` - optional pricing overrides (created by `schemalock config update-pricing`)

---

## Architecture

```
src/
  cli.js                  # Commander entry point
  commands/
    define.js             # schemalock define
    test.js               # schemalock test
    diff.js               # schemalock diff
    list.js               # schemalock list
    report.js             # schemalock report
    delete.js             # schemalock delete
    config.js             # schemalock config
  core/
    runner.js             # Anthropic + OpenAI API calls, timeout, client cache
    validator.js          # JSON Schema + field validation + expected value checks
    store.js              # SQLite persistence (WAL mode, busy_timeout 30s)
    contracts.js          # YAML contract load/save/delete
  utils/
    config.js             # ~/.schemalock/ directory + DB path management
    models.js             # Model registry, pricing, pricing overrides
    cases.js              # Case ID sanitization, count guards, structure validation
```

---

## License

MIT
