#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, definePlugin, preset, validateConfig } from '@vesk/compiler/src/config';
import type { VeskConfig, VeskSecurity } from '@vesk/compiler/src/types';
import { setRedactLogging, setRuntimeModule } from '@vesk/compiler/src/server-utils';
import { build, startProdServer } from '@vesk/adapter/src/index';
import { runSeoAudit } from '@vesk/adapter/src/seo-audit';
import { startDevServer } from './dev-server';
import * as __veskRuntime from '@vesk/runtime/src/index-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const args = process.argv.slice(2);
const cmd = args[0];

function usage(code = 0) {
  console.error('Vesk CLI — Compiler-First Framework for the Post-VDOM Web');
  console.error('');
  console.error('Usage:');
  console.error('  vesk build [--platform <name>] [--seo] [--strict] [--skip-split]  Build app/ for production');
  console.error('  vesk build                       Auto-detect platform from CI env (vercel/netlify/cf/deno/aws/coxmos)');
  console.error('  vesk seo [--strict]           Run SEO analysis on app/');
  console.error('  vesk typecheck [--no-strict]  Typecheck .vsk/.ts files via tsc-in-.vsk (strict by default)');
  console.error('  vesk start [-p 3000]          Start production server');
  console.error('  vesk dev [-p 3000]            Start dev server with HMR');
  console.error('  vesk init                     Create src/global.css (Tailwind entrypoint) if missing');
  console.error('  vesk --help                   Show this help');
  console.error('');
  console.error('Scaffolding:  npx create-vesk@latest <project-name>');
  process.exit(code);
}

function parsePortArg(args: string[], def = 3000): number {
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const eq = a.startsWith('--port=') ? a.slice('--port='.length)
      : (a === '-p' || a === '--port') && args[i + 1] ? args[i + 1] : null;
    if (eq !== null) {
      const n = parseInt(eq, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return def;
}

// Bind address for dev/start servers. Loopback by default — exposing a dev
// server on all interfaces must be an explicit opt-in (`--host 0.0.0.0`).
function parseHostArg(args: string[]): string | undefined {
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--host=')) return a.slice('--host='.length);
    if ((a === '-H' || a === '--host') && args[i + 1]) return args[i + 1];
  }
  return undefined;
}

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  usage(args.length === 0 ? 1 : 0);
}

