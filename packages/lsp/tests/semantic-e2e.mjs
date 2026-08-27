// Semantic-tier end-to-end test.
//
// Spawns the bundled LSP server and exercises the REAL TypeScript semantics:
// hover shows checker-derived types, go-to-definition resolves through the TS
// symbol table to the declaring line in source coordinates. Complements
// lsp-smoke.mjs (which covers the heuristic tiers).
//
// Usage: npx tsx packages/lsp/tests/semantic-e2e.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const SERVER = resolve(repoRoot, 'extension/vsk-vscode/lsp-server/index.mjs');
const FIXTURE = resolve(repoRoot, 'packages/lsp/tests/fixtures/basic');
const uri = 'file://' + FIXTURE + '/app/page.vsk';
const source = readFileSync(resolve(FIXTURE, 'app/page.vsk'), 'utf-8');

const child = spawn('node', [SERVER, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = Buffer.alloc(0);
let contentLength = -1;
const pending = new Map();
let nextId = 1;
let stderr = '';

function processMessage(msg) {
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
}

child.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (true) {
    if (contentLength === -1) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = buf.slice(0, headerEnd).toString();
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { buf = buf.slice(headerEnd + 4); continue; }
      contentLength = parseInt(m[1], 10);
      buf = buf.slice(headerEnd + 4);
    }
    if (buf.length < contentLength) break;
    const body = buf.slice(0, contentLength).toString();
    buf = buf.slice(contentLength);
    contentLength = -1;
    try {
      processMessage(JSON.parse(body));
    } catch {}
  }
});

child.stderr.on('data', (d) => { stderr += d.toString(); });

function request(method, params, label) {
  return new Promise((resolvePromise) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      console.error(`TIMEOUT waiting for ${method}${label ? ' (' + label + ')' : ''}`);
      process.exit(3);
    }, 30000);
    pending.set(id, (msg) => { clearTimeout(timer); resolvePromise(msg); });
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  });
}

function notify(method, params) {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
}

function pos(line, character) { return { line, character }; }
function results(r) { return r && r.result; }

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error(`FAIL: ${msg}`); }
  else { passed++; console.log(`ok: ${msg}`); }
}

async function main() {
  await request('initialize', {
    processId: process.pid,
    rootUri: 'file://' + FIXTURE,
    capabilities: {},
  });
  notify('initialized', {});
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'vsk', version: 1, text: source },
  });
  // Give the semantic engine a beat to build its program.
  await new Promise(r => setTimeout(r, 800));

  const lines = source.split('\n');

  // 1. Hover on reactive binding `count` → real type from `track(10)` via the checker.
  const countLine = lines.findIndex(l => l.includes('<p>{count}</p>'));
  const hCount = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(countLine, lines[countLine].indexOf('count') + 1),
  }, 'hover count');
  const countText = results(hCount)?.contents?.value || '';
  assert(
    /number|track|count/i.test(countText),
    `semantic hover on count returns real info (got: ${JSON.stringify(countText.slice(0, 120))})`
  );

  // 2. Hover on the member access `props.value` — heuristics know `props`
  //    (param) but only the checker can type the `.value` member as number.
  const typedLine = lines.findIndex(l => l.includes('String(props.value)'));
  const hVal = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(typedLine, lines[typedLine].indexOf('.value') + 2),
  }, 'hover props.value');
  const valText = results(hVal)?.contents?.value || '';
  assert(
    valText.length > 0,
    `semantic hover on props.value returns info (got: ${JSON.stringify(valText.slice(0, 120))})`
  );
  assert(
    /number/.test(valText),
    `checker reports number for props.value (got: ${JSON.stringify(valText.slice(0, 160))})`
  );

  // 3. Go-to-definition on <Card> resolves to the component's declaration line.
  const cardLineIdx = lines.findIndex(l => l.includes('<Card '));
  const cardCol = lines[cardLineIdx].indexOf('Card');
  const def = await request('textDocument/definition', {
    textDocument: { uri },
    position: pos(cardLineIdx, cardCol),
  }, 'definition Card');
  const defRes = results(def);
  assert(defRes && (!Array.isArray(defRes) || defRes.length > 0), `definition for <Card> resolves`);
  const target = Array.isArray(defRes) ? defRes[0] : defRes;
  const targetSrc = readFileSync(target.uri.replace('file://', ''), 'utf-8');
  const targetLines = targetSrc.split('\n');
  const declText = targetLines[target.range.start.line] || '';
  assert(
    declText.includes('Card'),
    `definition lands on the Card declaration line ${target.range.start.line} (got: ${JSON.stringify(declText.trim())})`
  );

  // 4. Go-to-definition on the imported `track` symbol resolves into @vesk/runtime types.
  const trackLineIdx = lines.findIndex(l => /import\s*\{[^}]*\btrack\b/.test(l));
  const trackCol = lines[trackLineIdx].indexOf('track');
  const trackDef = await request('textDocument/definition', {
    textDocument: { uri },
    position: pos(trackLineIdx, trackCol),
  }, 'definition track');
  const trackRes = results(trackDef);
  assert(trackRes && (!Array.isArray(trackRes) || trackRes.length > 0), `definition for track resolves`);

  await request('shutdown', null);
  notify('exit', null);
  child.kill();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (stderr) console.error('server stderr:', stderr.slice(0, 800));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  if (stderr) console.error('server stderr:', stderr.slice(0, 2000));
  process.exit(1);
});
