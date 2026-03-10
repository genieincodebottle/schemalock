import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import yaml from 'js-yaml';
import { CONTRACTS_DIR, ensureDirs } from '../utils/config.js';

// Only allow safe contract names - prevents path traversal attacks
const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

export function validateContractName(name) {
  if (!name || !SAFE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid contract name: '${name}'\n` +
      `  Names must be 1-63 characters: letters, digits, hyphens, underscores.\n` +
      `  Must start with a letter or digit. Example: invoice-extractor`,
    );
  }
}

export function contractPath(name) {
  validateContractName(name);
  return join(CONTRACTS_DIR, `${name}.yaml`);
}

export function contractExists(name) {
  try {
    return existsSync(contractPath(name));
  } catch {
    return false;
  }
}

export function loadContract(name) {
  const path = contractPath(name); // throws on invalid name
  if (!existsSync(path)) {
    throw new Error(
      `Contract '${name}' not found.\n` +
      `  Create it:  schemalock define ${name}\n` +
      `  List all:   schemalock list`,
    );
  }
  try {
    // CORE_SCHEMA disables dangerous YAML types (!!js/function, !!python/object, etc.)
    return yaml.load(readFileSync(path, 'utf-8'), { schema: yaml.CORE_SCHEMA }) || {};
  } catch (err) {
    throw new Error(`Contract '${name}' contains invalid YAML: ${err.message}`);
  }
}

export function saveContract(name, contract) {
  validateContractName(name);
  ensureDirs();
  contract.name      = name;
  contract.updatedAt = new Date().toISOString();
  // MEDIUM-1: Use CORE_SCHEMA on dump too - prevents injecting unsafe YAML types on save
  writeFileSync(contractPath(name), yaml.dump(contract, { schema: yaml.CORE_SCHEMA }), 'utf-8');
}

// H6: Delete a contract file. Caller is responsible for DB cleanup (deleteRunsByContract).
export function deleteContract(name) {
  const path = contractPath(name);
  if (!existsSync(path)) {
    throw new Error(
      `Contract '${name}' not found.\n` +
      `  List all: schemalock list`,
    );
  }
  unlinkSync(path);
}

export function listContracts() {
  ensureDirs();
  if (!existsSync(CONTRACTS_DIR)) return [];
  return readdirSync(CONTRACTS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace('.yaml', ''))
    .sort();
}
