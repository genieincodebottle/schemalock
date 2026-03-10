import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { GLOBAL_ENV_PATH, MODELS_PATH, ensureDirs, DB_PATH } from '../utils/config.js';
import { MODELS, buildPricingTemplate } from '../utils/models.js';

// Keys schemalock knows about, in display order
const KNOWN_KEYS = [
  { key: 'ANTHROPIC_API_KEY',  provider: 'anthropic',  label: 'Anthropic'  },
  { key: 'OPENAI_API_KEY',     provider: 'openai',     label: 'OpenAI'     },
  { key: 'GROQ_API_KEY',       provider: 'groq',       label: 'Groq'       },
  { key: 'MISTRAL_API_KEY',    provider: 'mistral',    label: 'Mistral'    },
  { key: 'GOOGLE_API_KEY',     provider: 'google',     label: 'Google'     },
  { key: 'TOGETHER_API_KEY',   provider: 'together',   label: 'Together AI'},
  { key: 'FIREWORKS_API_KEY',  provider: 'fireworks',  label: 'Fireworks'  },
];

// --- Helpers ---

function readEnvFile() {
  if (!existsSync(GLOBAL_ENV_PATH)) return {};
  const lines = readFileSync(GLOBAL_ENV_PATH, 'utf-8').split('\n');
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (k) result[k] = v;
  }
  return result;
}

function writeEnvFile(entries) {
  ensureDirs();
  const lines = [
    '# schemalock global API keys',
    '# Managed by: schemalock config set <KEY> <value>',
    '',
    ...Object.entries(entries).map(([k, v]) => `${k}=${v}`),
  ];
  writeFileSync(GLOBAL_ENV_PATH, lines.join('\n') + '\n', 'utf-8');
}

function maskKey(val) {
  if (!val || val.length < 8) return '***';
  return val.slice(0, 4) + '...' + val.slice(-4);
}

// --- Command ---

