// LSP end-to-end smoke test.
//
// Spawns the bundled LSP server (extension/vsk-vscode/lsp-server/index.mjs)
// over stdio and exercises the main language features against a fixture:
// initialize, diagnostics, completions, hover, signature help, document
// symbols, formatting, on-type auto-close and go-to-definition.
//
// Usage: npm run test:lsp  (builds the bundle, then runs this file)

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
let diagnostics = [];

function processMessage(msg) {
  if (msg.method === 'textDocument/publishDiagnostics') {
    diagnostics = msg.params.diagnostics;
  }
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
    } catch (e) {
      console.error('bad message:', body.slice(0, 200));
    }
  }
});

let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

function request(method, params, label) {
  return new Promise((resolvePromise) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      console.error(`TIMEOUT waiting for response to ${method}${label ? ' (' + label + ')' : ''} id=${id}`);
      process.exit(3);
    }, 5000);
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

function results(r) { return (r && r.result) || (r && r.error) || r; }

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    passed++;
    console.log(`ok: ${msg}`);
  }
}

async function main() {
  // 1. initialize
  const init = await request('initialize', {
    processId: process.pid,
    rootUri: 'file://' + FIXTURE,
    capabilities: {},
    initializationOptions: { vesk: { 'tailwind.completion': true, tagAutoClose: true } },
  });
  const caps = init.result.capabilities;
  assert(caps.completionProvider, 'completionProvider advertised');
  assert(caps.hoverProvider, 'hoverProvider advertised');
  assert(!caps.documentOnTypeFormattingProvider, 'onTypeFormatting removed (client-side autoclose now)');
  assert(caps.semanticTokensProvider, 'semantic tokens advertised');
  assert(caps.codeActionProvider, 'code actions advertised');

  notify('initialized', {});
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'vsk', version: 1, text: source },
  });
  await new Promise(r => setTimeout(r, 500));

  // 2. diagnostics
  const undef = diagnostics.filter(d => d.message.includes("Cannot find name 'undefinedVar'"));
  assert(undef.length === 1, `diagnostics flag undefinedVar (${undef.length})`);
  const noUnknownComp = diagnostics.filter(d => d.message.includes('Unknown component') && d.message.includes('Card'));
  assert(noUnknownComp.length === 0, 'Card component not flagged as unknown');
  const unusedTrack = diagnostics.filter(d => d.message.includes("Unused import: 'track'"));
  assert(unusedTrack.length === 0, `used import 'track' not flagged unused (${unusedTrack.length})`);

  // 3. attr/prop completion on <Card title=... body=...>
  const line14 = source.split('\n')[14];
  const colAfter = line14.indexOf('Card ') + 5;
  const comp = await request('textDocument/completion', {
    textDocument: { uri },
    position: pos(14, colAfter),
  });
  const labels = (results(comp) || []).map(i => i.label);
  assert(labels.includes('props'), `attr completion includes component prop 'props'`);
  assert(!labels.includes('title') && !labels.includes('body'), 'already-used attrs title/body filtered from completion');
  assert(labels.includes('onClick'), 'attr completion includes event handlers');

  // 4. expression completion inside {count}
  const line16 = source.split('\n')[16];
  const exprCol = line16.indexOf('{') + 1;
  const exprComp = await request('textDocument/completion', {
    textDocument: { uri },
    position: pos(16, exprCol),
  }, 'expression completion at {count}');
  const exprLabels = (results(exprComp) || []).map(i => i.label);
  assert(exprLabels.includes('count'), 'expression completion includes reactive binding');
  assert(exprLabels.includes('track'), 'expression completion includes imported symbol');
  assert(exprLabels.includes('props'), 'expression completion includes props param');
  assert(exprLabels.includes('console'), 'expression completion includes globals');

  // 5. hover on event handler attribute onClick
  const line15 = source.split('\n')[15];
  const onClickCol = line15.indexOf('onClick');
  const hoverEv = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(15, onClickCol + 2),
  }, 'hover onClick');
  const hoverContent = results(hoverEv)?.contents?.value || '';
  assert(/clicked/i.test(hoverContent), `hover on onClick shows docs`);

  // 6. hover on component tag Card shows inferred props
  const cardCol = line14.indexOf('Card') + 1;
  const hoverCard = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(14, cardCol),
  });
  const cardHover = results(hoverCard)?.contents?.value || '';
  assert(cardHover.includes('title') && cardHover.includes('body'), `hover on Card shows inferred props`);

  // 7. signature help on track(
  const line10 = source.split('\n')[10];
  const sigCol = line10.indexOf('track') + 6;
  const sig = await request('textDocument/signatureHelp', {
    textDocument: { uri },
    position: pos(10, sigCol),
  }, 'signature help track');
  const sigRes = results(sig);
  assert(sigRes && sigRes.signatures && sigRes.signatures.length > 0, 'signature help for track');
  assert(!!sigRes && !!sigRes.signatures && !!sigRes.signatures[0] && (sigRes.signatures[0].label || '').includes('track'), 'signature label track(value)');

  // 8. document symbols
  const syms = await request('textDocument/documentSymbol', { textDocument: { uri } });
  const symLabels = (results(syms) || []).map(s => s.name);
  assert(symLabels.includes('Card') && symLabels.includes('Home'), `document symbols (${symLabels.join(',')})`);

  // 9. formatting
  const fmt = await request('textDocument/formatting', {
    textDocument: { uri },
    options: { tabSize: 2, insertSpaces: true },
  });
  const edits = results(fmt);
  assert(Array.isArray(edits) && edits.length > 0, 'formatting returns edits');

  // 9b. formatting goes through the Prettier printer (not the indenter fallback)
  const messyUri = 'file://' + FIXTURE + '/app/messy.vsk';
  const messy = `component Messy (){\nconst  &[n] = track(1)\n\n<p> {n}  </p>\n}`;
  notify('textDocument/didOpen', {
    textDocument: { uri: messyUri, languageId: 'vsk', version: 1, text: messy },
  });
  await new Promise(r => setTimeout(r, 100));
  const fm = await request('textDocument/formatting', {
    textDocument: { uri: messyUri },
    options: { tabSize: 2, insertSpaces: true },
  }, 'format messy doc');
  const fEdits = results(fm);
  assert(Array.isArray(fEdits) && fEdits.length > 0, 'messy doc formatting returns edits');
  const expectedFmt = `component Messy {\n  const &[n] = track(1)\n\n  <p>{n}</p>\n}\n`;
  assert(fEdits[0].newText === expectedFmt, `prettier normalized output (got: ${JSON.stringify(fEdits[0].newText)})`);

  // 10. on-type formatting removed — tag auto-close is handled client-side (Emmet-style)

  // 11. go to definition for Card
  const def = await request('textDocument/definition', {
    textDocument: { uri },
    position: pos(14, cardCol),
  });
  const defRes = results(def);
  assert(!!defRes && (Array.isArray(defRes) ? defRes.length > 0 : true), 'definition for Card resolves');

  // 12. hover on HTML element <h1>
  const h1Col = source.split('\n')[13].indexOf('<h1') + 1;
  const hoverHtml = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(13, h1Col),
  }, 'hover h1');
  const htmlHover = results(hoverHtml)?.contents?.value || '';
  assert(/section heading/i.test(htmlHover), `hover on HTML element <h1> shows docs`);

  // 13. hover on reactive binding count
  const countCol = source.split('\n')[16].indexOf('{count}') + 1;
  const hoverReactive = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(16, countCol),
  }, 'hover reactive count');
  const reactiveHover = results(hoverReactive)?.contents?.value || '';
  assert(/reactive binding/i.test(reactiveHover), `hover on reactive binding count shows info`);

  // 14-15. import definition: open the imports fixture
  const impUri = 'file://' + FIXTURE + '/app/imports.vsk';
  const impSource = readFileSync(resolve(FIXTURE, 'app/imports.vsk'), 'utf-8');
  notify('textDocument/didOpen', {
    textDocument: { uri: impUri, languageId: 'vsk', version: 1, text: impSource },
  });
  await new Promise(r => setTimeout(r, 200));
  const impLine = impSource.split('\n')[0];
  const pathCol = impLine.indexOf('../lib/helpers') + 1;
  const importDef = await request('textDocument/definition', {
    textDocument: { uri: impUri },
    position: pos(0, pathCol),
  }, 'definition import path');
  const importDefRes = results(importDef);
  assert(!!importDefRes && (Array.isArray(importDefRes) ? importDefRes.length > 0 : true), 'definition on import path resolves');
  const helperCol = impLine.indexOf('helper') + 1;
  const symDef = await request('textDocument/definition', {
    textDocument: { uri: impUri },
    position: pos(0, helperCol),
  }, 'definition imported symbol');
  const symDefRes = results(symDef);
  assert(!!symDefRes && (Array.isArray(symDefRes) ? symDefRes.length > 0 : true), 'definition on imported symbol resolves');
  notify('textDocument/didClose', { textDocument: { uri: impUri } });

  // 12. hover on typed component prop shows type
  const typedLine = source.split('\n').findIndex(l => l.includes('<Typed value='));
  const typedAttrCol = source.split('\n')[typedLine].indexOf('value');
  const typedHover = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(typedLine, typedAttrCol),
  }, 'hover typed prop');
  const typedHoverText = (results(typedHover)?.contents?.value || '');
  assert(typedHoverText.includes('number'), `typed prop hover includes type (got: ${typedHoverText.slice(0, 200)})`);

  // 13. hover on interface shows declaration block
  const ifaceLine = source.split('\n').findIndex(l => l.includes('interface IFoo'));
  const ifaceHover = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(ifaceLine, source.split('\n')[ifaceLine].indexOf('IFoo')),
  }, 'hover interface');
  const ifaceText = (results(ifaceHover)?.contents?.value || '');
  assert(ifaceText.includes('interface') && ifaceText.includes('IFoo'), `interface hover shows declaration (got: ${ifaceText.slice(0, 200)})`);

  // 14. hover on reactive binding includes type
  const rCountLine = source.split('\n').findIndex(l => l.includes('<p>{count}</p>'));
  const rCountCol = source.split('\n')[rCountLine].indexOf('count');
  const countHover = await request('textDocument/hover', {
    textDocument: { uri },
    position: pos(rCountLine, rCountCol),
  }, 'hover reactive count type');
  const countText = (results(countHover)?.contents?.value || '');
  assert(countText.includes('number') || countText.includes('reactive'), `reactive hover includes type (got: ${countText.slice(0, 200)})`);

  // 15. definition on reactive binding count resolves to declaration
  const countDef = await request('textDocument/definition', {
    textDocument: { uri },
    position: pos(rCountLine, rCountCol),
  }, 'definition reactive count');
  const countDefRes = results(countDef);
  assert(!!countDefRes && (Array.isArray(countDefRes) ? countDefRes.length > 0 : true), 'definition on reactive count resolves');

  // 16. definition on imported track resolves to @vesk/runtime source
  const rTrackLine = source.split('\n').findIndex(l => /import\s*\{[^}]*\btrack\b/.test(l) && l.includes('@vesk/runtime'));
  const rTrackCol = source.split('\n')[rTrackLine].indexOf('track');
  const trackDef = await request('textDocument/definition', {
    textDocument: { uri },
    position: pos(rTrackLine, rTrackCol),
  }, 'definition track');
  const trackDefRes = results(trackDef);
  assert(!!trackDefRes && (Array.isArray(trackDefRes) ? trackDefRes.length > 0 : true), 'definition on track resolves to runtime');

  await request('shutdown', null);
  notify('exit', null);
  child.kill();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (stderr) console.error('server stderr:', stderr.slice(0, 500));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  if (stderr) console.error('server stderr:', stderr.slice(0, 2000));
  process.exit(1);
});
