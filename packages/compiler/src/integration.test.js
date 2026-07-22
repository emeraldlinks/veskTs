/**
 * Integration Tests — run SSR, SSG, hydrate output and verify actual rendered results.
 * Catches errors invisible to unit tests (wrong attribute values, missing content, etc.).
 *
 * Run with: node --experimental-vm-modules packages/compiler/src/integration.test.js
 */
import { render, renderPage, ssg } from './server-codegen.js';
import { compileClient } from './client-codegen.js';

let passed = 0;
let failed = 0;
const errors = [];

function it(name, fn) {
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
  const html = show('html', render(`component App {
    {#client}<button>ClientBtn</button>{/client}
    return <p>Always</p>;
  }`, 'App'));
  assert(!html.includes('ClientBtn'), `client block leaked: ${JSON.stringify(html)}`);
  assert(html.includes('Always'), `always content missing: ${JSON.stringify(html)}`);
});

it('renders both blocks correctly', () => {
  const html = show('html', render(`component App {
    {#server}<span>S</span>{/server}
    {#client}<span>C</span>{/client}
    return <span>B</span>;
  }`, 'App'));
  assert(html.includes('<span>S</span>'), `server block missing: ${JSON.stringify(html)}`);
  assert(!html.includes('<span>C</span>'), `client block leaked: ${JSON.stringify(html)}`);
  assert(html.includes('<span>B</span>'), `always missing: ${JSON.stringify(html)}`);
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
  const code = show('code', compileClient(`component App {
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
  const code = show('code', compileClient(`component App {
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

it('SSR with Head + server block + client block + event handler', () => {
  const source = `component Page(props) {
    <Head>
      <title>{props.title}</title>
      <meta name="desc" content={props.desc} />
    </Head>
    {#server}<nav>ServerNav</nav>{/server}
    {#client}<button onClick={() => {}}>ClientBtn</button>{/client}
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
  assert(!r.body.includes('ClientBtn'), `client block leaked: ${r.body}`);
  assert(r.body.includes('Combo'), `body title: ${r.body}`);
  assert(!r.body.includes('onClick'), `event leaked: ${r.body}`);
});

it('Client hydrate with Head + server block + client block + event', () => {
  const source = `component Page(props) {
    <Head>
      <title>{props.title}</title>
      <meta name="desc" content={props.desc} />
    </Head>
    {#server}<nav>ServerNav</nav>{/server}
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
  assert(!code.includes('ServerNav'), `server block in client: ${code.slice(300, 500)}`);
  assert(code.includes('ClientBtn'), `client block missing: ${code.slice(300, 500)}`);
  assert(code.includes('__evh_click'), `event delegation: ${code.slice(300, 500)}`);
});

it('SSG with Head + dynamic props + server/client blocks', async () => {
  const source = `component Page(props) {
    <Head>
      <title>{props.title} — SSG</title>
      <meta name="desc" content={props.desc} />
    </Head>
    {#server}<footer>SSR Footer</footer>{/server}
    {#client}<button onClick={() => {}}>Interactive</button>{/client}
    <main>
      <h1>{props.title}</h1>
      <p>{props.desc}</p>
    </main>
  }`;
  const result = show('ssg', await ssg(source, 'Page', { title: 'SSG Test', desc: 'Generated at build time' }));
  show('  .html', result.html.slice(0, 600));
  show('  .clientCode', result.clientCode.slice(0, 400));
  show('  .props', result.props);
  assert(result.html.includes('<!DOCTYPE html>'), `no doctype`);
  assert(result.html.includes('SSG Test'), `title in html: ${result.html.slice(200, 500)}`);
  assert(result.html.includes('Generated at build time'), `desc in html: ${result.html.slice(200, 500)}`);
  assert(result.html.includes('SSR Footer'), `server block: ${result.html.slice(500, 800)}`);
  assert(result.static === false, `should be non-static due to event handler`);
  assert(result.clientCode.length > 0, `should have client code`);
  assert(result.props.includes('SSG Test'), `props variable`);
});

// Summary
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