export function configCommand() {
  const cmd = new Command('config')
    .description('Manage global API keys stored in ~/.schemalock/.env')
    // L3: Show help by default when no subcommand is given
    .action(() => cmd.help());

  // config set ANTHROPIC_API_KEY sk-ant-...
  cmd
    .command('set <key> <value>')
    .description('Save an API key to ~/.schemalock/.env')
    .action((key, value) => {
      const upperKey = key.toUpperCase();
      const entries  = readEnvFile();
      entries[upperKey] = value;
      writeEnvFile(entries);
      console.log(chalk.green(`\n  Saved ${upperKey} to ${GLOBAL_ENV_PATH}\n`));
      console.log(chalk.dim(`  Verify: schemalock config get ${upperKey}\n`));
    });

  // config get ANTHROPIC_API_KEY
  cmd
    .command('get <key>')
    .description('Show a stored key (masked)')
    .action((key) => {
      const upperKey = key.toUpperCase();
      // Check process.env first (shell env + .env files already loaded by cli.js)
      const val = process.env[upperKey] || readEnvFile()[upperKey];
      if (!val) {
        console.log(chalk.yellow(`\n  ${upperKey} is not set.\n`));
        console.log(chalk.dim(`  Set it: schemalock config set ${upperKey} <value>\n`));
        process.exit(1);
      }
      const source = process.env[upperKey] ? 'shell/project .env' : GLOBAL_ENV_PATH;
      console.log(chalk.bold(`\n  ${upperKey}`));
      console.log(`  Value:  ${maskKey(val)}`);
      console.log(chalk.dim(`  Source: ${source}\n`));
    });

  // config delete ANTHROPIC_API_KEY
  cmd
    .command('delete <key>')
    .alias('remove')
    .description('Remove a key from ~/.schemalock/.env')
    .action((key) => {
      const upperKey = key.toUpperCase();
      const entries  = readEnvFile();
      if (!(upperKey in entries)) {
        console.log(chalk.yellow(`\n  ${upperKey} not found in ${GLOBAL_ENV_PATH}\n`));
        return;
      }
      delete entries[upperKey];
      writeEnvFile(entries);
      console.log(chalk.green(`\n  Removed ${upperKey} from ${GLOBAL_ENV_PATH}\n`));
    });

  // config list-keys  (shows status of all known keys)
  cmd
    .command('list-keys')
    .alias('list')
    .description('Show all API keys and which providers they unlock')
    .action(() => {
      const stored = readEnvFile();

      console.log(chalk.bold('\n  API Key Status\n'));
      console.log(`  ${'Key'.padEnd(24)} ${'Provider'.padEnd(14)} Status`);
      console.log(`  ${'─'.repeat(56)}`);

      KNOWN_KEYS.forEach(({ key, label }) => {
        const val    = process.env[key] || stored[key];
        const status = val
          ? chalk.green('set  ') + chalk.dim(maskKey(val))
          : chalk.dim('not set');
        console.log(`  ${key.padEnd(24)} ${label.padEnd(14)} ${status}`);
      });

      // Show Ollama separately (no key needed)
      const ollamaModels = Object.keys(MODELS).filter(id => MODELS[id].provider === 'ollama');
      console.log(`  ${'(no key required)'.padEnd(24)} ${'Ollama'.padEnd(14)} ${chalk.green('always available')} (${ollamaModels.length} models)`);

      const configured = KNOWN_KEYS.filter(({ key }) => process.env[key] || stored[key]);
      console.log(`\n  ${configured.length}/${KNOWN_KEYS.length} providers configured.`);

      if (configured.length === 0) {
        console.log(chalk.dim('\n  Example:'));
        console.log(chalk.dim('    schemalock config set ANTHROPIC_API_KEY sk-ant-...'));
        console.log(chalk.dim('    schemalock config set GROQ_API_KEY gsk-...\n'));
      } else {
        console.log(chalk.dim(`\n  Keys stored in: ${GLOBAL_ENV_PATH}\n`));
      }
    });

  // H3: config update-pricing - writes a template models.json users can edit
  cmd
    .command('update-pricing')
    .description('Create/reset ~/.schemalock/models.json so you can edit current pricing')
    .action(() => {
      ensureDirs();
      const template = buildPricingTemplate();
      writeFileSync(MODELS_PATH, JSON.stringify(template, null, 2) + '\n', 'utf-8');
      console.log(chalk.green(`\n  Wrote pricing template to ${MODELS_PATH}`));
      console.log(`\n  Edit that file to override any price, then schemalock uses the updated rates.`);
      console.log(chalk.dim(`  Format: { "model-id": { "inputCost": 3.00, "outputCost": 15.00 } }`));
      console.log(chalk.dim(`  Prices are USD per 1M tokens.\n`));
    });

  // config env - show which env vars and config files are active
  cmd
    .command('env')
    .description('Show active configuration paths and environment variables')
    .action(() => {
      console.log(chalk.bold('\n  Active Configuration\n'));
      console.log(`  ${'Path'.padEnd(20)} Value`);
      console.log(`  ${'─'.repeat(60)}`);
      console.log(`  ${'Global dir'.padEnd(20)} ${GLOBAL_ENV_PATH.replace(/\.env$/, '')}`);
      console.log(`  ${'API keys file'.padEnd(20)} ${GLOBAL_ENV_PATH}  ${existsSync(GLOBAL_ENV_PATH) ? chalk.green('(exists)') : chalk.dim('(not created yet)')}`);
      console.log(`  ${'Pricing overrides'.padEnd(20)} ${MODELS_PATH}  ${existsSync(MODELS_PATH) ? chalk.green('(active)') : chalk.dim('(not set)')}`);
      console.log(`  ${'Database'.padEnd(20)} ${DB_PATH}`);

      const dbEnv = process.env.SCHEMALOCK_DB;
      if (dbEnv) {
        console.log(chalk.dim(`  ${''.padEnd(20)} (overridden via SCHEMALOCK_DB env var)`));
      }
      console.log('');
    });

  return cmd;
}
