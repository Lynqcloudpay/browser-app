/**
 * Runs every test file in its own process (each one has its own temp storage) and prints a summary.
 *   npx tsx tests/run-all.ts
 */
import { spawnSync } from 'child_process';
import path from 'path';

const REPO = path.resolve(__dirname, '..');
const TSX_CLI = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const TESTS = ['channels.test.ts', 'qa.test.ts', 'api.test.ts', 'library.test.ts'];

const results: Array<{ file: string; ok: boolean; code: number | null }> = [];

for (const file of TESTS) {
  console.log(`\n=== ${file} ===`);
  const run = spawnSync(process.execPath, [TSX_CLI, path.join(__dirname, file)], {
    cwd: REPO,
    stdio: 'inherit',
    env: process.env,
    timeout: 120_000,
  });
  results.push({ file, ok: run.status === 0, code: run.status });
}

console.log('\n=== Summary ===');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}${r.ok ? '' : ` (exit ${r.code})`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `All ${results.length} test files passed.` : `${failed} of ${results.length} test files failed.`);
process.exit(failed === 0 ? 0 : 1);
