/**
 * @vesk/agentic — config.test.ts
 *
 * Zero-deps, no vitest. Runnable via: npx tsx packages/agentic/src/config.test.ts
 * Throws on failure. Validates per-provider `.env.local` VK_{PROVIDER}_KEY
 * storage primitives used by the Settings→Agentic UI and the dev agent router:
 * naming helper, file write/update-in-place, read precedence, getApiKey,
 * saveApiKey (3-arg provider + legacy 2-arg), hasKey, listApiKeys.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  providerDotenvVar,
  dotenvPath,
  readDotenvValue,
  writeDotenvValue,
  getApiKey,
  saveApiKey,
  hasKey,
  listApiKeys,
  loadAgenticConfig,
  SUPPORTED_PROVIDERS,
} from './config.js';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'vsk-agentic-cfg-'));
}

console.log('\n═══ @vesk/agentic — config (.env.local keys) tests ═══\n');

// helper: pick providers not currently set in process.env to avoid contamination
const P1 = 'openai-test-probe';
const P2 = 'anthropic-test-probe';
const P1_VAR = providerDotenvVar(P1);
const P2_VAR = providerDotenvVar(P2);
delete process.env[P1_VAR];
delete process.env[P2_VAR];

// ── providerDotenvVar naming ────────────────────────────────────────────────
{
  assert(providerDotenvVar('opencode') === 'VK_OPENCODE_KEY', 'opencode → VK_OPENCODE_KEY');
  assert(providerDotenvVar('opencode-go') === 'VK_OPENCODE_GO_KEY', 'opencode-go → VK_OPENCODE_GO_KEY');
  assert(providerDotenvVar('openai') === 'VK_OPENAI_KEY', 'openai → VK_OPENAI_KEY');
  assert(providerDotenvVar('custom') === 'VK_CUSTOM_KEY', 'custom → VK_CUSTOM_KEY');
}

// ── write / read / update-in-place ─────────────────────────────────────────
{
  const dir = tempProject();
  const ok = writeDotenvValue(dir, P1_VAR, 'sk-firstKey');
  assert(ok, 'writeDotenvValue creates .env.local and returns true');
  assert(existsSync(join(dir, '.env.local')), '.env.local exists after write');
  assert(readDotenvValue(dir, P1_VAR) === 'sk-firstKey', 'readDotenvValue reads back value');
  assert(getApiKey(dir, P1) === 'sk-firstKey', 'getApiKey(provider) returns value');
  assert(hasKey(dir, P1) === true, 'hasKey(provider) true when set');

  // update in place — must not duplicate the line
  writeDotenvValue(dir, P1_VAR, 'sk-secondKey');
  const content = readFileSync(join(dir, '.env.local'), 'utf-8');
  const occurrences = content.split('\n').filter((l) => l.startsWith(`${P1_VAR}=`)).length;
  assert(occurrences === 1, 'update-in-place writes exactly one VK_*_KEY line');
  assert(getApiKey(dir, P1) === 'sk-secondKey', 'getApiKey reflects updated value');

  rmSync(dir, { recursive: true, force: true });
}

// ── saveApiKey: 3-arg (provider) + 2-arg (configured provider) ────────────
{
  const dir = tempProject();
  saveApiKey(dir, P2, 'sk-provider-key');
  assert(readDotenvValue(dir, P2_VAR) === 'sk-provider-key', 'saveApiKey(3-arg) writes VK_{PROVIDER}_KEY');
  assert(getApiKey(dir, P2) === 'sk-provider-key', 'getApiKey reads provider key after saveApiKey');

  // 2-arg legacy targets configured provider (defaults 'openai')
  saveApiKey(dir, 'sk-legacy-key');
  const legacyVar = providerDotenvVar('openai');
  assert(readDotenvValue(dir, legacyVar) === 'sk-legacy-key', 'saveApiKey(2-arg) writes configured provider key');

  rmSync(dir, { recursive: true, force: true });
}

// cleanup P1/P2 process.env remnants
delete process.env[P1_VAR];
delete process.env[P2_VAR];

// ── listApiKeys reflects set/unset per provider ────────────────────────────
{
  // clear any VK_*_KEY env vars polluted by earlier blocks (writeDotenvValue
  // mirrors into process.env)
  for (const k of Object.keys(process.env)) if (k.startsWith('VK_')) delete process.env[k];
  const dir = tempProject();
  const mapBefore = listApiKeys(dir);
  const allFalse = SUPPORTED_PROVIDERS.every((p) => mapBefore[p] === false);
  assert(typeof mapBefore === 'object' && mapBefore !== null, 'listApiKeys returns object map');
  assert(allFalse, 'listApiKeys default all false before keys set');
  saveApiKey(dir, 'opencode', 'sk-openc');
  assert(listApiKeys(dir)['opencode'] === true, 'listApiKeys marks set provider true');
  rmSync(dir, { recursive: true, force: true });
}

// ── loadAgenticConfig exposes provider + hasKey discovery ──────────────────
{
  const dir = tempProject();
  const cfg = loadAgenticConfig(dir);
  assert(typeof cfg.provider === 'string' && cfg.provider.length > 0, 'loadAgenticConfig has default provider');
  assert(typeof cfg.hasKey === 'boolean', 'loadAgenticConfig exposes hasKey boolean');
  rmSync(dir, { recursive: true, force: true });
}

// cleanup P1/P2 process.env remnants
delete process.env[P1_VAR];
delete process.env[P2_VAR];

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) throw new Error(`${failed} tests failed`);
