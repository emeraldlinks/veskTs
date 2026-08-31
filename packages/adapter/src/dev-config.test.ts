/**
 * Dev-config surgical editors — AST-based, no regex for syntax.
 * Covers simple plugins and plugins with options (args).
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPluginToConfig, removePluginFromConfig, importNameForPackage } from './dev-config.js';
import { installPlugin, readPluginState } from './plugins.js';
import { __internals } from './plugins.js';

let passed = 0, failed = 0;
function assert(c: boolean, msg: string) { if (c) { passed++; console.log(`  ✓ ${msg}`); } else { failed++; console.log(`  ✗ ${msg}`); } }

async function main() {
  console.log('\n=== dev-config: AST-based vesk.config.ts editors ===');

  // importNameForPackage
  assert(importNameForPackage('@vesk/plugin-tailwind') === 'tailwindcss', 'tailwind special case -> tailwindcss');
  assert(importNameForPackage('@scope/my-plugin') === 'myPlugin', 'scoped my-plugin -> myPlugin');
  assert(importNameForPackage('my-awesome-plugin') === 'myAwesomePlugin', 'kebab -> camel');
  assert(importNameForPackage('@myorg/awesome-plugin') === 'awesomePlugin', 'scoped awesome -> awesomePlugin');

  // helper to create dummy package for validation
  function mkFakePkg(dir: string, pkg: string, withHook = true) {
    const parts = pkg.split('/');
    const pkgDir = pkg.startsWith('@') ? join(dir, 'node_modules', parts[0], parts[1]) : join(dir, 'node_modules', pkg);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version: '1.0.0', main: 'index.js' }));
    const hook = withHook ? ', onCSS:()=>{}' : '';
    const importName = importNameForPackage(pkg) === 'tailwindcss' ? 'tailwindcss' : importNameForPackage(pkg);
    // factory must be default export function returning plugin object with name
    writeFileSync(join(pkgDir, 'index.js'), `export default function ${importName}(){return {name:"${pkg}"${hook}}}`);
  }

  // add / remove simple
  {
    const tmp = mkdtempSync(join(tmpdir(), 'vesk-devcfg-'));
    const compDir = join(tmp, 'node_modules', '@vesk', 'compiler'); mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'package.json'), JSON.stringify({ name: '@vesk/compiler', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(compDir, 'index.js'), 'export function defineConfig(c){return c}');
    mkFakePkg(tmp, '@vesk/plugin-tailwind');
    const initial = `import { defineConfig, preset } from '@vesk/compiler'\nimport tailwindcss from '@vesk/plugin-tailwind'\n\nexport default defineConfig({\n\tappDir: './app',\n\tplugins: [\n\t\ttailwindcss({ entry: 'src/global.css', appDir: 'app' }),\n\t],\n})\n`;
    writeFileSync(join(tmp, 'vesk.config.ts'), initial, 'utf-8');
    mkFakePkg(tmp, 'my-plugin');
    await addPluginToConfig(tmp, 'my-plugin');
    let src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(src.includes(`from 'my-plugin'`) && src.includes('myPlugin()'), 'add simple plugin imports + registers');
    // idempotent
    await addPluginToConfig(tmp, 'my-plugin');
    let src2 = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(src === src2, 'add idempotent for simple plugin');
    // add scoped with options need test later */
    mkFakePkg(tmp, '@myorg/awesome-plugin');
    await addPluginToConfig(tmp, '@myorg/awesome-plugin');
    src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(src.includes(`from '@myorg/awesome-plugin'`) && src.includes('awesomePlugin()'), 'add scoped plugin');
    await removePluginFromConfig(tmp, 'my-plugin');
    src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(!src.includes(`from 'my-plugin'`) && !src.includes('myPlugin()'), 'remove simple plugin cleans import + entry');
    assert(src.includes(`from '@vesk/plugin-tailwind'`), 'tailwind remains after simple remove');
    await removePluginFromConfig(tmp, '@vesk/plugin-tailwind');
    src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(!src.includes(`@vesk/plugin-tailwind`) && !src.includes('tailwindcss('), 'remove tailwind cleans');
    assert(src.includes(`from '@myorg/awesome-plugin'`), 'awesome remains');
    await removePluginFromConfig(tmp, '@myorg/awesome-plugin');
    src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(!src.includes('awesomePlugin') && src.includes('plugins: []'), 'remove last leaves empty array');
    rmSync(tmp, { recursive: true, force: true });
  }

  // plugin with options (args) — add is idempotent, remove works with args
  {
    const tmp = mkdtempSync(join(tmpdir(), 'vesk-devcfg-opt-'));
    const compDir = join(tmp, 'node_modules', '@vesk', 'compiler'); mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'package.json'), JSON.stringify({ name: '@vesk/compiler', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(compDir, 'index.js'), 'export function defineConfig(c){return c}');
    const optDir = join(tmp, 'node_modules', 'opt-plugin'); mkdirSync(optDir, { recursive: true });
    writeFileSync(join(optDir, 'package.json'), JSON.stringify({ name: 'opt-plugin', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(optDir, 'index.js'), 'export default function optPlugin(o){return {name:"opt-plugin", onBuildStart:()=>{}}}');
    const otherDir = join(tmp, 'node_modules', 'other-plugin'); mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, 'package.json'), JSON.stringify({ name: 'other-plugin', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(otherDir, 'index.js'), 'export default function otherPlugin(){return {name:"other-plugin", onBuildStart:()=>{}}}');
    const srcWithOpts = `import { defineConfig } from '@vesk/compiler'\nimport optPlugin from 'opt-plugin'\nimport otherPlugin from 'other-plugin'\n\nexport default defineConfig({\n\tplugins: [\n\t\toptPlugin({ enabled: true, key: "value", nested: { a: 1 } }),\n\t\totherPlugin()\n\t],\n})\n`;
    writeFileSync(join(tmp, 'vesk.config.ts'), srcWithOpts, 'utf-8');
    // add should be idempotent even though existing entry has args
    await addPluginToConfig(tmp, 'opt-plugin');
    let src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    const occ = (src.match(/optPlugin/g) || []).length;
    assert(occ === 2, `optPlugin with options not duplicated (occ=${occ}, expected 2 for import+one entry)`);
    assert(src.includes(`optPlugin({ enabled: true`), 'optPlugin entry with options preserved');
    // remove optPlugin with options
    await removePluginFromConfig(tmp, 'opt-plugin');
    src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(!src.includes(`from 'opt-plugin'`) && !src.includes('optPlugin('), 'remove plugin with options cleans');
    assert(src.includes('otherPlugin()'), 'otherPlugin remains after opt removal');
    // remove other
    await removePluginFromConfig(tmp, 'other-plugin');
    src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(!src.includes('otherPlugin') && src.includes('plugins: []'), 'remove other leaves empty');
    rmSync(tmp, { recursive: true, force: true });
  }

  // plugins array missing -> add creates it
  {
    const tmp = mkdtempSync(join(tmpdir(), 'vesk-devcfg-missing-'));
    const compDir = join(tmp, 'node_modules', '@vesk', 'compiler'); mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'package.json'), JSON.stringify({ name: '@vesk/compiler', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(compDir, 'index.js'), 'export function defineConfig(c){return c}');
    const pkgDir = join(tmp, 'node_modules', 'new-one'); mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'new-one', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(pkgDir, 'index.js'), 'export default function newOne(){return {name:"new-one", onCSS:()=>{}}}');
    writeFileSync(join(tmp, 'vesk.config.ts'), `import { defineConfig } from '@vesk/compiler'\nexport default defineConfig({ appDir: './app' })\n`, 'utf-8');
    await addPluginToConfig(tmp, 'new-one');
    const src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(src.includes(`from 'new-one'`) && src.includes('newOne()') && src.includes('plugins:'), 'add creates plugins array when missing');
    rmSync(tmp, { recursive: true, force: true });
  }

  // no config file -> add creates one
  {
    const tmp = mkdtempSync(join(tmpdir(), 'vesk-devcfg-nocfg-'));
    const compDir = join(tmp, 'node_modules', '@vesk', 'compiler'); mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'package.json'), JSON.stringify({ name: '@vesk/compiler', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(compDir, 'index.js'), 'export function defineConfig(c){return c}');
    const pkgDir = join(tmp, 'node_modules', 'fresh-plugin'); mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'fresh-plugin', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(pkgDir, 'index.js'), 'export default function freshPlugin(){return {name:"fresh-plugin", onCSS:()=>{}}}');
    await addPluginToConfig(tmp, 'fresh-plugin');
    assert(existsSync(join(tmp, 'vesk.config.ts')), 'add creates config when missing');
    const src = readFileSync(join(tmp, 'vesk.config.ts'), 'utf-8');
    assert(src.includes(`from 'fresh-plugin'`) && src.includes('freshPlugin()'), 'created config contains plugin');
    rmSync(tmp, { recursive: true, force: true });
  }

  // plausibleVeskPlugin via keywords/category without @vesk prefix
  {
    const tmp = mkdtempSync(join(tmpdir(), 'vesk-keyword-'));
    const appDir = join(tmp, 'app'); const veskDir = join(tmp, '.vesk');
    mkdirSync(appDir, { recursive: true }); mkdirSync(veskDir, { recursive: true });
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'app' }));
    const orig = __internals.runNpm;
    // @ts-ignore
    __internals.runNpm = async () => ({ code: 0, stdout: '', stderr: '' });
    const mk = (pkg: string, json: any) => {
      const d = join(tmp, 'node_modules', ...pkg.split('/')); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'package.json'), JSON.stringify(json)); writeFileSync(join(d, 'index.js'), 'module.exports={}');
    };
    mk('generic-foo', { name: 'generic-foo', version: '1.0.0', main: 'index.js', keywords: ['vesk-plugin'] });
    let rec = await installPlugin(appDir, veskDir, 'generic-foo');
    assert(rec.error === null && rec.active === true, 'vesk-plugin keyword makes plausible');
    mk('vk-bar', { name: 'vk-bar', version: '1.0.0', main: 'index.js', keywords: ['vk-plugin'] });
    rec = await installPlugin(appDir, veskDir, 'vk-bar');
    assert(rec.error === null, 'vk-plugin keyword makes plausible');
    mk('cat-plugin', { name: 'cat-plugin', version: '1.0.0', main: 'index.js', category: 'vesk-plugin' });
    rec = await installPlugin(appDir, veskDir, 'cat-plugin');
    assert(rec.error === null, 'category vesk-plugin makes plausible');
    mk('plain-bad', { name: 'plain-bad', version: '1.0.0', main: 'index.js', keywords: ['something-else'] });
    rec = await installPlugin(appDir, veskDir, 'plain-bad');
    assert(rec.error !== null && /may not be a Vesk plugin/.test(rec.error), 'plain package flagged as not vesk plugin');
    // @ts-ignore
    __internals.runNpm = orig;
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
