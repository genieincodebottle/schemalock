import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline/promises';
import { loadContract, deleteContract, listContracts } from '../core/contracts.js';
import { deleteRunsByContract } from '../core/store.js';

export function deleteCommand() {
  return new Command('delete')
    .description('Delete a contract and optionally its test history')
    .argument('<name>', 'Contract name to delete')
    .option('--keep-history', 'Keep test run history in the database (default: delete it too)')
    .option('--yes',          'Skip confirmation prompt (safe for CI/scripts)')
    .action(async (name, options) => {
      // Verify the contract exists (throws with helpful message if not)
      loadContract(name);

      if (!options.yes) {
        const historyNote = options.keepHistory ? '' : ' and all its test history';
        console.log(chalk.yellow(`\n  This will permanently delete contract '${name}'${historyNote}.`));
        console.log(chalk.dim(`  To skip this prompt in scripts: schemalock delete ${name} --yes\n`));

        // In non-interactive environments (CI, pipes), require --yes explicitly
        if (!process.stdin.isTTY) {
          console.error(chalk.red(`  Non-interactive mode detected. Use --yes to confirm deletion.\n`));
          process.exit(1);
        }

        // readline/promises is built into Node 18+ (our minimum engine version)
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        let answer;
        try {
          answer = await rl.question('  Confirm? (yes/N): ');
        } finally {
          rl.close();
        }

        if (answer.trim().toLowerCase() !== 'yes' && answer.trim().toLowerCase() !== 'y') {
          console.log(chalk.dim('\n  Cancelled.\n'));
          process.exit(0);
        }
      }

      // Delete the contract file
      deleteContract(name);

      // Delete run history unless --keep-history is set
      let deletedRuns = 0;
      if (!options.keepHistory) {
        deletedRuns = deleteRunsByContract(name);
      }

      console.log(chalk.green(`\n  Deleted contract '${name}'`));
      if (!options.keepHistory) {
        console.log(chalk.dim(`  Removed ${deletedRuns} test run${deletedRuns !== 1 ? 's' : ''} from history`));
      } else {
        console.log(chalk.dim(`  Test history kept in database`));
      }

      const remaining = listContracts();
      console.log(chalk.dim(`  ${remaining.length} contract${remaining.length !== 1 ? 's' : ''} remaining\n`));
    });
}
