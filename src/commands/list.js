import { Command } from 'commander';
import chalk from 'chalk';
import { listContracts, loadContract } from '../core/contracts.js';
import { getRunHistory } from '../core/store.js';
import { MODELS } from '../utils/models.js';

export function listCommand() {
  return new Command('list')
    .description('List all contracts, or show available models with pricing')
    .option('--models', 'Show available models and their pricing')
    .action((options) => {
      if (options.models) {
        console.log(chalk.bold('\n  Available Models\n'));
        console.log(`  ${'Model'.padEnd(28)} ${'Provider'.padEnd(12)} ${'Input $/1M'.padEnd(14)} Output $/1M`);
        console.log(`  ${'─'.repeat(68)}`);
        Object.entries(MODELS).forEach(([id, m]) => {
          // Pad raw string BEFORE colorizing - chalk ANSI codes inflate .padEnd() length
          const idPadded  = id.padEnd(28);
          const provPadded = m.provider.padEnd(12);
          const isFree = m.inputCost === 0;
          const inputStr  = isFree ? 'free'.padEnd(14) : `$${m.inputCost.toFixed(2).padEnd(13)}`;
          const outputStr = isFree ? 'free'             : `$${m.outputCost.toFixed(2)}`;
          console.log(`  ${chalk.cyan(idPadded)} ${provPadded} ${inputStr} ${outputStr}`);
        });
        console.log('');
        return;
      }

      const contracts = listContracts();
      if (contracts.length === 0) {
        console.log(chalk.yellow('\n  No contracts defined yet.\n'));
        console.log(chalk.dim('  Get started:'));
        console.log(chalk.dim('    schemalock define invoice-extractor \\'));
        console.log(chalk.dim('      --prompt system.txt \\'));
        console.log(chalk.dim('      --must-contain "total_amount,date,line_items" \\'));
        console.log(chalk.dim('      --cases cases.json\n'));
        return;
      }

      console.log(chalk.bold(`\n  Contracts (${contracts.length})\n`));
      contracts.forEach(name => {
        const contract  = loadContract(name);
        const history   = getRunHistory(name, 1);
        const lastRun   = history[0];
        const caseCount = contract.testCases?.length || 0;

        console.log(`  ${chalk.cyan(name)}`);
        if (contract.description) console.log(`    ${chalk.dim(contract.description)}`);
        console.log(`    Format: ${contract.output?.format || 'unset'} | Cases: ${caseCount}`);

        if (lastRun) {
          const rate    = Math.round(lastRun.pass_rate * 100);
          const rateStr = rate >= 80 ? chalk.green(`${rate}%`) : chalk.red(`${rate}%`);
          const date    = lastRun.run_at.split('T')[0];
          console.log(`    Last run: ${rateStr} on ${lastRun.model_id} (${date})`);
        } else {
          console.log(`    ${chalk.dim('Never tested - run: schemalock test ' + name)}`);
        }
        console.log('');
      });
    });
}