function loadEnvFiles(projectDir: string) {
  const files = [
    join(projectDir, '.env'),
    join(projectDir, '.env.local'),
  ];
  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      let key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

async function loadConfig(projectDir: string) {
  loadEnvFiles(projectDir);

  const jsPath = join(projectDir, 'vesk.config.js');
  const tsPath = join(projectDir, 'vesk.config.ts');
  let configPath: string | null = null;
  if (existsSync(jsPath)) configPath = jsPath;
  else if (existsSync(tsPath)) configPath = tsPath;

  if (!configPath) return {};

  let raw: unknown;
  if (configPath.endsWith('.ts')) {
    const { transpile } = await import('typescript');
    const src = readFileSync(configPath, 'utf-8');
    let js = transpile(src, { module: 99, target: 99 });
    js = js.replace(/import\s+\{[^}]*\}\s*from\s+['"]@vesk\/compiler['"]\s*;?\s*/g, '');
    js = `const { defineConfig, definePlugin, preset } = globalThis.__vesk_inject;\n` + js;
    const tmpFile = join(projectDir, '.vesk', 'config.tmp.js');
    mkdirSync(dirname(tmpFile), { recursive: true });
    writeFileSync(tmpFile, js, 'utf-8');
    (globalThis as Record<string, unknown>).__vesk_inject = { defineConfig, definePlugin, preset };

    raw = (await import(tmpFile)).default;
    delete (globalThis as Record<string, unknown>).__vesk_inject;
  } else {
    raw = (await import(configPath)).default;
  }

  const config = (typeof defineConfig === 'function' ? defineConfig(raw as VeskConfig) : raw) as VeskConfig;
  if (typeof validateConfig === 'function') validateConfig(config);

  const sec = config.security;
  if (sec !== undefined && sec !== false && typeof sec === 'object' && (sec as VeskSecurity).redactLogs !== false) {
    try { setRedactLogging(true); } catch {}
  }

  return config;
}

if (cmd === 'build') {
  const projectDir = process.cwd();
  const appDirPath = join(projectDir, 'app');
  const publicDir = join(projectDir, 'public');

  if (!existsSync(appDirPath)) {
    console.error(`vesk build: no app/ directory found in ${projectDir}`);
    process.exit(1);
  }

  const restArgs = process.argv.slice(3);
  const seo = restArgs.includes('--seo');
  const strict = restArgs.includes('--strict');

  const platformIdx = restArgs.indexOf('--platform');
  const platform = platformIdx !== -1 ? restArgs[platformIdx + 1] : undefined;

  const targetIdx = restArgs.indexOf('--target');
  const target = targetIdx !== -1 && restArgs[targetIdx + 1] === 'edge' ? 'edge' : 'node';

  const config = await loadConfig(projectDir);
  const plugins = (config as Record<string, unknown>)?.plugins || [];
  const mdCfg = (config as Record<string, unknown>)?.md;
  const opts: Record<string, unknown> = { publicDir, plugins, seo, strictSeo: strict, codeSplit: !restArgs.includes('--skip-split'), target };
  if (mdCfg) opts.md = mdCfg;
  if (config.routeDataCache !== undefined) opts.routeDataCache = config.routeDataCache;
  if (platform) opts.platform = platform;

  try {
    await build(appDirPath, opts);
    const { drainMdHtmlWarnings } = await import('@vesk/runtime/src/md') as { drainMdHtmlWarnings: () => Array<{ tag: string }> };
    const drained = drainMdHtmlWarnings();
    if (drained.length > 0) {
      const byTag = new Map<string, number>();
      for (const w of drained) byTag.set(w.tag, (byTag.get(w.tag) || 0) + 1);
      const tags = [...byTag.entries()].map(([t, n]) => `<${t}>×${n}`).join(', ');
      console.error(`vesk build: markdown raw-HTML passthrough — ${drained.length} occurrence(s): ${tags}`);
      console.error('vesk build: only render trusted markdown as HTML. Policy: md.html in vesk.config.ts.');
    }
    console.error('vesk build: done');
  } catch (e) {
    const err = e as Error & { name?: string; file?: string; line?: number; column?: number; code?: string; toString?: () => string };
    // VeskError already formats file + line + code frame in its toString()
    if (err && err.name === 'VeskError' && typeof err.toString === 'function') {
      const vesErr = err as unknown as { toString: () => string };
      // Use VeskError's rich formatting which includes file, line/col and 5 lines before/after
      try {
        const { VeskError: VE } = await import('@vesk/compiler/src/errors') as { VeskError: new (...args: unknown[]) => Error };
        if (err instanceof (VE as unknown as { new(): Error })) {
          console.error((err as unknown as { toString(): string }).toString());
        } else {
          console.error((err as unknown as { toString(): string }).toString());
        }
      } catch {
        console.error((err as unknown as { toString(): string }).toString());
      }
    } else if (err && (err as unknown as { file?: string }).file) {
      const f = (err as unknown as { file: string; line?: number; column?: number; code?: string }).file;
      const l = (err as unknown as { line?: number }).line;
      const c = (err as unknown as { column?: number }).column;
      const code = (err as unknown as { code?: string }).code;
      let out = `vesk build: error — ${err.message}`;
      if (f) out += `\n  File: ${f}${l ? `:${l}${c ? `:${c}` : ''}` : ''}`;
      if (code) out += `\n\n${code}`;
      console.error(out);
      if (err.stack && !String(err.stack).includes(err.message)) console.error(err.stack);
    } else {
      console.error(`vesk build: error — ${(e as Error).message}`);
      if ((e as Error).stack) {
        // Only print stack if it contains more than message
        const stack = (e as Error).stack as string;
        if (stack && !stack.includes('at ')) console.error(stack);
      }
    }
    process.exit(1);
  }
  process.exit(0);
}

if (cmd === 'seo') {
  const projectDir = process.cwd();
  const appDirPath = join(projectDir, 'app');
  if (!existsSync(appDirPath)) {
    console.error(`vesk seo: no app/ directory found in ${projectDir}`);
    process.exit(1);
  }

  const strict = args.includes('--strict');
  const audit = runSeoAudit(appDirPath);
  if (strict && audit.errors > 0) {
    console.error(`vesk seo: failed with ${audit.errors} error(s)`);
    process.exit(1);
  }
  process.exit(0);
}

if (cmd === 'typecheck') {
  const projectDir = process.cwd();
  const appDirPath = join(projectDir, 'app');
  if (!existsSync(appDirPath)) {
    console.error(`vesk typecheck: no app/ directory found in ${projectDir}`);
    process.exit(1);
  }

  const { typecheckProject, formatTypecheckErrors, formatTypecheckWarnings } = await import('@vesk/compiler/src/typecheck');
  const strict = !args.includes('--no-strict');
  const result = typecheckProject(projectDir, { strict });

  if (result.warnings.length > 0) {
    console.error(`vesk typecheck: ${result.warnings.length} warning(s):`);
    console.error(formatTypecheckWarnings(result.warnings));
    console.error('');
  }
  if (result.errors.length > 0) {
    console.error(`vesk typecheck: ${result.errors.length} error(s):`);
    console.error(formatTypecheckErrors(result.errors));
    process.exit(1);
  }
  console.error(
    `vesk typecheck: no type errors found${result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : ''}`
  );
  process.exit(0);
}

if (cmd === 'start') {
  const projectDir = process.cwd();
  const outDir = join(projectDir, '.vesk');
  const port = parsePortArg(args);
  const host = parseHostArg(args);

  startProdServer(outDir, { port, host });
  await new Promise(() => {});
}

if (cmd === 'init') {
  const projectDir = process.cwd();
  const srcDir = join(projectDir, 'src');
  const target = join(srcDir, 'global.css');
  if (existsSync(target)) {
    console.error(`vesk init: ${target} already exists — skipping`);
    process.exit(0);
  }
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(target, [
    `@import 'tailwindcss';`,
    ``,
    `@layer base {`,
    `\thtml { scroll-behavior: smooth; }`,
    `}`,
    ``,
  ].join('\n'));
  console.error(`vesk init: created ${target}`);
  process.exit(0);
}

if (cmd === 'dev') {
  const projectDir = process.cwd();
  const appDirPath = join(projectDir, 'app');
  const port = parsePortArg(args);
  const host = parseHostArg(args);

  if (!existsSync(appDirPath)) {
    console.error(`vesk: no app/ directory found in ${projectDir}`);
    console.error('Run "npx create-vesk@latest <project-name>" first');
    process.exit(1);
  }

  const config = (await loadConfig(projectDir)) as Record<string, unknown>;
  setRuntimeModule(__veskRuntime);
  try {
    const { configureMd } = await import('@vesk/runtime/src/md') as { configureMd: (p?: unknown) => void };
    configureMd(config.md as Record<string, unknown> | undefined);
  } catch {}
  await startDevServer(port, projectDir, config, host);
}
