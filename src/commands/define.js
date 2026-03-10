import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { contractExists, saveContract } from '../core/contracts.js';
import { sanitizeCaseId, validateCaseStructure } from '../utils/cases.js';

export function defineCommand() {
  return new Command('define')
    .description('Define a new output contract for an LLM pipeline')
    .argument('<name>', 'Contract name (e.g., invoice-extractor, sentiment-classifier)')
    .option('--prompt <file>',           'Path to system prompt file')
    .option('--format <format>',         'Expected output format: json|text|markdown', 'json')
    .option('--must-contain <fields>',   'Comma-separated required JSON fields')
    .option('--must-not-contain <phrases>', 'Comma-separated banned phrases (for text output)')
    .option('--schema <file>',           'Path to JSON Schema file for strict validation')
    .option('--cases <file>',            'Path to JSON file containing test cases')
    .option('--description <text>',      'Human-readable description of this contract')
    .option('--overwrite',               'Overwrite an existing contract with the same name')
    .action((name, options) => {
      if (contractExists(name) && !options.overwrite) {
        console.error(chalk.yellow(`\nContract '${name}' already exists.`));
        console.error(chalk.dim(`  Use --overwrite to replace it, or pick a different name.\n`));
        process.exit(1);
      }

      const contract = {
        description: options.description || `Contract for ${name}`,
        output: { format: options.format },
        testCases: [],
      };

      // System prompt - H1: store ABSOLUTE path so it works from any working directory
      if (options.prompt) {
        if (!existsSync(options.prompt)) {
          console.error(chalk.red(`\nPrompt file not found: ${options.prompt}\n`));
          process.exit(1);
        }
        contract.systemPrompt     = readFileSync(options.prompt, 'utf-8');
        contract.systemPromptFile = resolve(options.prompt); // absolute path
      }

      // must_contain
      if (options.mustContain) {
        contract.output.must_contain = options.mustContain.split(',').map(f => f.trim()).filter(Boolean);
      }

      // must_not_contain
      if (options.mustNotContain) {
        contract.output.must_not_contain = options.mustNotContain.split(',').map(p => p.trim()).filter(Boolean);
      }

      // JSON Schema
      if (options.schema) {
        if (!existsSync(options.schema)) {
          console.error(chalk.red(`\nSchema file not found: ${options.schema}\n`));
          process.exit(1);
        }
        try {
          contract.output.schema = JSON.parse(readFileSync(options.schema, 'utf-8'));
        } catch (e) {
          console.error(chalk.red(`\nInvalid JSON in schema file: ${e.message}\n`));
          process.exit(1);
        }
      }

      // Test cases
      if (options.cases) {
        if (!existsSync(options.cases)) {
          console.error(chalk.red(`\nCases file not found: ${options.cases}\n`));
          process.exit(1);
        }
        let parsed;
        try {
          parsed = JSON.parse(readFileSync(options.cases, 'utf-8'));
        } catch (e) {
          console.error(chalk.red(`\nInvalid JSON in cases file: ${e.message}\n`));
          process.exit(1);
        }
        if (!Array.isArray(parsed)) {
          console.error(chalk.red(`\nCases file must contain a JSON array of test cases.\n`));
          process.exit(1);
        }

        // H2: Sanitize case IDs to prevent ANSI injection / log pollution
        contract.testCases = parsed.map((c, i) => ({
          ...c,
          ...(c.id !== undefined ? { id: sanitizeCaseId(String(c.id)) } : {}),
        }));

        // Validate structure (input field required, must be non-empty string)
        const structErrors = validateCaseStructure(contract.testCases);
        if (structErrors.length > 0) {
          console.error(chalk.red(`\nTest case structure errors:\n`));
          structErrors.forEach(e => console.error(chalk.red(`  ${e}`)));
          console.error('');
          process.exit(1);
        }
      }

      saveContract(name, contract);

      console.log(chalk.green(`\n  Contract '${name}' saved`));
      console.log(chalk.dim(`  ~/.schemalock/contracts/${name}.yaml`));
      console.log(`\n  Format:   ${contract.output.format}`);
      if (contract.output.must_contain?.length) {
        console.log(`  Required: ${contract.output.must_contain.join(', ')}`);
      }
      if (contract.output.schema) {
        console.log(`  Schema:   ${Object.keys(contract.output.schema.properties || {}).length} properties`);
      }
      console.log(`  Cases:    ${contract.testCases.length}`);

      if (contract.testCases.length === 0) {
        console.log(chalk.yellow(`\n  No test cases yet - add them with:`));
        console.log(chalk.dim(`    schemalock define ${name} --cases cases.json --overwrite\n`));
      } else {
        console.log(chalk.cyan(`\n  Run tests:`));
        console.log(chalk.dim(`    schemalock test ${name} --model claude-sonnet-4-6\n`));
      }
    });
}
