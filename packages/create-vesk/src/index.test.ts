import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'index.js');
const temp = mkdtempSync(join(tmpdir(), 'vesk-create-'));
const project = join(temp, 'starter');

interface PackageJson {
  dependencies: Record<string, string>;
}

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok ${name}`);
  } catch (error) {
    failed++;
    console.error(`  not ok ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const result = spawnSync(process.execPath, [script, 'starter'], { cwd: temp, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);

const packageJson = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as PackageJson;
const config = readFileSync(join(project, 'vesk.config.ts'), 'utf8');
const readme = readFileSync(join(project, 'README.md'), 'utf8');

check('generated app includes @vesk/docs', () => {
  assert.equal(packageJson.dependencies['@vesk/docs'], '^0.2.109');
});

check('generated config enables docs in dev and prod', () => {
  assert.ok(config.includes("docs: {"));
  assert.ok(config.includes("dev: true"));
  assert.ok(config.includes("prod: true"));
});

check('generated config uses jwt bearer session auth', () => {
  assert.ok(config.includes("scheme: 'bearerAuth'"));
  assert.ok(config.includes("key: 'accessToken'"));
  assert.ok(config.includes("source: 'localStorage'"));
});

check('generated readme mentions api docs', () => {
  assert.ok(readme.includes('/docs'));
});

rmSync(temp, { recursive: true, force: true });
console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
