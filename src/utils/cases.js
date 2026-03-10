// Shared utilities for test case handling - used by test.js and diff.js

// H2: Strip ANSI escape codes and non-printable characters from case IDs.
// Prevents log injection / CI output pollution from malicious test case files.
const ANSI_RE = /\x1b\[[0-9;]*[mGKHF]/g;
const CTRL_RE = /[\x00-\x1f\x7f]/g; // control characters

export function sanitizeCaseId(raw) {
  if (typeof raw !== 'string') return String(raw ?? '').slice(0, 100);
  return raw.replace(ANSI_RE, '').replace(CTRL_RE, '').trim().slice(0, 100) || 'case-unknown';
}

// M6: Warn when a test suite is unusually large - protects against runaway API spend
export const MAX_CASES_WARN = 500;
export const MAX_CASES_HARD = 10_000;

export function checkCaseCount(cases, commandName = 'test') {
  if (cases.length > MAX_CASES_HARD) {
    throw new Error(
      `Too many test cases: ${cases.length} (limit: ${MAX_CASES_HARD}).\n` +
      `  Split into smaller files and run ${commandName} multiple times.`,
    );
  }
  if (cases.length > MAX_CASES_WARN) {
    return `Warning: ${cases.length} test cases. This will make ${cases.length} API calls and may be expensive.`;
  }
  return null;
}

// Validate that each test case has the minimum required structure
export function validateCaseStructure(cases) {
  const errors = [];
  cases.forEach((c, i) => {
    const label = c.id ? `Case '${sanitizeCaseId(c.id)}'` : `Case #${i + 1}`;
    if (c.input === undefined || c.input === null) {
      errors.push(`${label}: missing required 'input' field`);
    } else if (typeof c.input !== 'string') {
      errors.push(`${label}: 'input' must be a string, got ${typeof c.input}`);
    } else if (c.input.trim() === '') {
      errors.push(`${label}: 'input' must not be empty`);
    }
  });
  return errors;
}
