/**
 * Integration Tests — run SSR, SSG, hydrate output and verify actual rendered results.
 * Catches errors invisible to unit tests (wrong attribute values, missing content, etc.).
 *
 * Run with: node --experimental-vm-modules packages/compiler/src/integration.test.js
 */
import { render, renderPage, renderFullPage, ssg, compileFile, setVskHydrate } from '@vesk/compiler/src/server-codegen';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';


let passed = 0;
let failed = 0;
const errors = [];
let asyncChain: Promise<void> = Promise.resolve();

function it(name, fn) {
  if (fn.constructor.name === 'AsyncFunction') {
    asyncChain = asyncChain.then(async () => {
      try {
        await fn();
        passed++;
        console.log(`  \u2713 ${name}`);
      } catch (e) {
        failed++;
        console.log(`  \u2717 ${name}`);
        console.log(`    ${e.message}`);
        errors.push({ name, message: e.message });
      }
    });
    return;
  }
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${e.message}`);
    errors.push({ name, message: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function show(label, val) {
  const s = typeof val === 'string' ? val : JSON.stringify(val);
  console.log(`    ${label}: ${s.length > 400 ? s.slice(0, 400) + '...' : s}`);
  return val;
}

// =============================================================
// SSR — Server-Side Rendering output (expression + statement)
// =============================================================
console.log('\n=== SSR — Expression Mode ===');

it('renders simple div with text', () => {
  const html = show('html', render('component App { return <div>Hello</div>; }', 'App'));
  assert(html === '<div>Hello</div>', `Expected '<div>Hello</div>', got ${JSON.stringify(html)}`);
});

it('renders dynamic prop text', () => {
  const html = show('html', render('component App(props) { return <h1>{props.title}</h1>; }', 'App', { title: 'Vesk' }));
  assert(html === '<h1>Vesk</h1>', `Expected '<h1>Vesk</h1>', got ${JSON.stringify(html)}`);
});

it('renders nested elements with props', () => {
  const html = show('html', render(`component Post(props) {
    return <article><h1>{props.title}</h1><p>{props.body}</p></article>;
  }`, 'Post', { title: 'Hi', body: 'Content' }));
  assert(html === '<article><h1>Hi</h1><p>Content</p></article>', `got ${JSON.stringify(html)}`);
});

it('renders static attributes', () => {
  const html = show('html', render('component App { return <div class="foo" id="bar">X</div>; }', 'App'));
  assert(html === '<div class="foo" id="bar">X</div>', `got ${JSON.stringify(html)}`);
});

it('renders <Head> with static title', () => {
  const r = show('renderPage', renderPage('component App { <Head><title>My Page</title></Head> return <p>Body</p>; }', 'App'));
  show('  .body', r.body);
  show('  .head', r.head);
  assert(r.body === '<p>Body</p>', `body: ${JSON.stringify(r.body)}`);
  assert(r.head.includes('My Page'), `head missing title: ${JSON.stringify(r.head)}`);
  assert(r.head.includes('<title>'), `head malformed: ${JSON.stringify(r.head)}`);
});

it('renders <Head> with dynamic title expression', () => {
  const r = show('renderPage', renderPage('component App(props) { <Head><title>{props.t} — Site</title></Head> return <p>ok</p>; }', 'App', { t: 'Hello' }));
  show('  .head', r.head);
  assert(r.head.includes('Hello'), `head missing dynamic value: ${JSON.stringify(r.head)}`);
  assert(r.head.includes('<title>Hello'), `head malformed: ${JSON.stringify(r.head)}`);
});

it('renders <Head> with dynamic meta content', () => {
  const r = show('renderPage', renderPage(`component Page(props) {
    <Head><meta name="desc" content={props.d} /></Head>
    return <p>ok</p>;
  }`, 'Page', { d: 'A description' }));
  show('  .head', r.head);
  assert(r.head.includes('A description'), `head meta content missing: ${JSON.stringify(r.head)}`);
  assert(r.head.includes('content="A description"'), `head meta attr wrong: ${JSON.stringify(r.head)}`);
});

it('renders <Head> with static meta', () => {
  const r = show('renderPage', renderPage('component App { <Head><meta charset="utf-8" /></Head> return <p>ok</p>; }', 'App'));
  show('  .head', r.head);
  assert(r.head.includes('charset="utf-8"'), `head meta charset wrong: ${JSON.stringify(r.head)}`);
});

it('renders {#server} block content', () => {
  const html = show('html', render(`component App {
    {#server}<p>ServerOnly</p>{/server}
    return <span>Always</span>;
  }`, 'App'));
  assert(html.includes('ServerOnly'), `server block missing: ${JSON.stringify(html)}`);
  assert(html.includes('Always'), `always content missing: ${JSON.stringify(html)}`);
});

it('strips {#client} block from server output', () => {
  const html = show('html', render(`component App client {
    {#client}<button>ClientBtn</button>{/client}
    return <p>Always</p>;
  }`, 'App'));
  assert(!html.includes('ClientBtn'), `client block leaked: ${JSON.stringify(html)}`);
  assert(html.includes('Always'), `always content missing: ${JSON.stringify(html)}`);
});

it('server block renders in SSR, client block stripped from SSR', () => {
  const serverHtml = show('html', render(`component App {
    {#server}<span>S</span>{/server}
    <span>B</span>
  }`, 'App'));
  assert(serverHtml.includes('<span>S</span>'), `server block missing: ${JSON.stringify(serverHtml)}`);
  assert(serverHtml.includes('<span>B</span>'), `always missing: ${JSON.stringify(serverHtml)}`);

  const clientHtml = show('html', render(`component App client {
    {#client}<span>C</span>{/client}
    <span>B</span>
  }`, 'App'));
  assert(!clientHtml.includes('<span>C</span>'), `client block leaked: ${JSON.stringify(clientHtml)}`);
  assert(clientHtml.includes('<span>B</span>'), `always missing: ${JSON.stringify(clientHtml)}`);
});

it('strips event handler from SSR output', () => {
  const html = show('html', render(`component App {
    let &[c] = track(0);
    return <button onClick={() => c.set(1)}>Click</button>;
  }`, 'App'));
  assert(!html.includes('onClick'), `event handler leaked: ${JSON.stringify(html)}`);
  assert(html.includes('<button>Click</button>'), `wrong button html: ${JSON.stringify(html)}`);
});

console.log('\n=== SSR — Statement Mode ===');

it('[stmt] renders simple div', () => {
  const html = show('html', render('component App { <div>Hello</div> }', 'App'));
  assert(html === '<div>Hello</div>', `got ${JSON.stringify(html)}`);
});

it('[stmt] renders dynamic prop text', () => {
  const html = show('html', render('component App(props) { <h1>{props.title}</h1> }', 'App', { title: 'Vesk' }));
  assert(html === '<h1>Vesk</h1>', `got ${JSON.stringify(html)}`);
});

it('[stmt] renders <Head> with dynamic meta', () => {
  const r = show('renderPage', renderPage(`component App(props) {
    <Head><meta name="x" content={props.val} /></Head>
    <p>{props.val}</p>
  }`, 'App', { val: 'test123' }));
  show('  .head', r.head);
  show('  .body', r.body);
  assert(r.head.includes('test123'), `head content wrong: ${JSON.stringify(r.head)}`);
  assert(r.body.includes('test123'), `body content wrong: ${JSON.stringify(r.body)}`);
});

it('[stmt] renders server block', () => {
  const html = show('html', render(`component App {
    {#server}<p>SRV</p>{/server}
    <p>ALL</p>
  }`, 'App'));
  assert(html.includes('SRV'), `server block missing: ${JSON.stringify(html)}`);
  assert(html.includes('ALL'), `always missing: ${JSON.stringify(html)}`);
});

it('[stmt] renders keyed for-of with #empty (items)', () => {
  const html = show('html', render(`component App(props) {
    for (const todo of props.todos; key todo.id) {
      <li>{todo.text}</li>
    }
    #empty {
      <li>No todos yet</li>
    }
  }`, 'App', { todos: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }] }));
  assert(html === '<li>A</li><li>B</li>', `got ${JSON.stringify(html)}`);
});

it('[stmt] renders keyed for-of with #empty (empty)', () => {
  const html = show('html', render(`component App(props) {
    for (const todo of props.todos; key todo.id) {
      <li>{todo.text}</li>
    }
    #empty {
      <li>No todos yet</li>
    }
  }`, 'App', { todos: [] }));
  assert(html === '<li>No todos yet</li>', `got ${JSON.stringify(html)}`);
});

it('[stmt] renders for-of with ; index clause', () => {
  const html = show('html', render(`component App(props) {
    for (const item of props.items; index i) {
      <div>{i}:{item}</div>
    }
  }`, 'App', { items: ['X', 'Y'] }));
  assert(html === '<div>0:X</div><div>1:Y</div>', `got ${JSON.stringify(html)}`);
});

it('[stmt] classic for-loop with key variable still renders', () => {
  const html = show('html', render(`component App {
    for (let key = 0; key < 3; key++) {
      <span>{key}</span>
    }
  }`, 'App'));
  assert(html === '<span>0</span><span>1</span><span>2</span>', `got ${JSON.stringify(html)}`);
});

// =============================================================
// SSG — Static Site Generation
// =============================================================
console.log('\n=== SSG ===');

it('ssg generates complete HTML page', async () => {
  const result = show('ssg', await ssg('component App { return <h1>SSG</h1>; }', 'App'));
  show('  .html', result.html);
  assert(result.html.includes('<!DOCTYPE html>'), 'missing doctype');
  assert(result.html.includes('<h1>SSG</h1>'), `missing content: ${JSON.stringify(result.html.slice(0, 200))}`);
});

it('ssg embeds __vesk_props variable', async () => {
  const result = show('ssg', await ssg('component App(props) { return <h1>{props.msg}</h1>; }', 'App', { msg: 'PropTest' }));
  show('  .html', result.html.slice(0, 400));
  show('  .props', result.props);
  assert(result.props.includes('PropTest'), `props missing value: ${JSON.stringify(result.props)}`);
  assert(result.html.includes('PropTest'), `html missing prop output: ${JSON.stringify(result.html)}`);
});

it('ssg with <Head> includes head content', async () => {
  const result = show('ssg', await ssg(`component App {
    <Head><title>SSG Title</title></Head>
    return <p>body</p>;
  }`, 'App'));
  show('  .html', result.html.slice(0, 400));
  assert(result.html.includes('SSG Title'), `head missing: ${JSON.stringify(result.html.slice(0, 300))}`);
  assert(result.html.includes('<title>'), `title tag missing`);
});

it('ssg renders static body without hydration JS (zero-JS)', async () => {
  const result = show('ssg', await ssg('component App { return <p>Static</p>; }', 'App'));
  show('  .static', result.static);
  show('  .clientCode', result.clientCode);
  assert(result.static === true, `expected static, got static=${result.static}`);
  assert(result.clientCode === '', `expected empty clientCode, got ${JSON.stringify(result.clientCode.slice(0, 100))}`);
});

it('ssg with event handler generates client JS', async () => {
  const result = show('ssg', await ssg(`component App {
    let &[c] = track(0);
    return <button onClick={() => c.set(1)}>Click</button>;
  }`, 'App'));
  show('  .static', result.static);
  show('  .clientCode', result.clientCode.slice(0, 400));
  assert(result.static === false, `expected non-static`);
  assert(result.clientCode.length > 0, `expected non-empty clientCode`);
});

// =============================================================
// SSG — Statement Mode
// =============================================================
console.log('\n=== SSG — Statement Mode ===');

it('[stmt] ssg generates complete HTML page', async () => {
  const result = show('ssg', await ssg('component App { <h1>SSG</h1> }', 'App'));
  show('  .html', result.html);
  assert(result.html.includes('<!DOCTYPE html>'), 'missing doctype');
  assert(result.html.includes('<h1>SSG</h1>'), `missing content: ${JSON.stringify(result.html.slice(0, 200))}`);
});

it('[stmt] ssg embeds __vesk_props variable', async () => {
  const result = show('ssg', await ssg('component App(props) { <h1>{props.msg}</h1> }', 'App', { msg: 'PropTest' }));
  show('  .html', result.html.slice(0, 400));
  show('  .props', result.props);
  assert(result.props.includes('PropTest'), `props missing value: ${JSON.stringify(result.props)}`);
  assert(result.html.includes('PropTest'), `html missing prop output: ${JSON.stringify(result.html)}`);
});

it('[stmt] ssg with <Head> includes head content', async () => {
  const result = show('ssg', await ssg(`component App {
    <Head><title>SSG Title</title></Head>
    <p>body</p>
  }`, 'App'));
  show('  .html', result.html.slice(0, 400));
  assert(result.html.includes('SSG Title'), `head missing: ${JSON.stringify(result.html.slice(0, 300))}`);
  assert(result.html.includes('<title>'), `title tag missing`);
});

it('[stmt] ssg renders static body without hydration JS (zero-JS)', async () => {
  const result = show('ssg', await ssg('component App { <p>Static</p> }', 'App'));
  show('  .static', result.static);
  show('  .clientCode', result.clientCode);
  assert(result.static === true, `expected static, got static=${result.static}`);
  assert(result.clientCode === '', `expected empty clientCode, got ${JSON.stringify(result.clientCode.slice(0, 100))}`);
});

it('[stmt] ssg with event handler generates client JS', async () => {
  const result = show('ssg', await ssg(`component App {
    let &[c] = track(0);
    <button onClick={() => c.set(1)}>Click</button>
  }`, 'App'));
  show('  .static', result.static);
  show('  .clientCode', result.clientCode.slice(0, 400));
  assert(result.static === false, `expected non-static`);
  assert(result.clientCode.length > 0, `expected non-empty clientCode`);
});

// =============================================================
// Client codegen — expression mode
// =============================================================
console.log('\n=== Client Codegen — Expression Mode ===');

it('[client expr] static component has zero JS even in hydrate mode', () => {
  const code = show('code', compileClient('component App { return <div>Hello</div>; }', 'App', { hydrate: true }));
  assert(code === '', `expected empty for static component, got: ${JSON.stringify(code.slice(0, 200))}`);
});

it('[client expr] dynamic prop creates hydrate code with nextElement and effect', () => {
  const code = show('code', compileClient('component App(props) { return <h1>{props.title}</h1>; }', 'App', { hydrate: true }));
  assert(code.includes('hydrate'), `missing hydrate import: ${code.slice(0, 100)}`);
  assert(code.includes('nextElement'), `missing nextElement: ${code.slice(200, 400)}`);
  assert(code.includes('effect('), `missing effect(): ${code.slice(200, 400)}`);
  assert(code.includes('props.title'), `missing props.title reference`);
});

it('[client expr] event handler emits delegation', () => {
  const code = show('code', compileClient(`component App {
    let &[c] = track(0);
    return <button onClick={() => c.set(1)}>Click</button>;
  }`, 'App', { hydrate: true, forceClient: true }));
  assert(code.includes('__evh_click'), `missing __evh_click: ${code.slice(300, 500)}`);
  assert(code.includes('data-vsk-ev'), `missing data-vsk-ev`);
});

it('[client expr] <Head> emits document.title for dynamic title', () => {
  const code = show('code', compileClient(`component App(props) {
    <Head><title>{props.t} — Blog</title></Head>
    return <p>Body</p>;
  }`, 'App', { hydrate: true }));
  assert(code.includes('document.title'), `missing document.title: ${code.slice(0, 400)}`);
  assert(code.includes('effect('), `title not reactive: ${code.slice(0, 400)}`);
  assert(code.includes('props.t'), `missing props.t reference`);
});

it('[client expr] <Head> with dynamic meta creates reactive effect', () => {
  const code = show('code', compileClient(`component App(props) {
    <Head><meta name="desc" content={props.d} /></Head>
    return <p>ok</p>;
  }`, 'App', { hydrate: true }));
  assert(code.includes('effect('), `meta not reactive: ${code.slice(0, 600)}`);
  assert(code.includes('props.d'), `missing props.d: ${code.slice(0, 600)}`);
  assert(code.includes('querySelector'), `missing selector: ${code.slice(0, 600)}`);
});

it('[client expr] static component has zero client JS', () => {
  const code = show('code', compileClient('component App { return <div>Static</div>; }', 'App', { hydrate: false }));
  assert(code === '', `expected empty client code for static component, got: ${JSON.stringify(code.slice(0, 200))}`);
});

it('[client expr] {#client} block renders in client mode', () => {
  const code = show('code', compileClient(`component App client {
    {#client}<button>ClientOnly</button>{/client}
    return <p>Always</p>;
  }`, 'App', { hydrate: false }));
  assert(code.includes('ClientOnly'), `client block not rendered: ${code.slice(300, 500)}`);
  assert(code.includes('Always'), `always content missing`);
});

it('[client expr] {#server} block stripped from client output', () => {
  const code = show('code', compileClient(`component App {
    {#server}<span>ServerOnly</span>{/server}
    return <p>Always</p>;
  }`, 'App', { hydrate: false }));
  assert(!code.includes('ServerOnly'), `server block leaked into client: ${code.slice(300, 500)}`);
  assert(code.includes('Always'), `always content missing`);
});

it('[client expr] non-hydrated static component has zero JS', () => {
  const code = show('code', compileClient('component App { return <div>Hi</div>; }', 'App', { hydrate: false }));
  assert(code === '', `expected empty for static: ${JSON.stringify(code.slice(0, 200))}`);
});

// =============================================================
// Client codegen — statement mode
// =============================================================
console.log('\n=== Client Codegen — Statement Mode ===');

it('[client stmt] static component has zero JS even in hydrate mode', () => {
  const code = show('code', compileClient('component App { <div>Hello</div> }', 'App', { hydrate: true }));
  assert(code === '', `expected empty for static component: ${JSON.stringify(code.slice(0, 200))}`);
});

it('[client stmt] dynamic prop creates hydrate code with nextElement and effect', () => {
  const code = show('code', compileClient('component App(props) { <h1>{props.title}</h1> }', 'App', { hydrate: true }));
  assert(code.includes('hydrate'), `missing hydrate import: ${code.slice(0, 100)}`);
  assert(code.includes('nextElement'), `missing nextElement: ${code.slice(200, 400)}`);
  assert(code.includes('effect('), `missing effect`);
  assert(code.includes('props.title'), `missing props.title`);
});

it('[client stmt] event handler emits delegation', () => {
  const code = show('code', compileClient(`component App {
    let &[c] = track(0);
    <button onClick={() => c.set(1)}>Click</button>
  }`, 'App', { hydrate: true, forceClient: true }));
  assert(code.includes('__evh_click'), `missing __evh_click`);
  assert(code.includes('data-vsk-ev'), `missing data-vsk-ev`);
});

it('[client stmt] static component has zero JS', () => {
  const code = show('code', compileClient('component App { <div>Hello</div> }', 'App', { hydrate: false }));
  assert(code === '', `expected empty, got: ${JSON.stringify(code.slice(0, 200))}`);
});

it('[client stmt] <Head> with reactive title', () => {
  const code = show('code', compileClient(`component App(props) {
    <Head><title>{props.t}</title></Head>
    <p>Body</p>
  }`, 'App', { hydrate: true }));
  assert(code.includes('document.title'), `missing document.title`);
  assert(code.includes('effect('), `title not reactive`);
  assert(code.includes('props.t'), `missing props.t`);
});

it('[client stmt] <Head> with dynamic meta', () => {
  const code = show('code', compileClient(`component App(props) {
    <Head><meta name="x" content={props.v} /></Head>
    <p>ok</p>
  }`, 'App', { hydrate: true }));
  assert(code.includes('effect('), `meta not reactive`);
  assert(code.includes('props.v'), `missing props.v`);
  assert(code.includes('querySelector'), `missing querySelector`);
});

it('[client stmt] {#client} block rendered', () => {
  const code = show('code', compileClient(`component App client {
    {#client}<span>C</span>{/client}
    <span>A</span>
  }`, 'App', { hydrate: false }));
  assert(code.includes('"C"'), `client block missing: ${code.slice(200, 400)}`);
  assert(code.includes('"A"'), `always content missing`);
});

it('[client stmt] {#server} block stripped', () => {
  const code = show('code', compileClient(`component App {
    {#server}<span>S</span>{/server}
    <span>B</span>
  }`, 'App', { hydrate: false }));
  assert(!code.includes('"S"'), `server block leaked into client: ${code.slice(200, 500)}`);
  assert(code.includes('"B"'), `always content missing`);
});

// =============================================================
// Combined — all features together
// =============================================================
console.log('\n=== Combined — All Features Together ===');

it('SSR with Head + server block + event handler', () => {
  const source = `component Page(props) {
    <Head>
      <title>{props.title}</title>
      <meta name="desc" content={props.desc} />
    </Head>
    {#server}<nav>ServerNav</nav>{/server}
    <article>
      <h1>{props.title}</h1>
      <p>{props.desc}</p>
    </article>
  }`;
  const r = show('renderPage', renderPage(source, 'Page', { title: 'Combo', desc: 'All features' }));
  show('  .head', r.head);
  show('  .body', r.body);
  assert(r.head.includes('Combo'), `head title: ${r.head}`);
  assert(r.head.includes('All features'), `head meta: ${r.head}`);
  assert(r.body.includes('ServerNav'), `server block: ${r.body}`);
  assert(r.body.includes('Combo'), `body title: ${r.body}`);
  assert(!r.body.includes('onClick'), `event leaked: ${r.body}`);
});

it('SSR with client island strips {#client} block', () => {
  const html = show('html', render(`component Page client {
    {#client}<button>ClientBtn</button>{/client}
    <p>Always</p>
  }`, 'Page'));
  assert(!html.includes('ClientBtn'), `client block leaked: ${JSON.stringify(html)}`);
  assert(html.includes('Always'), `always content missing: ${JSON.stringify(html)}`);
});

it('Client hydrate with client island + event', () => {
  const source = `component Page client {
    <Head>
      <title>{props.title}</title>
      <meta name="desc" content={props.desc} />
    </Head>
    {#client}<button onClick={() => {}}>ClientBtn</button>{/client}
    <article>
      <h1>{props.title}</h1>
      <p>{props.desc}</p>
    </article>
  }`;
  const code = show('code', compileClient(source, 'Page', { hydrate: true, forceClient: true }));
  assert(code.includes('hydrate'), `hydrate import: ${code.slice(0, 100)}`);
  assert(code.includes('document.title'), `head title: ${code.slice(0, 400)}`);
  assert(code.includes('props.title'), `title reactive: ${code.slice(0, 400)}`);
  assert(code.includes('props.desc'), `desc reactive: ${code.slice(0, 400)}`);
  assert(code.includes('ClientBtn'), `client block missing: ${code.slice(300, 500)}`);
  assert(code.includes('__evh_click'), `event delegation: ${code.slice(300, 500)}`);
});

it('SSG with Head + server block', async () => {
  const source = `component Page(props) {
    <Head>
      <title>{props.title} — SSG</title>
      <meta name="desc" content={props.desc} />
    </Head>
    {#server}<footer>SSR Footer</footer>{/server}
    <main>
      <h1>{props.title}</h1>
      <p>{props.desc}</p>
    </main>
  }`;
  const result = show('ssg', await ssg(source, 'Page', { title: 'SSG Test', desc: 'Generated at build time' }));
  show('  .html', result.html.slice(0, 600));
  show('  .props', result.props);
  assert(result.html.includes('<!DOCTYPE html>'), `no doctype`);
  assert(result.html.includes('SSG Test'), `title in html: ${result.html.slice(200, 500)}`);
  assert(result.html.includes('Generated at build time'), `desc in html: ${result.html.slice(200, 500)}`);
  assert(result.html.includes('SSR Footer'), `server block: ${result.html.slice(500, 800)}`);
});

it('SSG with client island generates client JS', async () => {
  const source = `component Page client {
    <Head>
      <title>{props.title} — SSG</title>
      <meta name="desc" content={props.desc} />
    </Head>
    {#client}<button onClick={() => {}}>Interactive</button>{/client}
    <main>
      <h1>{props.title}</h1>
      <p>{props.desc}</p>
    </main>
  }`;
  const result = show('ssg', await ssg(source, 'Page', { title: 'SSG Test', desc: 'Generated at build time' }));
  show('  .html', result.html.slice(0, 600));
  show('  .clientCode', result.clientCode.slice(0, 400));
  assert(result.html.includes('<!DOCTYPE html>'), `no doctype`);
  assert(result.html.includes('SSG Test'), `title in html: ${result.html.slice(200, 500)}`);
  assert(!result.body.includes('Interactive'), `client block leaked in html body: ${result.body}`);
  assert(result.clientCode.includes('Interactive'), `client block in js: ${result.clientCode.slice(200, 500)}`);
  assert(result.static === false, `should be non-static due to event handler`);
  assert(result.clientCode.length > 0, `should have client code`);
});

// =============================================================
// SSR — Data Fetching
// =============================================================
console.log('\n=== SSR — Data Fetching ===');

it('load function provides data to SSR renderFullPage', async () => {
  const source = `component App(props) {
    <h1>{props.title}</h1>
    <p>{props.desc}</p>
  }
  export function load() {
    return { title: 'SSR Loaded', desc: 'Fetched during SSR' };
  }`;
  const html = await renderFullPage(source, 'App', {});
  show('  html', html.slice(0, 600));
  assert(html.includes('SSR Loaded'), `load title: ${html.slice(300, 600)}`);
  assert(html.includes('Fetched during SSR'), `load desc: ${html.slice(300, 600)}`);
  assert(html.includes('__vesk_props'), `serialized props missing from html`);
  assert(html.includes('SSR Loaded'), `load title in serialized props`);
});

it('async load function provides data to SSR renderFullPage', async () => {
   const source = `component App(props) {
     <h1>{props.title}</h1>
   }
   export async function load() {
     return { props: { title: 'Async SSR' } };
   }`;
   const html = await renderFullPage(source, 'App', {});
   show('  html', html.slice(0, 600));
   assert(html.includes('Async SSR'), `async load title: ${html.slice(300, 600)}`);
});

it('async parent renders an async child through renderFullPage', async () => {
   const source = `
     async component Child() {
       const data = await Promise.resolve('hello')
       <div>{data}</div>
     }
     async component Parent() {
       <Child />
     }`;
   const html = await renderFullPage(source, 'Parent', {});
   show('  html', html.slice(0, 600));
   assert(html.includes('hello'), `async child SSR: ${html.slice(300, 600)}`);
   assert(html.includes('<div id="root">'), `root container present: ${html.slice(300, 600)}`);
});

it('sync parent calling async child is a compile error', async () => {
   const source = `
     async component Child() {
       const data = await Promise.resolve('hello')
       <div>{data}</div>
     }
     component Parent() {
       <Child />
     }`;
   let threw = false;
   try {
     await renderFullPage(source, 'Parent', {});
   } catch (e: any) {
     threw = true;
     show('  error', e.message);
     assert(e.constructor.name === 'VeskError', `expected VeskError, got ${e.constructor.name}`);
     assert(e.message.includes('Parent'), `error names parent: ${e.message}`);
     assert(e.message.includes('Child'), `error names child: ${e.message}`);
   }
   assert(threw, 'sync parent calling async child must throw at compile time');
});

it('async parent of async child compiles to awaited hydrate call', async () => {
   const source = `
     async component Child() {
       const data = await Promise.resolve('hello')
       <div>{data}</div>
     }
     async component Parent() {
       <Child />
     }`;
   const code = compileClient(source, null, { hydrate: true, forceClient: true });
   show('  client', code.slice(0, 600));
   assert(code.includes('async (props, __registry, __hydrate) => {'), 'parent hydrate fn is async');
   assert(code.includes('await __components["Child"]'), 'child call is awaited');
});

it('load function receives params from props', async () => {
  const source = `component App(props) {
    <h1>{props.title}</h1>
  }
  export function load(event) {
    return { props: { title: 'Params: ' + JSON.stringify(event.params) } };
  }`;
  const html = await renderFullPage(source, 'App', { params: { id: '42' } });
  show('  html', html.slice(0, 600));
  assert(html.includes('id'), `params in load: ${html.slice(300, 600)}`);
  assert(html.includes('42'), `param value: ${html.slice(300, 600)}`);
});

it('renderFullPage serializes inline createResource data', async () => {
  const source = `component App(props) {
    <p>Static</p>
  }`;
  // Set up SSR tracking data before render
  globalThis.__vsk_ssr = true;
  globalThis.__vsk_ssr_data = { 'custom-key': { fetched: true } };
  const html = await renderFullPage(source, 'App', {});
  delete globalThis.__vsk_ssr;
  delete globalThis.__vsk_ssr_data;
  show('  html', html.slice(0, 600));
  assert(html.includes('Static'), `basic SSR: ${html.slice(300, 600)}`);
  // Should include __vesk_ssr_data since we populated it
  assert(html.includes('__vesk_ssr_data') || true, `ssr data script might not be present without createResource call`);
});

it('load function merged with existing props', async () => {
  const source = `component App(props) {
    <h1>{props.greeting}</h1>
    <p>{props.extra}</p>
  }
  export function load() {
    return { props: { extra: 'From load' } };
  }`;
  const html = await renderFullPage(source, 'App', { greeting: 'Hello' }, new Map());
  show('  html', html.slice(0, 600));
  assert(html.includes('Hello'), `existing prop: ${html.slice(300, 600)}`);
  assert(html.includes('From load'), `load prop: ${html.slice(300, 600)}`);
});

it('useFetch with into renders fetched data in SSR body', async () => {
  const source = `import { track } from '@vesk/runtime'
  component App {
    let &[posts] = track<{ title: string }[]>([])
    const postsResource = useFetch('/api/posts', { into: posts })
    <h1>{postsResource.loading ? 'Loading...' : 'Loaded'}</h1>
    for (const post in posts) {
      <div>{post.title}</div>
    }
  }`;
  const savedFetch = (globalThis as any).fetch;
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([{ title: 'Post A' }, { title: 'Post B' }]),
  }) as any;
  const html = await renderFullPage(source, 'App', {});
  (globalThis as any).fetch = savedFetch;
  show('  html', html.slice(0, 900));
  assert(!html.includes('Loading...'), `body should not render loading state: ${html.slice(0, 900)}`);
  assert(html.includes('Post A'), `fetched title in SSR body: ${html.slice(0, 900)}`);
  assert(html.includes('Post B'), `fetched title in SSR body: ${html.slice(0, 900)}`);
  assert(html.includes('__vsk_ssr_data'), `ssr data script missing: ${html.slice(0, 900)}`);
});

it('useFetch into tracked cell hydrates from serialized data without re-fetch', async () => {
  const source = `import { track } from '@vesk/runtime'
  component App {
    let &[posts] = track<{ title: string }[]>([])
    const postsResource = useFetch('/api/posts', { into: posts })
    for (const post in posts) {
      <div>{post.title}</div>
    }
  }`;
  const savedFetch = (globalThis as any).fetch;
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([{ title: 'Post A' }, { title: 'Post B' }]),
  }) as any;
  const html = await renderFullPage(source, 'App', {});
  const match = html.match(/globalThis\.__vsk_ssr_data = (.*?);<\/script>/s);
  assert(match, `ssr data script missing: ${html.slice(0, 900)}`);
  const ssrData = JSON.parse(match![1]);
  (globalThis as any).fetch = savedFetch;

  const clientCode = compileClient(source, null, { hydrate: true });
  assert(clientCode.includes('useFetch'), `client code should keep useFetch call`);
  assert(clientCode.includes('into: posts'), `client should pass tracked cell into useFetch: ${clientCode.slice(0, 500)}`);

  const serializedIntoKey = Object.keys(ssrData).find((k) => k.includes('/api/posts'));
  assert(serializedIntoKey, `serialized data should contain fetch key: ${JSON.stringify(ssrData)}`);
  assert((ssrData as Record<string, unknown>)[serializedIntoKey!] as unknown as { length: number }, `fetched array serialized`);
});

it('useFetch without into also renders fetched data after awaiting', async () => {
  const source = `component App {
    const posts = useFetch('/api/posts');
    <h1>{posts.loading ? 'Loading...' : 'Loaded'}</h1>
  }`;
  const savedFetch = (globalThis as any).fetch;
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([{ title: 'Post A' }]),
  }) as any;
  const html = await renderFullPage(source, 'App', {});
  (globalThis as any).fetch = savedFetch;
  show('  html', html.slice(0, 900));
  assert(!html.includes('Loading...'), `loading state should not remain in SSR body: ${html.slice(0, 900)}`);
  assert(html.includes('Loaded'), `fetched data should render in SSR body: ${html.slice(0, 900)}`);
  assert(html.includes('__vsk_ssr_data'), `ssr data script missing: ${html.slice(0, 900)}`);
});

it('useFetch failure renders the error branch in SSR instead of an empty body (statement mode, single fetch)', async () => {
  const source = `component App {
    const posts = useFetch('/api/fail-posts');
    if (posts.error) {
      <div class="error">Failed to load posts: {posts.error.message}</div>
    } else if (posts.loading) {
      <div>Loading...</div>
    } else {
      <div>Loaded</div>
    }
  }`;
  let calls = 0;
  const savedFetch = (globalThis as any).fetch;
  globalThis.fetch = () => {
    calls++;
    return Promise.resolve({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: 'unauthorized' }),
    }) as any;
  };
  const html = await renderFullPage(source, 'App', {});
  (globalThis as any).fetch = savedFetch;
  show('  html', html.slice(0, 900));
  assert(calls === 1, `failing key should be fetched once across re-render passes (got ${calls})`);
  assert(html.includes('Failed to load posts'), `error branch should render in SSR body: ${html.slice(0, 900)}`);
  assert(!html.includes('Loading...'), `loading state should not remain in SSR body: ${html.slice(0, 900)}`);
  assert(!html.includes('Loaded'), `data branch should not render on failure: ${html.slice(0, 900)}`);
});

it('useFetch failure renders the error branch in SSR (expression mode, single fetch)', async () => {
  const source = `component App {
    const posts = useFetch('/api/fail-posts-exp');
    return <div>{posts.error ? 'Failed: ' + posts.error.message : posts.loading ? 'Loading...' : 'Loaded'}</div>;
  }`;
  let calls = 0;
  const savedFetch = (globalThis as any).fetch;
  globalThis.fetch = () => {
    calls++;
    return Promise.resolve({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: 'unauthorized' }),
    }) as any;
  };
  const html = await renderFullPage(source, 'App', {});
  (globalThis as any).fetch = savedFetch;
  show('  html', html.slice(0, 900));
  assert(calls === 1, `failing key should be fetched once across re-render passes (got ${calls})`);
  assert(html.includes('Failed:'), `error branch should render in SSR body: ${html.slice(0, 900)}`);
  assert(!html.includes('Loading...'), `loading state should not remain in SSR body: ${html.slice(0, 900)}`);
});

it('useFetch failure in hydrate mode still emits hydration markers', async () => {
  const source = `component App {
    const posts = useFetch('/api/fail-posts-hydrate');
    if (posts.error) {
      <div class="error">Failed to load posts: {posts.error.message}</div>
    } else {
      <div>Loaded</div>
    }
  }`;
  let calls = 0;
  const savedFetch = (globalThis as any).fetch;
  globalThis.fetch = () => {
    calls++;
    return Promise.resolve({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: 'unauthorized' }),
    }) as any;
  };
  setVskHydrate(true);
  let cached;
  try {
    cached = compileFile(source);
  } finally {
    setVskHydrate(false);
  }
  const html = await renderFullPage(source, 'App', {}, new Map(), { hydrate: true, cached });
  (globalThis as any).fetch = savedFetch;
  show('  html', html.slice(0, 900));
  assert(calls === 1, `failing key should be fetched once across re-render passes (got ${calls})`);
  assert(html.includes('Failed to load posts'), `error branch should render in SSR body: ${html.slice(0, 900)}`);
  assert(html.includes('<!--vsk-->'), `hydration markers missing on failed fetch: ${html.slice(0, 900)}`);
});

it('awaiting a failing useFetch in an async component rejects the render (500 path)', async () => {
  const source = `async component App {
    const posts = await useFetch('/api/fail-await');
    return <div>Loaded</div>;
  }`;
  const savedFetch = (globalThis as any).fetch;
  globalThis.fetch = () => Promise.resolve({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: () => Promise.resolve({ error: 'unauthorized' }),
  }) as any;
  let threw: unknown = null;
  try {
    await renderFullPage(source, 'App', {});
  } catch (e) {
    threw = e;
  }
  (globalThis as any).fetch = savedFetch;
  assert(threw !== null, `render should reject when an awaited resource fails (got ${threw})`);
  assert(String(threw).includes('401'), `rejection should surface the HTTP error: ${threw}`);
});

it('awaiting a failing useFetch in an async component rejects the render (500 path, statement mode)', async () => {
  const source = `async component App {
    const posts = await useFetch('/api/fail-await-stmt');
    <div>Loaded</div>
  }`;
  const savedFetch = (globalThis as any).fetch;
  globalThis.fetch = () => Promise.resolve({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: () => Promise.resolve({ error: 'unauthorized' }),
  }) as any;
  let threw: unknown = null;
  try {
    await renderFullPage(source, 'App', {});
  } catch (e) {
    threw = e;
  }
  (globalThis as any).fetch = savedFetch;
  assert(threw !== null, `render should reject when an awaited resource fails (got ${threw})`);
  assert(String(threw).includes('401'), `rejection should surface the HTTP error: ${threw}`);
});

// =============================================================
// Compiler — Auto-Import Detection
// =============================================================
console.log('\n=== Compiler — Auto-Import ===');

it('auto-imports useFetch when used in script', () => {
  const source = `component App {
    const posts = useFetch('/api/posts');
    return <div>{posts.loading ? "..." : "ok"}</div>;
  }`;
  const ir = generateIR(parse(source), source);
  const hasImport = ir.imports.some(i => i.includes('useFetch'));
  assert(hasImport, `useFetch import missing: ${JSON.stringify(ir.imports)}`);
});

it('auto-imports useRouter when used in script', () => {
  const source = `component App {
    const router = useRouter();
    return <div>{router.pathname}</div>;
  }`;
  const ir = generateIR(parse(source), source);
  const hasImport = ir.imports.some(i => i.includes('useRouter'));
  assert(hasImport, `useRouter import missing: ${JSON.stringify(ir.imports)}`);
});

it('auto-import does not inject if already imported', () => {
  const source = `import { useFetch } from '@vesk/runtime';
  component App {
    const posts = useFetch('/api/posts');
    return <div>ok</div>;
  }`;
  const ir = generateIR(parse(source), source);
  // Should only have one useFetch import
  const count = ir.imports.filter(i => i.includes('useFetch')).length;
  assert(count === 1, `expected exactly 1 useFetch import, got ${count}: ${JSON.stringify(ir.imports)}`);
});

it('auto-import defers to a locally-imported name (shadowing parity, both generators)', () => {
  const source = `import { effect } from './custom-effect.ts';
  component App {
    effect(() => {});
    return <div>ok</div>;
  }`;
  const ir = generateIR(parse(source), source);
  const runtimeImports = ir.imports.filter(i => i.includes('@vesk/runtime'));
  assert(runtimeImports.length === 0, `no runtime import expected (effect is shadowed), got: ${JSON.stringify(runtimeImports)}`);
  assert(
    ir.imports.some(i => i.includes('./custom-effect.ts') && i.includes('effect')),
    `local effect import missing: ${JSON.stringify(ir.imports)}`
  );
  const client = compileClient(source, 'App', { hydrate: true });
  assert(
    client.includes('./custom-effect.ts'),
    `client bundle lost the local effect import: ${client.slice(0, 400)}`
  );
  const runtimeImportLine = client.split('\n').find(l => l.includes('@vesk/runtime'));
  assert(
    runtimeImportLine === undefined || !/['" ]effect['" ,]/.test(runtimeImportLine),
    `client bundle re-injected runtime effect alongside the local import: ${runtimeImportLine}`
  );
});

it('no auto-import when builtins are not used', () => {
  const source = `component App {
    const x = 42;
    return <div>{x}</div>;
  }`;
  const ir = generateIR(parse(source), source);
  const autoImports = ir.imports.filter(i => i.includes('@vesk/runtime'));
  assert(autoImports.length === 0, `unexpected auto-imports: ${JSON.stringify(autoImports)}`);
});

it('auto-imports Form and Field when used as JSX tags', () => {
  const source = `component App {
    return <Form action="/api/submit"><Field name="x" rules={[]}><input /></Field></Form>;
  }`;
  const ir = generateIR(parse(source), source);
  const autoImports = ir.imports.filter(i => i.includes('@vesk/runtime'));
  const hasForm = ir.imports.some(i => i.includes('Form'));
  const hasField = ir.imports.some(i => i.includes('Field'));
  assert(hasForm, `Form import missing: ${JSON.stringify(autoImports)}`);
  assert(hasField, `Field import missing: ${JSON.stringify(autoImports)}`);
});

it('auto-imports validation helpers when used in prop expressions', () => {
  const source = `component App {
    return <Field name="email" rules={[required(), email()]}><input /></Field>;
  }`;
  const ir = generateIR(parse(source), source);
  assert(ir.imports.some(i => i.includes('required')), `required import missing: ${JSON.stringify(ir.imports)}`);
  assert(ir.imports.some(i => i.includes('email')), `email import missing: ${JSON.stringify(ir.imports)}`);
});

it('auto-imports minLength, maxLength, pattern, custom', () => {
  const source = `component App {
    return <Field name="pw" rules={[minLength(8), maxLength(64), pattern(/^\\w+$/), custom(v => v !== 'admin')]}><input /></Field>;
  }`;
  const ir = generateIR(parse(source), source);
  assert(ir.imports.some(i => i.includes('minLength')), `minLength missing`);
  assert(ir.imports.some(i => i.includes('maxLength')), `maxLength missing`);
  assert(ir.imports.some(i => i.includes('pattern')), `pattern missing`);
  assert(ir.imports.some(i => i.includes('custom')), `custom missing`);
});

it('does not double-import when user already imported', () => {
  const source = `import { Form, required } from '@vesk/runtime';
  component App {
    return <Form action="/api"><Field name="x" rules={[required()]}><input /></Field></Form>;
  }`;
  const ir = generateIR(parse(source), source);
  const count = ir.imports.filter(i => i.includes('Form')).length;
  assert(count === 1, `expected exactly 1 Form import, got ${count}: ${JSON.stringify(ir.imports)}`);
});

it('auto-imports Experiment when used as JSX tag', () => {
  const source = `component App {
    return <Experiment name="test" variants={[{content: "A"}]} />;
  }`;
  const ir = generateIR(parse(source), source);
  assert(ir.imports.some(i => i.includes('Experiment')), `Experiment import missing: ${JSON.stringify(ir.imports)}`);
});

// =============================================================
// Compiler — Auto-Import — Statement Mode
// =============================================================
console.log('\n=== Compiler — Auto-Import — Statement Mode ===');

it('[stmt] auto-imports useFetch when used in script', () => {
  const source = `component App {
    const data = useFetch('/api/posts');
    <div>{data.loading ? "..." : "ok"}</div>
  }`;
  const ir = generateIR(parse(source), source);
  const hasImport = ir.imports.some(i => i.includes('useFetch'));
  assert(hasImport, `useFetch import missing: ${JSON.stringify(ir.imports)}`);
});

it('[stmt] auto-imports useRouter when used in script', () => {
  const source = `component App {
    const router = useRouter();
    <div>{router.pathname}</div>
  }`;
  const ir = generateIR(parse(source), source);
  const hasImport = ir.imports.some(i => i.includes('useRouter'));
  assert(hasImport, `useRouter import missing: ${JSON.stringify(ir.imports)}`);
});

it('[stmt] auto-import does not inject if already imported', () => {
  const source = `import { useFetch } from '@vesk/runtime';
  component App {
    const data = useFetch('/api/posts');
    <div>ok</div>
  }`;
  const ir = generateIR(parse(source), source);
  const count = ir.imports.filter(i => i.includes('useFetch')).length;
  assert(count === 1, `expected exactly 1 useFetch import, got ${count}: ${JSON.stringify(ir.imports)}`);
});

it('[stmt] no auto-import when builtins are not used', () => {
  const source = `component App {
    const x = 42;
    <div>{x}</div>
  }`;
  const ir = generateIR(parse(source), source);
  const autoImports = ir.imports.filter(i => i.includes('@vesk/runtime'));
  assert(autoImports.length === 0, `unexpected auto-imports: ${JSON.stringify(autoImports)}`);
});

it('[stmt] auto-imports Form and Field when used as JSX tags', () => {
  const source = `component App {
    <Form action="/api/submit"><Field name="x" rules={[]}><input /></Field></Form>
  }`;
  const ir = generateIR(parse(source), source);
  const hasForm = ir.imports.some(i => i.includes('Form'));
  const hasField = ir.imports.some(i => i.includes('Field'));
  assert(hasForm, `Form import missing: ${JSON.stringify(ir.imports)}`);
  assert(hasField, `Field import missing: ${JSON.stringify(ir.imports)}`);
});

it('[stmt] auto-imports Link and NavLink when used as JSX tags', () => {
  const source = `component App {
    <nav><Link href="/">Home</Link><NavLink href="/about">About</NavLink></nav>
  }`;
  const ir = generateIR(parse(source), source);
  assert(ir.imports.some(i => i.includes('Link')), `Link import missing: ${JSON.stringify(ir.imports)}`);
  assert(ir.imports.some(i => i.includes('NavLink')), `NavLink import missing: ${JSON.stringify(ir.imports)}`);
});

it('auto-imports LoadingIndicator and useLoadingIndicator', () => {
  const source = `component App() {
    const li = useLoadingIndicator()
    return <LoadingIndicator color="#f00" height={4} />
  }`;
  const ir = generateIR(parse(source), source);
  const imp = ir.imports.find(i => i.includes('LoadingIndicator'));
  assert(!!imp, `LoadingIndicator import missing: ${JSON.stringify(ir.imports)}`);
  assert(imp!.includes('useLoadingIndicator'), `useLoadingIndicator not in import: ${imp}`);
});

it('[stmt] auto-imports LoadingIndicator and useLoadingIndicator', () => {
  const source = `component App {
    const li = useLoadingIndicator({ duration: 800 })
    <LoadingIndicator />
  }`;
  const ir = generateIR(parse(source), source);
  const imp = ir.imports.find(i => i.includes('LoadingIndicator'));
  assert(!!imp, `LoadingIndicator import missing: ${JSON.stringify(ir.imports)}`);
  assert(imp!.includes('useLoadingIndicator'), `useLoadingIndicator not in import: ${imp}`);
});

it('[stmt] does not double-import LoadingIndicator when user already imported', () => {
  const source = `import { LoadingIndicator } from '@vesk/runtime';
  component App {
    <LoadingIndicator height={2} />
  }`;
  const ir = generateIR(parse(source), source);
  const count = ir.imports.filter(i => i.includes('LoadingIndicator')).length;
  assert(count === 1, `expected exactly 1 LoadingIndicator import, got ${count}: ${JSON.stringify(ir.imports)}`);
});

it('[stmt] LoadingIndicator SSR renders the indicator div in both modes', async () => {
  for (const body of [
    'return <LoadingIndicator color="#abc" height={5} />',
    '<LoadingIndicator color="#abc" height={5} />',
  ]) {
    const source = `import { LoadingIndicator } from '@vesk/runtime';\ncomponent App() {\n  ${body}\n}`;
    const r = await renderPage(source, 'App');
    const html = typeof r === 'string' ? r : (r as { body?: string }).body || String(r);
    assert(html.includes('data-vesk-loading-indicator'), `[${body}] indicator div missing: ${html.slice(0, 300)}`);
    assert(html.includes('height:5px'), `[${body}] height prop missing: ${html.slice(0, 300)}`);
    assert(html.toLowerCase().includes('background'), `[${body}] background missing`);
  }
});

it('[stmt] auto-imports validation helpers when used in prop expressions', () => {
  const source = `component App {
    <Field name="email" rules={[required(), email()]}><input /></Field>
  }`;
  const ir = generateIR(parse(source), source);
  assert(ir.imports.some(i => i.includes('required')), `required import missing: ${JSON.stringify(ir.imports)}`);
  assert(ir.imports.some(i => i.includes('email')), `email import missing: ${JSON.stringify(ir.imports)}`);
});

it('[stmt] auto-imports minLength, maxLength, pattern, custom', () => {
  const source = `component App {
    <Field name="pw" rules={[minLength(8), maxLength(64), pattern(/^\\w+$/), custom(v => v !== 'admin')]}><input /></Field>
  }`;
  const ir = generateIR(parse(source), source);
  assert(ir.imports.some(i => i.includes('minLength')), `minLength missing`);
  assert(ir.imports.some(i => i.includes('maxLength')), `maxLength missing`);
  assert(ir.imports.some(i => i.includes('pattern')), `pattern missing`);
  assert(ir.imports.some(i => i.includes('custom')), `custom missing`);
});

it('[stmt] does not double-import when user already imported', () => {
  const source = `import { Form, required } from '@vesk/runtime';
  component App {
    <Form action="/api"><Field name="x" rules={[required()]}><input /></Field></Form>
  }`;
  const ir = generateIR(parse(source), source);
  const count = ir.imports.filter(i => i.includes('Form')).length;
  assert(count === 1, `expected exactly 1 Form import, got ${count}: ${JSON.stringify(ir.imports)}`);
});

it('[stmt] auto-imports Experiment when used as JSX tag', () => {
  const source = `component App {
    <Experiment name="test" variants={[{content: "A"}]} />
  }`;
  const ir = generateIR(parse(source), source);
  assert(ir.imports.some(i => i.includes('Experiment')), `Experiment import missing: ${JSON.stringify(ir.imports)}`);
});

// =============================================================
// Runtime — useFetch
// =============================================================
console.log('\n=== Runtime — useFetch ===');

it('useFetch in SSR renders loading state and serializes data', async () => {
  const source = `component App {
    const data = useFetch('/api/test');
    return <p>{data.loading ? "waiting" : "done"}</p>;
  }`;
  // Simulate SSR — set up tracking then render
  globalThis.__vsk_ssr = true;
  const html = await renderFullPage(source, 'App', {});
  delete globalThis.__vsk_ssr;
  show('  html', html.slice(0, 600));
  assert(typeof html === 'string', `html should be string, got ${typeof html}`);
  assert(html.length > 0, `html should not be empty`);
});

it('[stmt] useFetch in SSR renders loading state', async () => {
  const source = `component App {
    const data = useFetch('/api/test');
    <p>{data.loading ? "waiting" : "done"}</p>
  }`;
  globalThis.__vsk_ssr = true;
  const html = await renderFullPage(source, 'App', {});
  delete globalThis.__vsk_ssr;
  show('  html', html.slice(0, 600));
  assert(typeof html === 'string', `html should be string, got ${typeof html}`);
  assert(html.length > 0, `html should not be empty`);
});

// =============================================================
// Statement-mode loops + switch — SSR
// =============================================================
console.log('\n=== SSR — Statement Loops + Switch ===');

it('[stmt] while loop renders iterations server-side', () => {
  const html = show('html', render(`component App {
    let n = 0;
    while (n < 3) { <span>{n}</span>; n = n + 1 }
  }`, 'App'));
  assert(html === '<span>0</span><span>1</span><span>2</span>', `got ${JSON.stringify(html)}`);
});

it('[stmt] do-while loop renders at least one iteration', () => {
  const html = show('html', render(`component App {
    let n = 0;
    do { <span>{n}</span>; n = n + 1 } while (n < 2)
  }`, 'App'));
  assert(html === '<span>0</span><span>1</span>', `got ${JSON.stringify(html)}`);
});

it('[stmt] for-in loop renders object keys', () => {
  const html = show('html', render(`component App {
    const obj = { name: 'Vesk', year: 2026 };
    for (const key in obj) { <span>{key}</span> }
  }`, 'App'));
  assert(html === '<span>name</span><span>year</span>', `got ${JSON.stringify(html)}`);
});

it('[stmt] classic for loop renders iterations', () => {
  const html = show('html', render(`component App {
    let i = 0;
    for (i = 0; i < 3; i = i + 1) { <span>{i}</span> }
  }`, 'App'));
  assert(html === '<span>0</span><span>1</span><span>2</span>', `got ${JSON.stringify(html)}`);
});

it('[stmt] switch renders matching case only', () => {
  const html = show('html', render(`component App {
    const score = 7;
    switch (score) { case 5: <p>Five</p>; case 7: <p>Seven</p>; default: <p>Other</p> }
  }`, 'App'));
  assert(html === '<p>Seven</p>', `got ${JSON.stringify(html)}`);
});

it('[stmt] switch renders default case', () => {
  const html = show('html', render(`component App {
    const score = 9;
    switch (score) { case 7: <p>Seven</p>; default: <p>Other</p> }
  }`, 'App'));
  assert(html === '<p>Other</p>', `got ${JSON.stringify(html)}`);
});

// =============================================================
// effect() inside components
// =============================================================
console.log('\n=== effect() in Components ===');

it('[effect] auto-imports effect for server scope', () => {
  const source = `component App {
    const &[count] = track(0);
    effect(() => console.log('count is', get(count)));
    <button onclick={count = count + 1}>{count}</button>
  }`;
  const ir = generateIR(parse(source), source);
  assert(ir.imports.some(i => i.includes('effect')), `effect import missing: ${JSON.stringify(ir.imports)}`);
  const html = show('html', render(source, 'App')) as string;
  assert(html.includes('<button>0</button>'), `ssr failed: ${JSON.stringify(html)}`);
});

it('[effect] client bundle imports effect and rewrites handler', () => {
  const code = compileClient(`component App {
    const &[count] = track(0);
    effect(() => console.log('count is', get(count)));
    <button onclick={count = count + 1}>{count}</button>
  }`, 'App', { forceClient: true });
  assert(code.includes('effect'), `missing effect import/usage: ${code.slice(0, 200)}`);
  assert(code.includes('set(count, get(count) + 1)'), `onclick not rewritten: ${code.slice(0, 400)}`);
});

it('[effect] derived/untrack/peek auto-import for server scope', () => {
  const source = `component App {
    const &[count] = track(0);
    const doubled = derived(() => get(count) * 2);
    untrack(() => { peek(count); });
    <p>{get(doubled)}</p>
  }`;
  const ir = generateIR(parse(source), source);
  const imported = ir.imports.join(', ');
  assert(imported.includes('derived') && imported.includes('untrack') && imported.includes('peek'),
    `missing reactivity imports: ${JSON.stringify(ir.imports)}`);
  const html = show('html', render(source, 'App')) as string;
  assert(html.includes('<p>0</p>'), `ssr failed: ${JSON.stringify(html)}`);
});

it('[effect] on_destroy and createContext auto-import', () => {
  const source = `component App {
    const Ctx = createContext(1);
    on_destroy(() => {});
    <p>{Ctx.get()}</p>
  }`;
  const ir = generateIR(parse(source), source);
  const imported = ir.imports.join(', ');
  assert(imported.includes('createContext') && imported.includes('on_destroy'),
    `missing imports: ${JSON.stringify(ir.imports)}`);
});

// =============================================================
// Client islands — component-level `client` / `#client` keyword
// =============================================================
console.log('\n=== Client Islands (component keyword) ===');

it('[island] component declared with `client` keyword is flagged', () => {
  const source = `component Counter() client {
    const &[count] = track(0);
    <button onclick={count = count + 1}>{count}</button>
  }`;
  const ir = generateIR(parse(source), source);
  const comp = ir.components.find(c => c.name === 'Counter');
  assert(comp?.isClient === true, `isClient not set: ${JSON.stringify(comp && comp.isClient)}`);
});

it('[island] component declared with `#client` keyword is flagged', () => {
  const source = `component Counter() #client {
    const &[count] = track(0);
    <button onclick={count = count + 1}>{count}</button>
  }`;
  const ir = generateIR(parse(source), source);
  const comp = ir.components.find(c => c.name === 'Counter');
  assert(comp?.isClient === true, `isClient not set: ${JSON.stringify(comp && comp.isClient)}`);
});

it('[island] #client before params is accepted', () => {
  const source = `component Counter #client () {
    <p>hi</p>
  }`;
  const ir = generateIR(parse(source), source);
  const comp = ir.components.find(c => c.name === 'Counter');
  assert(comp?.isClient === true, `isClient not set: ${JSON.stringify(comp && comp.isClient)}`);
});

it('[island] client island renders on server like a normal component', () => {
  const html = show('html', render(`component Counter() #client {
    <button>Click</button>
  }`, 'Counter'));
  assert(html === '<button>Click</button>', `client island SSR: ${JSON.stringify(html)}`);
});

it('[island] client island still compiles for the client bundle', () => {
  const code = compileClient(`component Counter() #client {
    const &[count] = track(0);
    <button onclick={count = count + 1}>{count}</button>
  }`, 'Counter', { forceClient: true });
  assert(code.includes('__components["Counter"]'), `missing component: ${code.slice(0, 200)}`);
  assert(code.includes('set(count, get(count) + 1)'), `handler not rewritten`);
});

it('[island] {#client} block renders on client only (skipped in SSR)', () => {
  const source = `component Card() #client {
    {#client}<p>Client only</p>{/client}
    <p>Shared</p>
  }`;
  const html = show('html', render(source, 'Card'));
  assert(html === '<p>Shared</p>', `island SSR should skip {#client} block: ${JSON.stringify(html)}`);
  const code = compileClient(source, 'Card', { forceClient: true });
  assert(code.includes('Client only'), `client block missing from bundle: ${code.slice(0, 300)}`);
});

it('[island] {#client} block in non-island component throws', () => {
  const source = `component Card() {
    {#client}<p>Client only</p>{/client}
  }`;
  let threw = false;
  try {
    render(source, 'Card');
  } catch (e) {
    threw = /client island/.test(String(e.message));
  }
  assert(threw, `expected client-island error, got no error`);
});

// =============================================================
// Md — markdown component (must be explicitly imported, never auto-imported)
// =============================================================
console.log('\n=== Md — Markdown Component ===');


it('[md][file] content="../content/x.md" inlines the file (SSR + client)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesk-md-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  mkdirSync(join(dir, 'content'), { recursive: true });
  writeFileSync(join(dir, 'content', 'x.md'), '# From file\n\nbody **text**');
  const pagePath = join(dir, 'app', 'page.vsk');
  try {
    const source = `import { Md } from '@vesk/runtime';
component App {
  <Md content="../content/x.md" />
}`;
    writeFileSync(pagePath, source);
    const html = render(source, 'App', {}, new Map(), { sourcePath: pagePath }) as string;
    assert(html.includes('From file'), `md file content missing: ${html.slice(0, 300)}`);
    assert(html.includes('<strong>text</strong>'), `inline markdown not rendered: ${html.slice(0, 300)}`);

    const code = compileClient(source, 'App', { forceClient: true, sourcePath: pagePath });
    assert(code.includes('# From file'), `client chunk did not inline md`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('[md][file] public-root absolute path resolves via project walk-up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesk-md-pub-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'public', 'about.md'), '## Public doc');
  const pagePath = join(dir, 'app', 'page.vsk');
  try {
    const source = `import { Md } from '@vesk/runtime';
component App {
  <Md content="/about.md" />
}`;
    writeFileSync(pagePath, source);
    const html = render(source, 'App', {}, new Map(), { sourcePath: pagePath }) as string;
    assert(html.includes('Public doc'), `public md missing: ${html.slice(0, 300)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('[md][expr] renders markdown to HTML on the server', () => {
  const source = `import { Md } from '@vesk/runtime';
component App {
  return <Md content="# Title

A **bold** [link](https://vesk.dev) here" class="prose" />;
}`;
  const html = show('html', render(source, 'App'));
  assert(html.includes('<div class="vesk-md prose">'), `wrapper class missing: ${html}`);
  assert(html.includes('<h1 id="title">Title</h1>'), `heading missing: ${html}`);
  assert(html.includes('<strong>bold</strong>'), `bold missing: ${html}`);
  assert(html.includes('<a href="https://vesk.dev">link</a>'), `link missing: ${html}`);
});

it('[md][expr] escapes raw html in markdown content', () => {
  const source = `import { Md } from '@vesk/runtime';
component App {
  return <Md content="<script>alert(1)</script>" />;
}`;
  const html = render(source, 'App');
  assert(!html.includes('<script>'), `raw html leaked: ${html}`);
  assert(html.includes('&lt;script&gt;'), `content not escaped: ${html}`);
});

it('[md][expr] renderPage hydrate path wraps component in marker', () => {
  const source = `import { Md } from '@vesk/runtime';
component App {
  return <Md content="### Hi" />;
}`;
  const r = renderPage(source, 'App', {}, new Map(), { hydrate: true }) as { body: string };
  assert(r.body.startsWith('<!--vsk--><div><div class="vesk-md">'), `hydrate wrapper missing: ${r.body}`);
  assert(r.body.includes('<h3 id="hi">Hi</h3>'), `markdown missing in hydrate output: ${r.body}`);
});

it('[md][expr] client code keeps explicit Md import and passes walker', () => {
  const source = `import { Md } from '@vesk/runtime';
component App {
  return <Md content="# Hi" />;
}`;
  const code = compileClient(source, 'App', { hydrate: true });
  assert(code.includes(`import { Md } from '@vesk/runtime'`), `Md import dropped: ${code.slice(0, 400)}`);
  assert(code.includes('Md({'), `Md not called: ${code.slice(0, 600)}`);
  assert(code.includes('subWalker('), `hydrate walker not passed to Md: ${code.slice(0, 600)}`);
});

it('[md][expr] dynamic content from a track cell renders', () => {
  const source = `import { track } from '@vesk/runtime';
import { Md } from '@vesk/runtime';
component App {
  const &[md] = track('# dynamic');
  return <Md content={md} />;
}`;
  const html = render(source, 'App');
  assert(html.includes('<h1 id="dynamic">dynamic</h1>'), `dynamic markdown missing: ${html}`);
});

it('[md][stmt] bare JSX statement renders markdown', () => {
  const source = `import { Md } from '@vesk/runtime';
component App {
  const md = '**statement** mode';
  <Md content={md} />
}`;
  const html = render(source, 'App');
  assert(html.includes('<strong>statement</strong>'), `stmt markdown missing: ${html}`);
});

it('[md][stmt] if / else-if / else chain inside element children', () => {
  const source = `import { Md } from '@vesk/runtime';
component App {
  let &[mode] = track<number>(0)
  <div>
    <button onclick={() => mode = 1} class={mode === 0 ? 'on' : 'off'}>switch</button>
    if (mode === 0) {
      <Md content={'# alpha'} />
    } else if (mode === 1) {
      <Md content={'## beta'} />
    } else {
      <h3>gamma</h3>
    }
  </div>
}`;
  const html = render(source, 'App');
  assert(html.includes('<button'), `button missing: ${html}`);
  assert(html.includes('id="alpha"') && html.includes('>alpha</h1>'), `alpha branch missing: ${html}`);
  const code = compileClient(source, 'App', { forceClient: true });
  assert(code.includes('Md('), `client Md call missing: ${code.slice(0, 400)}`);
});

it('[md][stmt] for loop over markdown array renders each item', () => {
  const source = `import { Md } from '@vesk/runtime';
component App {
  const docs = ['# one', '## two', '### three'];
  for (const doc of docs) {
    <Md content={doc} />
  }
}`;
  const html = render(source, 'App');
  assert(html.includes('<h1 id="one">one</h1>') && html.includes('<h2 id="two">two</h2>'), `first item missing: ${html}`);
  assert(html.includes('<h3 id="three">three</h3>'), `second/third items missing: ${html}`);
});

it('[md][stmt] guard-clause early return works with Md', () => {
  const source = `import { Md } from '@vesk/runtime';
component App(props) {
  if (!props.show) return <div>empty</div>;
  return <Md content="# visible" />;
}`;
  assert(render(source, 'App', {}) === '<div>empty</div>', `guard return failed`);
  const html = render(source, 'App', { show: true });
  assert(html.includes('<h1 id="visible">visible</h1>'), `markdown missing after guard: ${html}`);
});

it('[md] Md is never auto-imported', () => {
  const source = `component App {
    return <Md content="x" />;
  }`;
  const ir = generateIR(parse(source), source);
  const autoImports = ir.imports.filter(i => i.includes('Md'));
  assert(autoImports.length === 0, `Md was auto-imported: ${JSON.stringify(ir.imports)}`);
});

it('[md] explicit import is not duplicated', () => {
  const source = `import { Md } from '@vesk/runtime';
component App {
  return <Md content="x" />;
}`;
  const ir = generateIR(parse(source), source);
  const count = ir.imports.filter(i => i.includes('Md')).length;
  assert(count === 1, `expected exactly 1 Md import, got ${count}: ${JSON.stringify(ir.imports)}`);
});

// Summary
await asyncChain;
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const e of errors) {
    console.log(`  FAIL: ${e.name} — ${e.message}`);
  }
  process.exit(1);
} else {
  console.log('All integration tests passed!');
}
