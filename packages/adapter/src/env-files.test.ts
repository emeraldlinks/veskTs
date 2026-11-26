import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEnvWatchFile, loadEnvFiles } from '@vesk/adapter/src/env-files';

let passed = 0;
let failed = 0;

async function it(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

console.log('\n=== Env file HMR ===\n');

await it('classifies only the two loaded root env files as env watch events', () => {
  assert(isEnvWatchFile('.env'), '.env is watched');
  assert(isEnvWatchFile('.env.local'), '.env.local is watched');
  assert(isEnvWatchFile('.env.example') === false, 'nothing else is env');
  assert(isEnvWatchFile('config/.env') === false, 'nested .env is not loaded');
  assert(isEnvWatchFile('.env.production') === false, 'unloaded variant is ignored');
  assert(isEnvWatchFile('app/page.vsk') === false, 'pages are not env');
});

const dir = mkdtempSync(join(tmpdir(), 'vesk-env-files-'));
const keyA = 'VESK_ENV_TEST_A';
const keyB = 'VESK_ENV_TEST_B';
const keyInherited = 'VESK_ENV_TEST_INHERITED';
const original = {
  [keyA]: process.env[keyA],
  [keyB]: process.env[keyB],
  [keyInherited]: process.env[keyInherited],
};

try {
  await it('loads .env then .env.local with quotes stripped and comments skipped', () => {
    writeFileSync(join(dir, '.env'), ['# comment', `${keyA}=first`, `${keyB}=from-env`].join('\n'));
    writeFileSync(join(dir, '.env.local'), [`${keyA}="local"`, `${keyB}='quoted'`].join('\n'));
    loadEnvFiles(dir);
    assert(process.env[keyA] === 'local', `.env.local wins: ${process.env[keyA]}`);
    assert(process.env[keyB] === 'quoted', 'single quotes stripped');
  });

  await it('reloads changed values and removes keys deleted from the files', () => {
    writeFileSync(join(dir, '.env'), `${keyA}=second\n`);
    rmSync(join(dir, '.env.local'));
    loadEnvFiles(dir);
    assert(process.env[keyA] === 'second', `reloaded value: ${process.env[keyA]}`);
    assert(process.env[keyB] === undefined, `deleted key removed: ${process.env[keyB]}`);
  });

  await it('never overwrites or deletes an inherited process variable', () => {
    process.env[keyInherited] = 'from-shell';
    writeFileSync(join(dir, '.env'), `${keyA}=third\n${keyInherited}=from-file\n`);
    loadEnvFiles(dir);
    assert(process.env[keyInherited] === 'from-shell', 'shell value wins over the file');
    writeFileSync(join(dir, '.env'), `${keyA}=fourth\n`);
    loadEnvFiles(dir);
    assert(process.env[keyInherited] === 'from-shell', 'reload leaves the shell value intact');
  });

  await it('leaves post-load in-process overrides alone on reload', () => {
    writeFileSync(join(dir, '.env'), `${keyA}=from-file\n`);
    loadEnvFiles(dir);
    process.env[keyA] = 'from-config';
    loadEnvFiles(dir);
    assert(process.env[keyA] === 'from-config', 'config override survives reload');
    writeFileSync(join(dir, '.env'), `${keyB}=other\n`);
    loadEnvFiles(dir);
    assert(process.env[keyA] === 'from-config', 'override survives even when its file line is removed');
  });
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
