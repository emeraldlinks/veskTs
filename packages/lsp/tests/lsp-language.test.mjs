// LSP language-fix tests — run against the SOURCE server (tsx), no bundle
// rebuild needed. Covers:
//   1. ES/DOM lib resolution: `Error`, `console`, `Promise` must never be
//      TS2304, even when the workspace tsconfig omits them from `lib`.
//   2. Tag completion at `<`: intrinsic HTML elements + vesk plugin items.
//   3. No Node.js global noise (Buffer/process/require) in completions.
//   4. Auto-insert (tag auto-close) via the volar/client/autoInsert request:
//      plain tags, quoted attributes, multi-line tags, void elements,
//      self-closing tags, component tags, '>' inside expressions.
//   5. Fatal-mode retention: while a transient parse error exists, the last
//      good virtual code keeps serving sane completions and the compile
//      error is still published.
//
// Usage: node packages/lsp/tests/lsp-language.test.mjs

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const SERVER_ENTRY = resolve(repoRoot, 'packages/lsp/src/bin.ts');
const BASIC = resolve(repoRoot, 'packages/lsp/tests/fixtures/basic');
const LIBS_DOM = resolve(repoRoot, 'packages/lsp/tests/fixtures/libs-dom');

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

/** absolute char offset -> LSP position */
function toPos(text, offset) {
  const upto = text.slice(0, offset);
  return {
    line: upto.split('\n').length - 1,
    character: offset - (upto.lastIndexOf('\n') + 1),
  };
}

class Session {
  constructor(root, label) {
    this.label = label;
    this.child = spawn('npx', ['tsx', SERVER_ENTRY, '--stdio'], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VESK_LSP_DEBUG: process.env.VESK_LSP_DEBUG ?? '' },
    });
    this.buf = Buffer.alloc(0);
    this.len = -1;
    this.pending = new Map();
    this.nextId = 1;
    this.diagnostics = new Map();
    this.logs = [];
    this.stderr = '';
    this.child.stdout.on('data', (d) => this.#onData(d));
    this.child.stderr.on('data', (d) => { this.stderr += d.toString(); });
  }

  #onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.len === -1) {
        const h = this.buf.indexOf('\r\n\r\n');
        if (h === -1) return;
        const m = /Content-Length:\s*(\d+)/i.exec(this.buf.slice(0, h).toString());
        if (!m) { this.buf = this.buf.slice(h + 4); continue; }
        this.len = parseInt(m[1], 10);
        this.buf = this.buf.slice(h + 4);
      }
      if (this.buf.length < this.len) return;
      let msg;
      try { msg = JSON.parse(this.buf.slice(0, this.len).toString()); } catch { /* skip */ }
      this.buf = this.buf.slice(this.len);
      this.len = -1;
      if (!msg) continue;
      if (msg.method === 'textDocument/publishDiagnostics') {
        this.diagnostics.set(msg.params.uri, msg.params.diagnostics);
      }
      if (msg.method === 'window/logMessage') {
        this.logs.push(`[${msg.params.type}] ${msg.params.message}`);
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    }
  }

  request(method, params, timeoutMs = 45000) {
    return new Promise((res) => {
      const id = this.nextId++;
      const t = setTimeout(() => {
        console.error(`TIMEOUT waiting for ${method} (${this.label})`);
        res({ error: { message: 'timeout' }, result: null });
      }, timeoutMs);
      this.pending.set(id, (m) => { clearTimeout(t); res(m); });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
    });
  }

  notify(method, params) {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  }

  open(uri, text) {
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'vsk', version: 1, text },
    });
  }

  /** Apply an edit as a full-text didChange (offset-form changes are not
   *  part of the LSP protocol and the server rejects them). */
  replace(uri, version, oldText, newText, inText) {
    const start = inText.indexOf(oldText);
    if (start === -1) {
      throw new Error(`replace(): oldText not found in doc (${this.label})`);
    }
    const text = inText.slice(0, start) + newText + inText.slice(start + oldText.length);
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  async completion(uri, position) {
    const r = await this.request('textDocument/completion', { textDocument: { uri }, position });
    const list = r?.result;
    return Array.isArray(list) ? list.map((i) => i.label) : (list?.items ?? []).map((i) => i.label);
  }

  /** Simulate typing `typed` whose caret ends at caretOffset (post-change doc). */
  async autoInsert(uri, docText, caretOffset, typed = '>') {
    const r = await this.request('volar/client/autoInsert', {
      textDocument: { uri },
      selection: toPos(docText, caretOffset),
      change: { rangeOffset: caretOffset - typed.length, rangeLength: 0, text: typed },
    });
    return r?.result ?? null;
  }

  diagFor(uri) {
    return this.diagnostics.get(uri) ?? [];
  }

  /** Poll until a diagnostic matching pred arrives, or timeout. */
  async waitForDiag(uri, pred, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let found = this.diagFor(uri).filter(pred);
    while (found.length === 0 && Date.now() < deadline) {
      await sleep(500);
      found = this.diagFor(uri).filter(pred);
    }
    return found;
  }

  async close() {
    try { await this.request('shutdown', null, 10000); } catch { /* noop */ }
    this.notify('exit', null);
    this.child.kill();
    if (process.env.SHOW_STDERR === '1') {
      const tail = [...this.logs, ...this.stderr.split('\n').filter(Boolean)].slice(-50);
      console.log(`--- [${this.label}] server logs (${tail.length} lines) ---`);
      for (const line of tail) {
        console.log('   ', line.slice(0, 300));
      }
    }
  }
}

