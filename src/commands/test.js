import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, existsSync } from 'fs';
import { loadContract } from '../core/contracts.js';
import { runLLM } from '../core/runner.js';
import { parseOutput, validateOutput, compareToExpected, validateExpected } from '../core/validator.js';
import { saveRun } from '../core/store.js';
import { estimateCost, clampMaxTokens } from '../utils/models.js';
import { sanitizeCaseId, checkCaseCount, validateCaseStructure } from '../utils/cases.js';

// M2: Pause between API calls to avoid provider rate limits
function sleep(ms) {
  return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
}

export function testCommand() {
  return new Command('test')
    .description('Run contract tests against an LLM')
    .argument('<name>', 'Contract name')
    .option('--model <model>',       'Model to test with',                                         'claude-sonnet-4-6')
    .option('--cases <file>',        'Override test cases (JSON file)')
    .option('--prompt <file>',       'Override system prompt file')
    .option('--max-tokens <n>',      'Max output tokens per call',                                 '1024')
    .option('--threshold <n>',       'Minimum pass rate (0.0-1.0) for exit code 0',                '0.8')
    .option('--base-url <url>',      'Custom OpenAI-compatible base URL (Ollama, Groq, LM Studio)')
    .option('--api-key <key>',       'API key override (defaults to env var for the chosen model)')
    .option('--output <fmt>',        'Output format: console|json',                                'console')
    .option('--delay <ms>',          'Delay between API calls in ms (avoids rate limits)',         '0')
    .action(async (name, options) => {
      const contract = loadContract(name);

      // --- Validate numeric options early ---
      const threshold = parseFloat(options.threshold);
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        console.error(chalk.red(`\nInvalid --threshold '${options.threshold}'. Must be 0.0-1.0 (e.g. 0.8 = 80%)\n`));
        process.exit(1);
      }
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
      const modelId = options.model;
      const clamped = clampMaxTokens(modelId, maxTokens);
      if (clamped < maxTokens) {
        console.log(chalk.yellow(`  Note: --max-tokens capped to ${clamped} (${modelId} maximum)`));
        maxTokens = clamped;
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
        console.error(chalk.yellow(`\nNo test cases found for '${name}'.`));
        console.error(chalk.dim(`  Add cases: schemalock define ${name} --cases cases.json --overwrite\n`));
        process.exit(1);
      }

      // M6: Guard against accidental runaway test suites
      try {
        const warn = checkCaseCount(cases);
        if (warn) console.error(chalk.yellow(`\n  ${warn}\n`));
      } catch (e) {
        console.error(chalk.red(`\n${e.message}\n`));
        process.exit(1);
      }

      // H2: Sanitize case IDs from untrusted files
      cases = cases.map((c, i) => ({
        ...c,
        ...(c.id !== undefined ? { id: sanitizeCaseId(String(c.id)) } : {}),
      }));

      // Validate case structure
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
      if (!systemPrompt.trim()) {
        console.error(chalk.yellow(`  Warning: No system prompt set. Results may be unpredictable.`));
      }

      // C1: Warn if test case expected values disagree with the contract's JSON schema
      const expectedWarnings = validateExpected(cases, contract);
      if (expectedWarnings.length > 0) {
        console.error(chalk.yellow(`\n  Expected value warnings (these assertions may never pass):`));
        expectedWarnings.forEach(w => console.error(chalk.yellow(w)));
        console.error('');
      }

      const jsonMode = options.output === 'json';
      const baseUrl  = options.baseUrl;
      const apiKey   = options.apiKey;

      if (!jsonMode) {
        console.log(chalk.bold(`\nschemalock test  ${chalk.cyan(name)}`));
        console.log(chalk.dim(`  model: ${modelId}  |  cases: ${cases.length}  |  threshold: ${Math.round(threshold * 100)}%${delay > 0 ? `  |  delay: ${delay}ms` : ''}\n`));
      }

      const caseResults = [];
      let totalCost    = 0;
      let totalLatency = 0;

      for (let i = 0; i < cases.length; i++) {
        const c      = cases[i];
        const caseId = c.id || `case-${i + 1}`;
        const spinner = jsonMode
          ? null
          : ora({ text: chalk.dim(`[${i + 1}/${cases.length}] ${caseId}`), spinner: 'dots' }).start();

        // M2: Rate limiting - sleep between calls (not before first call)
        if (i > 0 && delay > 0) await sleep(delay);

        try {
          const result = await runLLM({ modelId, systemPrompt, userInput: c.input, maxTokens, baseUrl, apiKey });
          const { parsed, error: parseError } = parseOutput(result.output, contract.output?.format || 'json');
          const validation = parseError
            ? { errors: [{ rule: 'parse', message: parseError }], passed: [], valid: false }
            : validateOutput(parsed, contract);
          const { mismatches } = parseError ? { mismatches: [] } : compareToExpected(parsed, c.expected);

          const allErrors = [
            ...validation.errors,
            ...mismatches.map(m => ({
              rule:    'expected_value',
              // Truncate long values to keep error messages readable
              message: `'${m.key}': expected ${JSON.stringify(m.expected).slice(0, 100)}, got ${JSON.stringify(m.actual).slice(0, 100)}`,
            })),
          ];

          const passed   = allErrors.length === 0;
          const cost     = estimateCost(modelId, result.inputTokens, result.outputTokens);
          const caseCost = cost.total;
          totalCost    += caseCost;
          totalLatency += result.latencyMs;

          caseResults.push({
            caseId, input: c.input, rawOutput: result.output,
            parsedOutput: parsed, passed, errors: allErrors,
            costUsd: caseCost, latencyMs: result.latencyMs,
          });

          if (!jsonMode) {
            if (passed) {
              const costStr = cost.free ? '' : `, $${caseCost.toFixed(4)}`;
              spinner.succeed(chalk.green(`PASS `) + chalk.white(caseId) + chalk.dim(` (${result.latencyMs}ms${costStr})`));
            } else {
              spinner.fail(chalk.red(`FAIL `) + chalk.white(caseId) + chalk.dim(` (${allErrors.length} error${allErrors.length !== 1 ? 's' : ''})`));
              allErrors.forEach(e => console.error(chalk.dim(`       [${e.rule}] ${e.message}`)));
            }
          }
        } catch (err) {
          if (spinner) spinner.fail(chalk.red(`ERROR `) + chalk.white(caseId) + chalk.dim(` ${err.message}`));
          caseResults.push({
            caseId, input: c.input, rawOutput: '', parsedOutput: null,
            passed: false, errors: [{ rule: 'api_error', message: err.message }],
            costUsd: 0, latencyMs: 0,
          });
        }
      }

      const passedCount = caseResults.filter(r => r.passed).length;
      const passRate    = passedCount / cases.length;
      const avgLatency  = cases.length > 0 ? totalLatency / cases.length : 0;
      const runId       = saveRun({ contractName: name, modelId, caseResults, totalCost, avgLatency });

      if (jsonMode) {
        // Pure JSON mode: no other output - machine-readable for CI pipelines
        process.stdout.write(JSON.stringify({
          runId, contract: name, model: modelId,
          passRate, passedCount, total: cases.length,
          passed: passRate >= threshold,
          totalCostUsd: totalCost, avgLatencyMs: Math.round(avgLatency),
          cases: caseResults,
        }, null, 2) + '\n');
      } else {
        const rateStr = passRate >= threshold
          ? chalk.green(`${Math.round(passRate * 100)}%`)
          : chalk.red(`${Math.round(passRate * 100)}%`);

        console.log(`\n  ${chalk.bold('Results')}${runId ? `  (run #${runId})` : ''}`);
        console.log(`  Pass rate:   ${rateStr}  (${passedCount}/${cases.length})`);
        console.log(`  Threshold:   ${Math.round(threshold * 100)}%  ${passRate >= threshold ? chalk.green('MET') : chalk.red('FAILED')}`);
        if (totalCost > 0) console.log(`  Total cost:  $${totalCost.toFixed(4)}`);
        console.log(`  Avg latency: ${Math.round(avgLatency)}ms`);
        if (runId) console.log(chalk.dim(`\n  Detail: schemalock report ${name} --run ${runId}`));
      }

      process.exit(passRate >= threshold ? 0 : 1);
    });
}
