#!/usr/bin/env node

// Register global error handlers BEFORE importing anything else
process.on('unhandledRejection', (err) => {
  const msg = err?.message || String(err);
  if (msg.includes('API_KEY') || msg.includes('not set')) {
    console.error(`\nMissing API key: ${msg}`);
    console.error('  Fix: schemalock config set ANTHROPIC_API_KEY sk-ant-...');
  } else if (msg.includes('timed out')) {
    console.error(`\nRequest timed out. Check your network and try again.`);
  } else {
    console.error(`\nError: ${msg}`);
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error(`\nUnexpected error: ${err.message}`);
  process.exit(1);
});

// Dynamic import ensures error handlers above are active before any module runs
import('../src/cli.js').catch((err) => {
  console.error(`\nFailed to start schemalock: ${err.message}`);
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('  Try: npm install');
  }
  process.exit(1);
});
