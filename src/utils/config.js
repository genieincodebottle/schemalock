import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';

export const SCHEMALOCK_DIR  = join(homedir(), '.schemalock');
export const CONTRACTS_DIR   = join(SCHEMALOCK_DIR, 'contracts');
// H5: Allow per-project or CI isolation via env var
export const DB_PATH         = process.env.SCHEMALOCK_DB || join(SCHEMALOCK_DIR, 'results.db');
export const CONFIG_PATH     = join(SCHEMALOCK_DIR, 'config.yaml');
export const GLOBAL_ENV_PATH = join(SCHEMALOCK_DIR, '.env');
// H3: Pricing overrides - users can edit this file when providers change rates
export const MODELS_PATH     = join(SCHEMALOCK_DIR, 'models.json');

export function ensureDirs() {
  [SCHEMALOCK_DIR, CONTRACTS_DIR].forEach(d => {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  });
}

export function loadConfig() {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    // CORE_SCHEMA disables dangerous YAML types (!!js/function, !!python/object, etc.)
    return yaml.load(readFileSync(CONFIG_PATH, 'utf-8'), { schema: yaml.CORE_SCHEMA }) || {};
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  ensureDirs();
  writeFileSync(CONFIG_PATH, yaml.dump(config), 'utf-8');
}
