import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

// Robustly extract JSON from raw LLM output.
// Tries: code fence -> direct parse -> brace-balanced extraction -> array extraction
export function parseOutput(rawOutput, format) {
  if (format !== 'json') {
    return { parsed: rawOutput.trim(), error: null };
  }

  const text = rawOutput.trim();

  // 1. JSON code fence ```json...```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try { return { parsed: JSON.parse(fenceMatch[1].trim()), error: null }; } catch { /* fall through */ }
  }

  // 2. Entire output is JSON
  try { return { parsed: JSON.parse(text), error: null }; } catch { /* fall through */ }

  // 3. Extract first balanced { ... } object (avoids greedy regex bug)
  const objStart = text.indexOf('{');
  if (objStart !== -1) {
    let depth = 0;
    for (let i = objStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      if (depth === 0) {
        try { return { parsed: JSON.parse(text.slice(objStart, i + 1)), error: null }; } catch { break; }
      }
    }
  }

  // 4. Extract first balanced [ ... ] array
  const arrStart = text.indexOf('[');
  if (arrStart !== -1) {
    let depth = 0;
    for (let i = arrStart; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') depth--;
      if (depth === 0) {
        try { return { parsed: JSON.parse(text.slice(arrStart, i + 1)), error: null }; } catch { break; }
      }
    }
  }

  return {
    parsed: null,
    error: `Could not extract JSON from output. Starts with: "${text.slice(0, 120)}"`,
  };
}

// Validate parsed output against a contract's schema and field rules
export function validateOutput(parsed, contract) {
  const errors = [];
  const passed = [];
  const output = contract?.output;

  if (!output) return { errors, passed, valid: true };

  // 1. JSON Schema (AJV) - H7: include actual failing value in error message
  if (output.schema && parsed !== null && typeof parsed === 'object') {
    const validate = ajv.compile(output.schema);
    if (validate(parsed)) {
      passed.push({ rule: 'json_schema', message: 'Output matches JSON schema' });
    } else {
      (validate.errors || []).forEach(err => {
        errors.push({ rule: 'json_schema', message: formatAjvError(err, parsed) });
      });
    }
  }

  // 2. must_contain fields (JSON objects only)
  if (Array.isArray(output.must_contain) && parsed && typeof parsed === 'object') {
    output.must_contain.forEach(field => {
      if (parsed[field] !== undefined && parsed[field] !== null) {
        passed.push({ rule: 'must_contain', message: `Field '${field}' present` });
      } else {
        errors.push({ rule: 'must_contain', message: `Required field '${field}' is missing or null` });
      }
    });
  }

  // 3. must_not_contain phrases (text/markdown outputs)
  if (Array.isArray(output.must_not_contain) && typeof parsed === 'string') {
    output.must_not_contain.forEach(phrase => {
      if (!parsed.toLowerCase().includes(phrase.toLowerCase())) {
        passed.push({ rule: 'must_not_contain', message: `Output does not contain banned phrase: '${phrase}'` });
      } else {
        errors.push({ rule: 'must_not_contain', message: `Output contains banned phrase: '${phrase}'` });
      }
    });
  }

  return { errors, passed, valid: errors.length === 0 };
}

// H7: Build a human-readable AJV error message that includes the actual failing value
function formatAjvError(err, parsed) {
  const path = err.instancePath || '(root)';
  let actualVal = parsed;
  if (err.instancePath) {
    try {
      for (const seg of err.instancePath.replace(/^\//, '').split('/')) {
        actualVal = actualVal?.[seg];
      }
    } catch {
      actualVal = undefined;
    }
  }
  const actualStr = actualVal === undefined ? 'missing' : JSON.stringify(actualVal).slice(0, 80);
  return `${path} ${err.message} (got: ${actualStr})`;
}

// C1: Validate test case expected values against the contract's JSON schema.
// Catches malformed expected values (e.g. string "100" when schema says number).
// Returns warnings (not errors) because expected is often a partial subset of output.
export function validateExpected(cases, contract) {
  const warnings = [];
  if (!contract?.output?.schema?.properties) return warnings;
  const schemaProps = contract.output.schema.properties;

  cases.forEach((c, i) => {
    if (!c.expected || typeof c.expected !== 'object') return;
    const label = c.id ? `case '${c.id}'` : `case #${i + 1}`;

    Object.entries(c.expected).forEach(([key, val]) => {
      const propSchema = schemaProps[key];
      if (!propSchema) return; // Field not in schema - allow

      const expectedTypes = [].concat(propSchema.type || []);
      if (expectedTypes.length === 0) return;

      const jsType    = Array.isArray(val) ? 'array' : val === null ? 'null' : typeof val;
      const typeMatch = expectedTypes.some(t => {
        if (t === 'integer') return Number.isInteger(val);
        if (t === 'null')    return val === null;
        return t === jsType;
      });

      if (!typeMatch) {
        warnings.push(
          `${label}: expected.${key} is ${JSON.stringify(val)} (${jsType}) ` +
          `but schema declares type '${expectedTypes.join('|')}' - this assertion may never pass.`,
        );
      }
    });
  });
  return warnings;
}

// Compare parsed output against expected values from a test case.
// Uses float tolerance so 0.1+0.2 == 0.3 passes (0.01% relative tolerance).
export function compareToExpected(parsed, expected) {
  if (!expected || parsed === null || typeof parsed !== 'object') {
    return { matches: [], mismatches: [] };
  }
  const matches    = [];
  const mismatches = [];
  Object.entries(expected).forEach(([key, expectedVal]) => {
    const actualVal = parsed[key];
    if (valuesMatch(expectedVal, actualVal)) {
      matches.push({ key, expected: expectedVal, actual: actualVal });
    } else {
      mismatches.push({ key, expected: expectedVal, actual: actualVal });
    }
  });
  return { matches, mismatches };
}

function valuesMatch(expected, actual) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (expected === 0) return actual === 0;
    return Math.abs(expected - actual) / Math.abs(expected) < 0.0001;
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}
