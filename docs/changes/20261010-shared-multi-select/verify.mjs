// Run backend/Web builds first. Credentials are supplied only through environment variables.
// Reuses the real-page acceptance fixtures; writes generated evidence under this change.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

assert.ok(process.env.SESSION_SECRET, 'Provide an isolated SESSION_SECRET through the environment');
assert.ok(process.env.DATABASE_URL, 'Provide a fixture DATABASE_URL through the environment');
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./evidence/', import.meta.url));
const results = [];
for (const [name, script] of [
  ['transactions', '../20261010-transaction-filters/verify.mjs'],
  ['settlements', '../20261009-settlement-member-filter/verify.mjs'],
]) {
  const destination = path.join(output, name);
  await mkdir(destination, { recursive: true });
  try {
    const { stdout, stderr } = await execute(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
      cwd: root, env: { ...process.env, THUNDERLEDGER_EVIDENCE_DIR: destination }, maxBuffer: 8 * 1024 * 1024,
    });
    await writeFile(path.join(destination, 'verification.log'), stdout + stderr);
    const result = JSON.parse(await readFile(path.join(destination, 'results.json'), 'utf8'));
    results.push({ page: name, checks: result.checks });
    console.log(`${name}: passed (${result.checks.length} groups)`);
  } catch (error) {
    await writeFile(path.join(destination, 'verification.log'), String(error.stdout || '') + String(error.stderr || '') + String(error));
    throw error;
  }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, results, limitations: [
  'Synthetic database boundary; no live database or confirmed bill writes.',
  'Same-page multiple instances, disabled field/options and external v-model updates were not accepted in a browser; auxiliary fixture stopped after three failed attempts.',
] }, null, 2));