async function withSession(root, label, fn) {
  const s = new Session(root, label);
  try {
    await s.request('initialize', {
      processId: process.pid,
      rootUri: 'file://' + root,
      capabilities: {},
      initializationOptions: {},
    });
    s.notify('initialized', {});
    await fn(s);
  } finally {
    await s.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const after = (text, needle) => text.indexOf(needle) + needle.length;

const GLOBALS_DOC = `import { track } from "@vesk/runtime"

function Card(props: { title: string }) {
  <div>{props.title}</div>
}

component ErrorGlobals() {
  const &[count] = track(10)

  function boom(): number {
    try {
      console.log('x');
      const value = Promise.resolve(1);
      void value;
      return 1;
    } catch (e) {
      throw new Error((e as Error).message);
    }
  }

  <div class="wrap">
    <p>{boom()}</p>
    <p>{count}</p>
    <br />
    <Card title="x" />
    <Link href="/">home</Link>
    <p>{1 > 2}</p>
  </div>
}
`;

const AUTO_ML_OLD = '<div class="wrap">';
const AUTO_ML_NEW = '<div\n  class="wrap"\n  id="main"\n>';

async function main() {
  const only = process.env.SCENARIO ?? '';
  const run = (name) => !only || only === name;
  // ------------------------------------------------------------------
  // Scenario A: basic fixture (tsconfig without lib/target)
  // ------------------------------------------------------------------
  if (run('basic')) await withSession(BASIC, 'basic', async (s) => {
    const uri = 'file://' + resolve(BASIC, 'app/error-globals.vsk');
    s.open(uri, GLOBALS_DOC);
    s.replace(uri, 2, '', '', GLOBALS_DOC); // no-op change triggers recompile+diagnostics
    await sleep(10000);

    // 1. globals resolve
    const diags = s.diagFor(uri);
    const missingGlobals = diags.filter(
      (d) => String(d.code) === '2304' && /'(Error|console|Promise)'/.test(d.message),
    );
    assert(
      missingGlobals.length === 0,
      `no "Cannot find name" for Error/console/Promise (${missingGlobals.map((d) => d.message).join('; ') || 'clean'})\nALL DIAGS: ${diags.map((d) => `${d.range.start.line}:${d.range.start.character} ${d.code} ${String(d.message).slice(0, 90)}`).join(' || ') || '(none)'}`,
    );

    // 2. tag completion: TS intrinsics + vesk plugin items
    const tagPos = toPos(GLOBALS_DOC, after(GLOBALS_DOC, '<div c') - 4);
    const labels = await s.completion(uri, tagPos);
    assert(labels.includes('div'), `tag completion offers 'div' (got: ${labels.slice(0, 25).join(',')})`);
    assert(labels.includes('Head'), `tag completion offers vesk intrinsic 'Head'`);

    // 3. expression completion: reactive binding present, Node globals absent
    const exprPos = toPos(GLOBALS_DOC, after(GLOBALS_DOC, '{count}') - 1);
    const exprLabels = await s.completion(uri, exprPos);
    assert(exprLabels.includes('count'), 'expression completion includes reactive binding');
    assert(
      !exprLabels.includes('Buffer') && !exprLabels.includes('process') && !exprLabels.includes('require'),
      `no Node.js globals in expression completion (${exprLabels.filter((l) => /^(Buffer|process|require)$/.test(l)).join(',') || 'clean'})`,
    );

    // ---------------- auto-insert ----------------
    // a. plain tag WITH quoted attribute
    let snip = await s.autoInsert(uri, GLOBALS_DOC, after(GLOBALS_DOC, AUTO_ML_OLD));
    assert(snip === '</div>', `auto-close after <div class="wrap"> gives '</div>' (got ${JSON.stringify(snip)})`);

    // b. multi-line tag, attribute values quoted on their own lines
    s.replace(uri, 3, AUTO_ML_OLD, AUTO_ML_NEW, GLOBALS_DOC);
    await sleep(2500);
    const mlDoc = GLOBALS_DOC.replace(AUTO_ML_OLD, AUTO_ML_NEW);
    snip = await s.autoInsert(uri, mlDoc, after(mlDoc, AUTO_ML_NEW));
    assert(snip === '</div>', `multi-line tag with quotes auto-closes (got ${JSON.stringify(snip)})`);
    s.replace(uri, 4, AUTO_ML_NEW, AUTO_ML_OLD, mlDoc);
    await sleep(2000);

    // c. void element
    snip = await s.autoInsert(uri, GLOBALS_DOC, after(GLOBALS_DOC, '<br>'));
    assert(snip === null, `void element <br> does not auto-close (got ${JSON.stringify(snip)})`);

    // d. component tag (uppercase) at a JSX position closes
    snip = await s.autoInsert(uri, GLOBALS_DOC, after(GLOBALS_DOC, '<Link href="/">'));
    assert(snip === '</Link>', `component tag <Link> auto-closes (got ${JSON.stringify(snip)})`);

    // d2. component tag in a bare statement-mode body (prev context `{`)
    const compOld = '  <Link href="/">home</Link>';
    const compNew = '  <Card title="Hello"></Card>';
    const compDoc = GLOBALS_DOC.replace(compOld, compNew);
    s.replace(uri, 5, compOld, compNew, GLOBALS_DOC);
    await sleep(2500);
    snip = await s.autoInsert(uri, compDoc, after(compDoc, '<Card title="Hello">'));
    assert(snip === '</Card>', `component tag in statement body auto-closes (got ${JSON.stringify(snip)})`);
    s.replace(uri, 6, compNew, compOld, compDoc);
    await sleep(2000);

    // d3. generic-looking position does NOT close: identifier before `<`
    const genOld = '  <Link href="/">home</Link>';
    const genNew = '  const v = make<Card>(1);';
    const genericDoc = GLOBALS_DOC.replace(genOld, genNew);
    s.replace(uri, 7, genOld, genNew, GLOBALS_DOC);
    await sleep(2500);
    snip = await s.autoInsert(uri, genericDoc, after(genericDoc, '<Card'));
    assert(snip === null, `generic-argument <Card> does not auto-close (got ${JSON.stringify(snip)})`);
    s.replace(uri, 8, genNew, genOld, genericDoc);
    await sleep(2000);

    // e. self-closing '/>'
    snip = await s.autoInsert(uri, GLOBALS_DOC, after(GLOBALS_DOC, '<Card title="x" />'));
    assert(snip === null, `self-closing '/>' does not auto-close (got ${JSON.stringify(snip)})`);

    // f. '>' inside a JSX expression
    snip = await s.autoInsert(uri, GLOBALS_DOC, after(GLOBALS_DOC, '{1 >'));
    assert(snip === null, `'>' inside JSX expression does not auto-close (got ${JSON.stringify(snip)})`);
  });

  // ------------------------------------------------------------------
  // Scenario B: libs-dom fixture (tsconfig lib = DOM only, no ES lib)
  // ------------------------------------------------------------------
  if (run('libs-dom')) await withSession(LIBS_DOM, 'libs-dom', async (s) => {
    const uri = 'file://' + resolve(LIBS_DOM, 'app/page.vsk');
    const source = readFileSync(resolve(LIBS_DOM, 'app/page.vsk'), 'utf-8');
    s.open(uri, source);
    s.replace(uri, 2, '', '', source);
    await sleep(10000);

    const errDiags = s.diagFor(uri).filter(
      (d) => String(d.code) === '2584' || (String(d.code) === '2304' && /'(Error|console|Promise)'/.test(d.message)),
    );
    assert(errDiags.length === 0, `dom-only tsconfig still resolves ES globals (${errDiags.map((d) => d.message).join('; ') || 'clean'})`);

    const tagPos = toPos(source, after(source, '<div c') - 4);
    const labels = await s.completion(uri, tagPos);
    assert(labels.includes('div'), `dom-only fixture still completes tags`);
  });

  // ------------------------------------------------------------------
  // Scenario C: fatal-mode retention
  // ------------------------------------------------------------------
  if (run('fatal')) await withSession(BASIC, 'fatal-retention', async (s) => {
    const uri = 'file://' + resolve(BASIC, 'app/fatal-probe.vsk');
    const valid = `component FatalProbe() {

  <div class="wrap">
    <span>ok</span>
  </div>
}
`;
    s.open(uri, valid);
    s.replace(uri, 2, '', '', valid);
    await sleep(8000);

    // Break it mid-typing: bare `<d` appended inside the body.
    const brokenCaret = valid.length - 2; // before final '}'
    const broken = valid.slice(0, brokenCaret) + '\n  <d' + valid.slice(brokenCaret);
    s.notify('textDocument/didChange', {
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: broken }],
    });

    const parseErr = await s.waitForDiag(
      uri,
      (d) => d.code === 'vesk-parse-error',
      20000,
    );
    assert(parseErr.length > 0, `compile error still published during fatal state`);

    // Completion right after '<' of the existing div must stay sane.
    const caret = after(valid, '<');
    const labels = await s.completion(uri, toPos(valid, caret));
    assert(labels.includes('div'), `completion stays sane during fatal state (got ${labels.slice(0, 8).join(',')})`);
    assert(
      !labels.includes('Buffer') && !labels.includes('process'),
      `fatal state does not leak Node.js globals into tag completion`,
    );
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
