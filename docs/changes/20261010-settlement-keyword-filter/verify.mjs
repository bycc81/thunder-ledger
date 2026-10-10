// Run backend and Web builds first; use isolated fixture credentials in environment variables.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

assert.ok(process.env.SESSION_SECRET, 'Provide an isolated SESSION_SECRET through the environment');
assert.ok(process.env.DATABASE_URL, 'Provide a fixture DATABASE_URL through the environment');
const output = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(output, { recursive: true });
try {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../20261009-settlement-member-filter/verify.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: { ...process.env, THUNDERLEDGER_EVIDENCE_DIR: output }, maxBuffer: 8 * 1024 * 1024,
  });
  await writeFile(new URL('./evidence/verification.log', import.meta.url), stdout + stderr);
  console.log(stdout.trim().split('\n').filter((line) => line.startsWith('API:') || line.startsWith('UI ') || line.startsWith('data-ai-id:')).join('\n'));
} catch (error) {
  await writeFile(new URL('./evidence/verification.log', import.meta.url), String(error.stdout || '') + String(error.stderr || '') + String(error));
  throw error;
}
