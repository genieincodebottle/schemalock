import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, existsSync } from 'fs';
import { loadContract } from '../core/contracts.js';
import { runLLM } from '../core/runner.js';
import { parseOutput, validateOutput, compareToExpected } from '../core/validator.js';
import { estimateCost, clampMaxTokens } from '../utils/models.js';
import { sanitizeCaseId, checkCaseCount, validateCaseStructure } from '../utils/cases.js';

// M2: Pause between API calls to avoid provider rate limits
function sleep(ms) {
  return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
}

// H8: Fail-fast threshold - stop testing a model after this many consecutive API errors
const FAIL_FAST_THRESHOLD = 3;

export function diffCommand() {
  return new Command('diff')
    .description('Compare two models on the same contract - find regressions when switching models')
    .argument('<model1>', 'First model (baseline, e.g. claude-sonnet-4-6)')
    .argument('<model2>', 'Second model (candidate, e.g. gpt-4o)')
    .requiredOption('--contract <name>', 'Contract name to test against')
    .option('--cases <file>',    'Override test cases file')
    .option('--prompt <file>',   'Override system prompt file')
    .option('--max-tokens <n>',  'Max output tokens per call', '1024')
    .option('--base-url <url>',  'Custom OpenAI-compatible base URL (Ollama, Groq, LM Studio)')
    .option('--api-key <key>',   'API key override (defaults to env var for the chosen model)')
    .option('--delay <ms>',      'Delay between API calls in ms (avoids rate limits)', '0')
    .action(async (model1, model2, options) => {
      const contract = loadContract(options.contract);

      // --- Validate options early ---
      let maxTokens = parseInt(options.maxTokens, 10);
      if (isNaN(maxTokens) || maxTokens < 1) {
        console.error(chalk.red(`\nInvalid --max-tokens '${options.maxTokens}'. Must be a positive integer.\n`));
        process.exit(1);
      }
      const delay = parseInt(options.delay, 10);
      if (isNaN(delay) || delay < 0) {
        console.error(chalk.red(`\nInvalid --delay '${options.delay}'. Must be a non-negative integer (ms).\n`));
        process.exit(1);
      }
      // Clamp per-model limits (apply the stricter of the two)
      for (const modelId of [model1, model2]) {
        const clamped = clampMaxTokens(modelId, maxTokens);
        if (clamped < maxTokens) {
          console.error(chalk.yellow(`  Note: --max-tokens capped to ${clamped} for ${modelId}`));
          maxTokens = clamped;
        }
      }

      // --- Resolve test cases ---
      let cases = contract.testCases || [];
      if (options.cases) {
        if (!existsSync(options.cases)) {
          console.error(chalk.red(`\nCases file not found: ${options.cases}\n`));
          process.exit(1);
        }
        try {
          const raw = JSON.parse(readFileSync(options.cases, 'utf-8'));
          if (!Array.isArray(raw)) throw new Error('Top-level value must be an array');
          cases = raw;
        } catch (e) {
          console.error(chalk.red(`\nInvalid cases file: ${e.message}\n`));
          process.exit(1);
        }
      }
      if (cases.length === 0) {
        console.error(chalk.yellow(`\nNo test cases found for '${options.contract}'.`));
        console.error(chalk.dim(`  Add cases: schemalock define ${options.contract} --cases cases.json --overwrite\n`));
        process.exit(1);
      }

      // M6: Guard against accidental runaway test suites
      try {
        const warn = checkCaseCount(cases, 'diff');
        if (warn) console.error(chalk.yellow(`\n  ${warn}\n`));
      } catch (e) {
        console.error(chalk.red(`\n${e.message}\n`));
        process.exit(1);
      }

      // H2: Sanitize case IDs from untrusted input files
      cases = cases.map(c => ({
        ...c,
        ...(c.id !== undefined ? { id: sanitizeCaseId(String(c.id)) } : {}),
      }));

      // Validate structure
      const structErrors = validateCaseStructure(cases);
      if (structErrors.length > 0) {
        console.error(chalk.red(`\nTest case structure errors:\n`));
        structErrors.forEach(e => console.error(chalk.red(`  ${e}`)));
        console.error('');
        process.exit(1);
      }

      // --- Resolve system prompt ---
      let systemPrompt = contract.systemPrompt || '';
      if (options.prompt) {
        if (!existsSync(options.prompt)) {
          console.error(chalk.red(`\nPrompt file not found: ${options.prompt}\n`));
          process.exit(1);
        }
        systemPrompt = readFileSync(options.prompt, 'utf-8');
      } else if (contract.systemPromptFile && existsSync(contract.systemPromptFile)) {
        systemPrompt = readFileSync(contract.systemPromptFile, 'utf-8');
      }

      const baseUrl = options.baseUrl;
      const apiKey  = options.apiKey;

      console.log(chalk.bold(`\nschemalock diff  ${chalk.cyan(options.contract)}`));
      console.log(chalk.dim(`  ${model1} vs ${model2}  |  ${cases.length} cases${delay > 0 ? `  |  delay: ${delay}ms` : ''}\n`));

      const results = {};
      const costs   = {};

      for (const modelId of [model1, model2]) {
        results[modelId] = [];
        costs[modelId]   = 0;
        console.log(chalk.bold(`  Testing ${modelId}...`));

        let consecutiveErrors = 0; // H8: fail-fast tracker

        for (let i = 0; i < cases.length; i++) {
          const c      = cases[i];
          const caseId = c.id || `case-${i + 1}`;
          const spinner = ora({ text: chalk.dim(`  [${i + 1}/${cases.length}] ${caseId}`), spinner: 'dots' }).start();

          // M2: Rate limiting
          if (i > 0 && delay > 0) await sleep(delay);

          try {
            const result = await runLLM({ modelId, systemPrompt, userInput: c.input, maxTokens, baseUrl, apiKey });
            consecutiveErrors = 0; // reset on success

            const { parsed, error } = parseOutput(result.output, contract.output?.format || 'json');
            const validation = error
              ? { valid: false, errors: [{ message: error }] }
              : validateOutput(parsed, contract);

            const { mismatches } = error ? { mismatches: [] } : compareToExpected(parsed, c.expected);
            const passed = !error && validation.valid && mismatches.length === 0;

            const cost = estimateCost(modelId, result.inputTokens, result.outputTokens);
            costs[modelId] += cost?.total || 0;
            results[modelId].push({ caseId, passed, latencyMs: result.latencyMs });

            passed
              ? spinner.succeed(chalk.green(`  PASS `) + chalk.dim(caseId))
              : spinner.fail(chalk.red(`  FAIL `) + chalk.dim(caseId));
          } catch (err) {
            consecutiveErrors++;
            spinner.fail(chalk.red(`  ERROR `) + chalk.dim(`${caseId}: ${err.message}`));
            results[modelId].push({ caseId, passed: false, latencyMs: 0 });

            // H8: Fail-fast - if API keeps failing, don't waste all remaining calls
            if (consecutiveErrors >= FAIL_FAST_THRESHOLD) {
              const remaining = cases.length - i - 1;
              if (remaining > 0) {
                console.error(chalk.red(`\n  Stopped after ${FAIL_FAST_THRESHOLD} consecutive API errors. Skipping ${remaining} remaining case${remaining !== 1 ? 's' : ''} for ${modelId}.\n`));
                // Fill remaining as errors so comparison is complete
                for (let j = i + 1; j < cases.length; j++) {
                  const skippedId = cases[j].id || `case-${j + 1}`;
                  results[modelId].push({ caseId: skippedId, passed: false, latencyMs: 0, skipped: true });
                }
              }
              break;
            }
          }
        }
        console.log('');
      }

      // --- Summary table ---
      const m1Pass    = results[model1].filter(r => r.passed).length;
      const m2Pass    = results[model2].filter(r => r.passed).length;
      const m1Rate    = cases.length > 0 ? Math.round((m1Pass / cases.length) * 100) : 0;
      const m2Rate    = cases.length > 0 ? Math.round((m2Pass / cases.length) * 100) : 0;
      const m1Tested  = results[model1].filter(r => r.latencyMs > 0);
      const m2Tested  = results[model2].filter(r => r.latencyMs > 0);
      const m1Latency = m1Tested.length > 0 ? Math.round(m1Tested.reduce((s, r) => s + r.latencyMs, 0) / m1Tested.length) : 0;
      const m2Latency = m2Tested.length > 0 ? Math.round(m2Tested.reduce((s, r) => s + r.latencyMs, 0) / m2Tested.length) : 0;

      // Pad raw strings FIRST, then colorize - avoids ANSI escape code width inflation
      const colW = Math.max(24, model1.length + 2);
      const m1RateStr    = `${m1Rate}%`.padEnd(colW);
      const m1RateColored = m1Rate >= m2Rate ? chalk.green(m1RateStr) : chalk.red(m1RateStr);
      const m2RateColored = m2Rate >= m1Rate ? chalk.green(`${m2Rate}%`) : chalk.red(`${m2Rate}%`);

      console.log(chalk.bold('  Comparison'));
      console.log(`  ${''.padEnd(14)} ${model1.padEnd(colW)} ${model2}`);
      console.log(`  ${'─'.repeat(14 + colW + model2.length + 2)}`);
      console.log(`  ${'Pass Rate'.padEnd(14)} ${m1RateColored} ${m2RateColored}`);
      console.log(`  ${'Avg Latency'.padEnd(14)} ${String(m1Latency + 'ms').padEnd(colW)} ${m2Latency}ms`);
      if (costs[model1] > 0 || costs[model2] > 0) {
        console.log(`  ${'Total Cost'.padEnd(14)} ${'$' + costs[model1].toFixed(4).padEnd(colW - 1)} $${costs[model2].toFixed(4)}`);
      }

      // --- Per-case disagreements ---
      // Preserve original index before filter so auto-generated IDs are correct
      const disagreements = cases
        .map((c, originalIdx) => ({ ...c, _originalIdx: originalIdx }))
        .filter(c => {
          const id = c.id || `case-${c._originalIdx + 1}`;
          const r1 = results[model1].find(r => r.caseId === id);
          const r2 = results[model2].find(r => r.caseId === id);
          return r1?.passed !== r2?.passed;
        });

      if (disagreements.length > 0) {
        console.log(chalk.yellow(`\n  Disagreements (${disagreements.length}/${cases.length} cases differ):`));
        const short1 = model1.length > 20 ? model1.slice(0, 18) + '..' : model1;
        const short2 = model2.length > 20 ? model2.slice(0, 18) + '..' : model2;
        disagreements.forEach(c => {
          const id = c.id || `case-${c._originalIdx + 1}`;
          const r1 = results[model1].find(r => r.caseId === id);
          const r2 = results[model2].find(r => r.caseId === id);
          const s1 = r1?.passed ? chalk.green('PASS') : chalk.red('FAIL');
          const s2 = r2?.passed ? chalk.green('PASS') : chalk.red('FAIL');
          console.log(`    ${id.padEnd(25)} ${short1}=${s1}  ${short2}=${s2}`);
        });
      } else {
        console.log(chalk.green(`\n  Both models agree on all ${cases.length} cases.`));
      }

      // --- Verdict ---
      const delta = Math.abs(m1Rate - m2Rate);
      if (delta === 0) {
        console.log(chalk.dim(`\n  No regression detected. Models are equivalent on this contract.\n`));
      } else {
        const winner = m1Rate >= m2Rate ? model1 : model2;
        const loser  = m1Rate >= m2Rate ? model2 : model1;
        console.log(chalk.dim(`\n  ${winner} leads by ${delta} percentage points. Consider regression risk before switching to ${loser}.\n`));
      }

      process.exit(0);
    });
}
