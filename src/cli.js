import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createRequire } from 'module';
import { config as dotenvConfig } from 'dotenv';
import { Command } from 'commander';
import { defineCommand } from './commands/define.js';
import { testCommand }   from './commands/test.js';
import { diffCommand }   from './commands/diff.js';
import { listCommand }   from './commands/list.js';
import { reportCommand } from './commands/report.js';
import { configCommand } from './commands/config.js';
import { deleteCommand } from './commands/delete.js';

// M1/L2: Read version from package.json - stays in sync automatically on publish
const require  = createRequire(import.meta.url);
const { version } = require('../package.json');

// Load env vars in priority order (later calls with override:false never overwrite existing keys):
// 1. process.env already set in shell  - highest priority, untouched
// 2. .env in current working directory - project-level keys
// 3. ~/.schemalock/.env               - global fallback set via `schemalock config set`
dotenvConfig();
const globalEnvPath = join(homedir(), '.schemalock', '.env');
if (existsSync(globalEnvPath)) {
  dotenvConfig({ path: globalEnvPath, override: false });
}

const program = new Command();

program
  .name('schemalock')
  .description('LLM output contract testing - catch prompt regressions before production')
  .version(version);

program.addCommand(defineCommand());
program.addCommand(testCommand());
program.addCommand(diffCommand());
program.addCommand(listCommand());
program.addCommand(reportCommand());
program.addCommand(configCommand());
program.addCommand(deleteCommand());

program.parse();
