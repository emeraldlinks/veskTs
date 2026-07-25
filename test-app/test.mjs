import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { render, renderPage, renderFullPage } = await import(
  resolve(__dirname, '../packages/compiler/src/server-codegen.js')
);
const { compileClient } = await import(
  resolve(__dirname, '../packages/compiler/src/client-codegen.js')
);

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
    console.log(`  \u2717 ${name} — ${e.message}`);
    errors.push({ name, message: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function readSource(rel) {
  return readFileSync(resolve(__dirname, 'app', rel), 'utf-8');
}

const homeSrc = readSource('page.vsk');
const aboutSrc = readSource('about/page.vsk');
const blogSrc = readSource('blog/page.vsk');
const blogPostSrc = readSource('blog/[slug]/page.vsk');
const layoutSrc = readSource('layout.vsk');

// =============================================================
console.log('\n=== PAGE RENDERING (SSR) ===');

it('about page renders', () => {
  const html = render(aboutSrc, 'About');
  assert(html.includes('About Vesk'), 'missing heading');
  assert(html.includes('compiler-first'), 'missing body text');
});

it('blog listing renders', () => {
  const html = render(blogSrc, 'Blog');
  assert(html.includes('Hello World'), 'missing post link');
  assert(html.includes('/blog/ssr-in-vesk'), 'missing href');
});

it('blog post with slug renders', () => {
  const html = render(blogPostSrc, 'BlogPost', { params: { slug: 'hello-world' } });
  assert(html.includes('Post: hello-world'), 'missing slug in heading');
  assert(html.includes('← Back to blog'), 'missing back link');
});

it('layout with children renders', () => {
  const result = renderPage(layoutSrc, 'Layout', { children: '<p>Inner</p>' });
  assert(result.body.includes('Inner'), 'missing children');
  assert(result.body.includes('Powered by Vesk'), 'missing footer');
  assert(result.body.includes('<nav'), 'missing nav');
});

// =============================================================
console.log('\n=== HOME PAGE FEATURES (broken) ===');

it('HOME: fails to parse — missing semicolon after track(10) before <h1', () => {
  try {
    render(homeSrc, 'Home');
    assert(false, 'should have failed');
  } catch (e) {
    assert(e.message.includes('Unexpected token'), 'expected parse error, got: ' + e.message);
  }
});

it('HOME: works with semicolon added (reactive state + JSX)', () => {
  const fixed = homeSrc.replace('track(10)\n', 'track(10);\n');
  const html = render(fixed, 'Home');
  assert(html.includes('Welcome to Vesk'), 'missing heading');
  assert(html.includes('Hurray 3 won'), 'if/else renders else branch');
  assert(!html.includes('2 is higher'), 'if/else skips truthy branch');
  assert(html.includes('class='), 'attributes rendered');
  assert(html.includes('+'), 'increment button rendered');
  assert(html.includes('color: red'), 'style block content');
});

// =============================================================
console.log('\n=== CONDITIONALS (if/else) ===');

it('if/else with false condition renders else branch', () => {
  const src = `component Test {
    if (2 > 3){
      <p>A</p>
    } else{
      <p>B</p>
    }
  }`;
  const html = render(src, 'Test');
  assert(html.includes('B'), 'else not rendered');
  assert(!html.includes('A'), 'if body leaked');
});

it('if/else with true condition renders if branch', () => {
  const src = `component Test {
    if (3 > 2){
      <p>A</p>
    } else{
      <p>B</p>
    }
  }`;
  const html = render(src, 'Test');
  assert(html.includes('A'), 'true branch not rendered');
  assert(!html.includes('B'), 'else body leaked');
});

it('if without else', () => {
  const src = `component Test {
    if (true){
      <p>Visible</p>
    }
    <p>Always</p>
  }`;
  const html = render(src, 'Test');
  assert(html.includes('Visible'), 'if body');
  assert(html.includes('Always'), 'after if');
});

// =============================================================
console.log('\n=== REACTIVE STATE (track) ===');

it('track with let &[] renders value', () => {
  const src = `component Test {
    let &[count] = track(42);
    <p>{count}</p>
  }`;
  const html = render(src, 'Test');
  assert(html.includes('42'), 'reactive value not rendered');
});

it('track with const &[] renders value', () => {
  const src = `component Test {
    const &[count] = track(99);
    <p>{count}</p>
  }`;
  const html = render(src, 'Test');
  assert(html.includes('99'), 'reactive value not rendered');
});

it('track with const &[] client codegen generates event delegation', () => {
  const src = `component Test {
    const &[count] = track(0);
    <button onClick={() => count.set(1)}>+</button>
  }`;
  const code = compileClient(src, 'Test', { hydrate: true, forceClient: true });
  assert(code.includes('__evh'), 'missing event delegation');
  assert(code.includes('hydrate'), 'missing hydrate');
});

// =============================================================
console.log('\n=== STYLE BLOCKS ===');

it('<style> block in SSR output', () => {
  const src = `component Test {
    <div>
      <style>.foo { color: red; } </style>
    </div>
  }`;
  const html = render(src, 'Test');
  assert(html.includes('color: red'), 'style content missing');
});

it('<style> block with class attribute', () => {
  const src = `component Test {
    <div class="wrapper">
      <style>.wrapper { color: blue; } </style>
    </div>
  }`;
  const html = render(src, 'Test');
  assert(html.includes('color: blue'), 'style content');
  assert(html.includes('wrapper'), 'class attribute');
});

// =============================================================
console.log('\n=== DYNAMIC TEXT & BINDINGS ===');

it('dynamic text via {expression}', () => {
  const src = `component Test {
    <p>{'Hello ' + 'World'}</p>
  }`;
  const html = render(src, 'Test');
  assert(html.includes('Hello World'), 'expression not evaluated');
});

it('dynamic prop attribute values', () => {
  const src = `component Test {
    let &[name] = track('Vesk');
    <h1 class={name}>{name}</h1>
  }`;
  const html = render(src, 'Test');
  assert(html.includes('Vesk'), 'dynamic value');
});

// =============================================================
console.log('\n=== EVENT HANDLERS ===');

it('onClick handler stripped from SSR but present in client', () => {
  const src = `component Test {
    let &[c] = track(0);
    <button onClick={() => c.set(1)}>Click</button>
  }`;
  const html = render(src, 'Test');
  assert(!html.includes('onClick'), 'event handler leaked into SSR');
  assert(html.includes('>Click<'), 'button text in SSR');
});

it('onClick generates event delegation in client code', () => {
  const src = `component Test {
    let &[c] = track(0);
    <button onClick={() => c.set(1)}>Click</button>
  }`;
  const code = compileClient(src, 'Test', { hydrate: true, forceClient: true });
  assert(code.includes('__evh_click'), 'missing click handler delegation');
  assert(code.includes('data-vsk-ev'), 'missing data attribute');
});

// =============================================================
console.log('\n=== CLIENT CODEGEN (hydrate + zero-JS) ===');

it('static component (about page) = zero JS', () => {
  const code = compileClient(aboutSrc, 'About', { hydrate: true });
  assert(code === '', 'about should be zero-JS');
});

it('static component (blog listing) = zero JS', () => {
  const code = compileClient(blogSrc, 'Blog', { hydrate: true });
  assert(code === '', 'blog should be zero-JS');
});

it('component with track() generates client code', () => {
  const src = `component Test {
    let &[c] = track(0);
    <p>{c}</p>
  }`;
  const code = compileClient(src, 'Test', { hydrate: true, forceClient: true });
  assert(code.length > 0, 'no client code for reactive component');
  assert(code.includes('effect('), 'missing effect()');
});

// =============================================================
console.log('\n=== LAYOUT GENERATES CLIENT CODE ===');

it('layout with NavLink generates client code (NavLink is external component)', () => {
  const code = compileClient(layoutSrc, 'Layout', { hydrate: true, forceClient: true });
  assert(code.includes('NavLink'), 'layout: should import NavLink');
  assert(code.includes('hydrate'), 'layout: should use hydrate');
  assert(!code.includes('__evh'), 'NavLink handles its own events — no inline delegation');
});

// =============================================================
console.log('\n=== DYNAMIC ROUTE (blog [slug]) ===');

it('blog post renders multiple slugs', () => {
  assert(render(blogPostSrc, 'BlogPost', { params: { slug: 'hello-world' } }).includes('hello-world'), 'slug1');
  assert(render(blogPostSrc, 'BlogPost', { params: { slug: 'ssr-in-vesk' } }).includes('ssr-in-vesk'), 'slug2');
  assert(render(blogPostSrc, 'BlogPost', { params: { slug: 'custom' } }).includes('custom'), 'slug3');
});

// =============================================================
console.log('\n=== FULL PAGE (SSG-style) ===');

it('full page with layout and inner content renders complete HTML', () => {
  const bodyResult = renderPage(layoutSrc, 'Layout', {
    children: '<h1>Test Page</h1>'
  });
  const full = `<!DOCTYPE html><html><head></head><body>${bodyResult.body}</body></html>`;
  assert(full.includes('<nav'), 'nav');
  assert(full.includes('Test Page'), 'content');
  assert(full.includes('Powered by Vesk'), 'footer');
});

// =============================================================
console.log('\n=== SUMMARY ===');
console.log(`${'='.repeat(50)}`);
console.log(`${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const e of errors) {
    console.log(`  FAIL: ${e.name} — ${e.message}`);
  }
  process.exit(1);
}
