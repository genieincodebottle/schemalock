import { Command } from 'commander';
import chalk from 'chalk';
import { loadContract } from '../core/contracts.js';
import { getRunHistory, getRunDetails } from '../core/store.js';

export function reportCommand() {
  return new Command('report')
    .description('Show test history and run details for a contract')
    .argument('<name>', 'Contract name')
    .option('--last <n>', 'Number of recent runs to show', '5')
    .option('--run <id>', 'Show full case-by-case detail for a specific run ID')
    .action((name, options) => {
      loadContract(name); // throws if missing

      // --- Detailed single run view ---
      if (options.run) {
        const runId = parseInt(options.run, 10);
        if (isNaN(runId) || runId < 1) {
          console.error(chalk.red(`\nInvalid run ID: ${options.run}\n`));
          process.exit(1);
        }
        const { run, cases } = getRunDetails(runId);
        if (!run) {
          console.error(chalk.red(`\n  Run #${options.run} not found.\n`));
          process.exit(1);
        }

        const rate       = Math.round((run.pass_rate || 0) * 100);
        const rateStr    = rate >= 80 ? chalk.green(`${rate}%`) : chalk.red(`${rate}%`);
        const timestamp  = run.run_at.replace('T', ' ').split('.')[0];
        const isFree     = (run.total_cost_usd || 0) === 0;

        console.log(chalk.bold(`\n  Run #${run.id} - ${run.contract_name}`));
        console.log(`  Model:    ${run.model_id}`);
        console.log(`  Date:     ${timestamp}`);
        console.log(`  Result:   ${run.passed_cases}/${run.total_cases} passed (${rateStr})`);
        if (!isFree) console.log(`  Cost:     $${(run.total_cost_usd || 0).toFixed(4)}`);
        console.log(`  Latency:  ${Math.round(run.avg_latency_ms || 0)}ms avg\n`);

        cases.forEach(c => {
          const status = c.passed ? chalk.green('  PASS') : chalk.red('  FAIL');
          console.log(`${status}  ${c.case_id}`);
          if (!c.passed) {
            try {
              const errors = JSON.parse(c.errors || '[]');
              errors.forEach(e => {
                console.log(chalk.dim(`         [${e.rule || 'error'}] ${e.message}`));
              });
            } catch {
              console.log(chalk.dim(`         ${c.errors}`));
            }
          }
        });
        console.log('');
        return;
      }

      // --- Run history table ---
      const limit = parseInt(options.last, 10);
      if (isNaN(limit) || limit < 1) {
        console.error(chalk.red(`\nInvalid --last value: ${options.last}\n`));
        process.exit(1);
      }

      const history = getRunHistory(name, limit);
      if (history.length === 0) {
        console.log(chalk.yellow(`\n  No test runs for '${name}' yet.`));
        console.log(chalk.dim(`  schemalock test ${name} --model claude-sonnet-4-6\n`));
        return;
      }

      console.log(chalk.bold(`\n  History: ${name}  (last ${history.length} run${history.length !== 1 ? 's' : ''})\n`));
      console.log(`  ${'#'.padEnd(6)} ${'Model'.padEnd(26)} ${'Pass'.padEnd(10)} ${'Cost'.padEnd(10)} Date`);
      console.log(`  ${'─'.repeat(64)}`);

      history.forEach(r => {
        const rate    = Math.round((r.pass_rate || 0) * 100);
        // Pad the raw string FIRST, then colorize - avoids ANSI escape code width inflation
        const rateRaw = `${rate}%`.padEnd(10);
        const rateStr = rate >= 80 ? chalk.green(rateRaw) : chalk.red(rateRaw);
        const date    = r.run_at.split('T')[0];
        const isFree  = (r.total_cost_usd || 0) === 0;
        const cost    = isFree ? 'free'.padEnd(10) : `$${(r.total_cost_usd || 0).toFixed(4)}`.padEnd(10);
        const model   = r.model_id.length > 25 ? r.model_id.slice(0, 23) + '..' : r.model_id;
        console.log(`  ${String(r.id).padEnd(6)} ${model.padEnd(26)} ${rateStr} ${cost} ${date}`);
      });

      console.log(chalk.dim(`\n  Detail: schemalock report ${name} --run <id>\n`));
    });
}
