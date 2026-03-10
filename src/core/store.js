import Database from 'better-sqlite3';
import { DB_PATH, ensureDirs } from '../utils/config.js';

let db = null;

export function getDb() {
  if (db) return db;
  ensureDirs();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  // C2: Increased from 5s to 30s - covers slow CI machines and parallel test runs.
  // WAL mode lets readers proceed concurrently; this timeout only applies to write-write contention.
  db.pragma('busy_timeout = 30000');
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_name   TEXT    NOT NULL,
      model_id        TEXT    NOT NULL,
      run_at          TEXT    NOT NULL,
      total_cases     INTEGER DEFAULT 0,
      passed_cases    INTEGER DEFAULT 0,
      failed_cases    INTEGER DEFAULT 0,
      pass_rate       REAL    DEFAULT 0,
      total_cost_usd  REAL    DEFAULT 0,
      avg_latency_ms  REAL    DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS case_results (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id         INTEGER REFERENCES test_runs(id) ON DELETE CASCADE,
      case_id        TEXT,
      input          TEXT,
      raw_output     TEXT,
      parsed_output  TEXT,
      passed         INTEGER DEFAULT 0,
      errors         TEXT    DEFAULT '[]',
      cost_usd       REAL    DEFAULT 0,
      latency_ms     INTEGER DEFAULT 0,
      model_id       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_contract ON test_runs(contract_name, run_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cases_run     ON case_results(run_id);
  `);
}

export function saveRun({ contractName, modelId, caseResults, totalCost, avgLatency }) {
  try {
    const db     = getDb();
    const passed = caseResults.filter(r => r.passed).length;
    const total  = caseResults.length;
    const safeCost    = Number.isFinite(totalCost)  ? totalCost             : 0;
    const safeLatency = Number.isFinite(avgLatency) ? Math.round(avgLatency) : 0;

    const insertRun = db.prepare(`
      INSERT INTO test_runs
        (contract_name, model_id, run_at, total_cases, passed_cases, failed_cases, pass_rate, total_cost_usd, avg_latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCase = db.prepare(`
      INSERT INTO case_results
        (run_id, case_id, input, raw_output, parsed_output, passed, errors, cost_usd, latency_ms, model_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return db.transaction(() => {
      const info = insertRun.run(
        contractName, modelId, new Date().toISOString(),
        total, passed, total - passed,
        total > 0 ? passed / total : 0,
        safeCost, safeLatency,
      );
      caseResults.forEach(r => {
        insertCase.run(
          info.lastInsertRowid, r.caseId, r.input,
          r.rawOutput, JSON.stringify(r.parsedOutput ?? null),
          r.passed ? 1 : 0, JSON.stringify(r.errors ?? []),
          Number.isFinite(r.costUsd)   ? r.costUsd   : 0,
          Number.isFinite(r.latencyMs) ? r.latencyMs : 0,
          modelId,
        );
      });
      return info.lastInsertRowid;
    })();
  } catch (err) {
    // C2: Non-fatal but clearly surfaced - tests ran successfully, only history persistence failed.
    // On SQLite lock timeout (concurrent runs), the error message explains the cause.
    const isLock = err.message?.includes('SQLITE_BUSY') || err.message?.includes('database is locked');
    if (isLock) {
      console.error(`  Warning: Could not save run - database locked by another process. Results not persisted.`);
    } else {
      console.error(`  Warning: Could not save run to history: ${err.message}`);
    }
    return null;
  }
}

export function getRunHistory(contractName, limit = 10) {
  try {
    return getDb().prepare(`
      SELECT * FROM test_runs
      WHERE contract_name = ?
      ORDER BY run_at DESC
      LIMIT ?
    `).all(contractName, limit);
  } catch {
    return [];
  }
}

export function getRunDetails(runId) {
  try {
    const database = getDb();
    const run   = database.prepare('SELECT * FROM test_runs WHERE id = ?').get(runId);
    const cases = run
      ? database.prepare('SELECT * FROM case_results WHERE run_id = ?').all(runId)
      : [];
    return { run, cases };
  } catch {
    return { run: null, cases: [] };
  }
}

// H6: Delete all test runs for a contract (called by schemalock delete)
export function deleteRunsByContract(contractName) {
  try {
    const db  = getDb();
    const res = db.prepare('DELETE FROM test_runs WHERE contract_name = ?').run(contractName);
    return res.changes;
  } catch (err) {
    console.error(`  Warning: Could not delete run history: ${err.message}`);
    return 0;
  }
}
