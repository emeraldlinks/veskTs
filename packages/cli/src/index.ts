#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, definePlugin, preset, validateConfig } from '../../compiler/src/config';
import { setRedactLogging, setRuntimeModule } from '../../compiler/src/server-utils.js';
import { build, startProdServer } from '../../adapter/src/index';
import { runSeoAudit } from '../../adapter/src/seo-audit';
import { startDevServer } from './dev-server';
import * as __veskRuntime from '../../runtime/src/index-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const args = process.argv.slice(2);
const cmd = args[0];

function usage(code = 0) {
  console.error('Vesk CLI — Compiler-First Framework for the Post-VDOM Web');
  console.error('');
  console.error('Usage:');
  console.error('  vesk init [project-name]     Create a new Vesk project');
  console.error('  vesk build [--seo] [--strict] [--skip-split] Build app/ for production');
  console.error('  vesk seo [--strict]           Run SEO analysis on app/');
  console.error('  vesk start [port]             Start production server');
  console.error('  vesk dev                      Start dev server with HMR');
  console.error('  vesk --help                   Show this help');
  process.exit(code);
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
    globalThis.__vesk_inject = { defineConfig, definePlugin, preset };

    raw = (await import(tmpFile)).default;
    delete globalThis.__vesk_inject;
  } else {
    raw = (await import(configPath)).default;
  }

  const config = typeof defineConfig === 'function' ? defineConfig(raw) : raw;
  if (typeof validateConfig === 'function') validateConfig(config);

  if ((config as Record<string, unknown>)?.security?.redactLogs !== false) {
    try { setRedactLogging(true); } catch {}
  }

  return config;
}

if (cmd === 'init') {
  const projectName = args[1] || '.';
  const targetDir = projectName === '.' ? process.cwd() : resolve(process.cwd(), projectName);

  if (targetDir !== process.cwd() && existsSync(targetDir)) {
    console.error(`vesk: directory "${projectName}" already exists`);
    process.exit(1);
  }

  const appDir = join(targetDir, 'app');
  const srcDir = join(targetDir, 'src');
  const pkgName = basename(projectName === '.' ? targetDir : projectName);

  if (targetDir !== process.cwd()) mkdirSync(targetDir, { recursive: true });

  const dirs = [
    appDir, join(appDir, 'about'), join(appDir, 'blog'),
    join(appDir, 'blog', '[slug]'),
    srcDir,
    join(targetDir, 'public'),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });

  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: pkgName,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vesk dev',
      build: 'vesk build',
      start: 'vesk start',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      '@vesk/compiler': '^0.1.0',
      '@vesk/runtime': '^0.1.0',
      '@vesk/cli': '^0.1.0',
      '@vesk/adapter': '^0.1.0',
      '@vesk/plugin-tailwind': '^0.1.0',
    },
    devDependencies: {
      typescript: '^5.8.0',
    },
  }, null, 2) + '\n');

  writeFileSync(join(targetDir, 'vesk.config.ts'), [
    `import { defineConfig, preset } from '@vesk/compiler'`,
    `import tailwindcss from '@vesk/plugin-tailwind'`,
    ``,
    `export default defineConfig({`,
    `\tappDir: './app',`,
    `\toutDir: './dist',`,
    `\tpublicDir: './public',`,
    `\t// security: 'strict',                // preset string ("strict"|"minimal"|"off")`,
    `\t// security: preset('production'),     // environment preset`,
    `\tsecurity: preset('production', {       // preset + overrides`,
    `\t\ttrustProxy: true,                   // set to true if behind nginx/Cloudflare`,
    `\t\t// rateLimit: { windowMs: 60000, max: 100 },`,
    `\t\t// cors: { origin: ['https://app.example.com'] },`,
    `\t}),`,
    `\tplugins: [`,
    `\t\ttailwindcss({ entry: 'src/global.css' }),`,
    `\t],`,
    `\tssg: {`,
    `\t\t// getStaticPaths: async () => {`,
    `\t\t//   return { paths: [{ params: { slug: 'hello-world' } }, { params: { slug: 'ssr-in-vesk' } }] };`,
    `\t\t// },`,
    `\t},`,
    `});`,
    '',
  ].join('\n'));

  writeFileSync(join(targetDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      jsx: 'preserve',
      jsxImportSource: '@vesk/compiler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      baseUrl: '.',
      paths: {
        '@/*': ['./src/*'],
        '@app/*': ['./app/*'],
      },
    },
    include: ['**/*.vsk', '**/*.js', '**/*.ts'],
    exclude: ['node_modules', 'dist'],
  }, null, 2) + '\n');

  writeFileSync(join(targetDir, 'tailwind.config.js'), [
    `/** @type {import('tailwindcss').Config} */`,
    `export default {`,
    `\tcontent: ['./app/**/*.{vsk,js}', './src/**/*.{js,css}'],`,
    `\ttheme: {`,
    `\t\textend: {},`,
    `\t},`,
    `\tplugins: [],`,
    `};`,
    '',
  ].join('\n'));

  writeFileSync(join(targetDir, 'postcss.config.js'), [
    `export default {`,
    `\tplugins: {`,
    `\t\ttailwindcss: {},`,
    `\t\tautoprefixer: {},`,
    `\t},`,
    `};`,
    '',
  ].join('\n'));

  writeFileSync(join(srcDir, 'global.css'), [
    `@import 'tailwindcss';`,
    ``,
    `@layer base {`,
    `\thtml { scroll-behavior: smooth; }`,
    `}`,
    '',
  ].join('\n'));

  writeFileSync(join(appDir, 'layout.vsk'), [
    `import { NavLink } from '@vesk/runtime';`,
    ``,
    `component Layout(props) {`,
    `\t<nav class="flex gap-6 px-8 py-4 border-b border-gray-200 bg-white">`,
    `\t\t<NavLink href="/" class="text-gray-500 hover:text-black font-medium no-underline">Home</NavLink>`,
    `\t\t<NavLink href="/about" class="text-gray-500 hover:text-black font-medium no-underline">About</NavLink>`,
    `\t\t<NavLink href="/blog" class="text-gray-500 hover:text-black font-medium no-underline">Blog</NavLink>`,
    `\t</nav>`,
    `\t<main class="max-w-3xl mx-auto my-8 px-4">{props.children}</main>`,
    `\t<footer class="text-center py-8 text-gray-400 text-sm">`,
    `\t\t<p>Powered by Vesk</p>`,
    `\t</footer>`,
    `}`,
    '',
  ].join('\n'));

  writeFileSync(join(appDir, 'middleware.ts'), [
    `// Vesk Middleware — onion model (ctx, next)`,
    `// ctx = { request, params, url, locals, cookies, set, get }`,
    `//   ctx.set('user', val) → ctx.locals.user`,
    `//   ctx.user             → ctx.locals.user`,
    `// ctx.locals — mutable object shared with page/API`,
    `// next() — passes to next middleware or page render`,
    `// next('/rewrite') — rewrites URL in place`,
    `// Short-circuit: return Response without calling next()`,
    `// Onion: do before work, await next(), do after work`,
    ``,
    `export async function middleware(ctx, next) {`,
    `\treturn next();`,
    `}`,
    '',
  ].join('\n'));

  writeFileSync(join(appDir, 'page.vsk'), [
    `component Home {`,
    `\t<h1 class="text-4xl font-bold mb-2">Welcome to Vesk</h1>`,
    `\t<p class="text-gray-500 mb-4">`,
    `\t\tA compiler-first reactive UI framework for the post-VDOM web.`,
    `\t</p>`,
    `\t<div class="bg-white rounded-xl p-6 shadow-sm border border-gray-100">`,
    `\t\t<h2 class="text-xl font-semibold mb-2">Getting Started</h2>`,
    `\t\t<p>Edit <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">app/page.vsk</code> to change this page.</p>`,
    `\t</div>`,
    `}`,
    '',
  ].join('\n'));

  writeFileSync(join(appDir, 'about', 'page.vsk'), [
    `component About {`,
    `\t<h1 class="text-3xl font-bold mb-4">About Vesk</h1>`,
    `\t<p class="text-gray-600 mb-3">`,
    `\t\tVesk is a compiler-first reactive UI framework. It compiles .vsk components`,
    `\t\tto standard ESM with SSR, hydration, and fine-grained reactivity.`,
    `\t</p>`,
    `\t<p class="text-gray-600 mb-3">`,
    `\t\tKey features include zero-JS pages, islands architecture, AOT event delegation,`,
    `\t\tand streaming SSR.`,
    `\t</p>`,
    `}`,
    '',
  ].join('\n'));

  writeFileSync(join(appDir, 'blog', 'page.vsk'), [
    `component Blog {`,
    `\t<h1 class="text-3xl font-bold mb-4">Blog</h1>`,
    `\t<div class="bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100">`,
    `\t\t<h2 class="text-lg font-semibold mb-1">`,
    `\t\t\t<a href="/blog/hello-world" class="text-gray-900 no-underline hover:text-blue-600">Hello World</a>`,
    `\t\t</h2>`,
    `\t\t<p class="text-gray-400 text-sm">First post powered by Vesk</p>`,
    `\t</div>`,
    `\t<div class="bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100">`,
    `\t\t<h2 class="text-lg font-semibold mb-1">`,
    `\t\t\t<a href="/blog/ssr-in-vesk" class="text-gray-900 no-underline hover:text-blue-600">SSR in Vesk</a>`,
    `\t\t</h2>`,
    `\t\t<p class="text-gray-400 text-sm">How server-side rendering works</p>`,
    `\t</div>`,
    `}`,
    '',
  ].join('\n'));

  writeFileSync(join(appDir, 'blog', '[slug]', 'page.vsk'), [
    `component BlogPost(props: { params: { slug: string } }) {`,
    `\t<a href="/blog" class="inline-block mb-6 text-blue-600 no-underline hover:underline">`,
    `\t\t← Back to blog`,
    `\t</a>`,
    `\t<h1 class="text-3xl font-bold mb-2">Post: {props.params.slug}</h1>`,
    `\t<div class="text-gray-600 leading-relaxed">`,
    `\t\t<p>This is a dynamic blog post rendered at <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">/{props.params.slug}</code>.</p>`,
    `\t</div>`,
    `}`,
    '',
  ].join('\n'));

  writeFileSync(join(targetDir, 'public', 'favicon.svg'), [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2563eb"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-family="system-ui" font-weight="bold">V</text></svg>`,
    '',
  ].join('\n'));

  writeFileSync(join(targetDir, '.env.example'), [
    `# Vesk environment variables (copy to .env.local for local overrides)`,
    `# These are loaded automatically in dev and build commands.`,
    ``,
    `# Example:`,
    `# DATABASE_URL=postgres://user:pass@localhost:5432/db`,
    `# STRIPE_SECRET=sk_test_...`,
    `# PUBLIC_API_URL=https://api.example.com`,
    '',
  ].join('\n'));

  writeFileSync(join(targetDir, '.gitignore'), [
    `node_modules/`,
    `dist/`,
    `.vesk/`,
    `.vsk-cache/`,
    `*.log`,
    `.DS_Store`,
    `.env`,
    `.env.local`,
    `.env.*.local`,
    '',
  ].join('\n'));

  const apiDir = join(appDir, 'api', 'hello');
  mkdirSync(apiDir, { recursive: true });
  writeFileSync(join(apiDir, 'route.ts'), [
    `// Vesk API Route — app/api/hello/route.ts`,
    ``,
    `import { VeskRequest } from '@vesk/runtime';`,
    ``,
    `export async function GET(request: VeskRequest) {`,
    `  const token = request.cookies?.token || '(none)';`,
    `  console.log('client IP:', request.ip, 'protocol:', request.protocol);`,
    `  return Response.json({`,
    `    message: 'Hello from Vesk API!',`,
    `    timestamp: Date.now(),`,
    `    url: request.url,`,
    `    token,`,
    `  });`,
    `}`,
    ``,
    `export async function POST(request: VeskRequest) {`,
    `  const body = await request.body;`,
    `  if (body instanceof Response) return body;`,
    `  return Response.json({ received: body, ok: true }, { status: 201 });`,
    `}`,
    '',
  ].join('\n'));

  const echoDir = join(appDir, 'api', 'echo', '[msg]');
  mkdirSync(echoDir, { recursive: true });
  writeFileSync(join(echoDir, 'route.ts'), [
    `// Dynamic API route — /api/echo/hello  →  params.msg === "hello"`,
    ``,
    `export async function GET(request: Request, { params }: { params: Promise<Record<string, string>> }) {`,
    `  const { msg } = await params;`,
    `  return Response.json({ message: msg || '(empty)', method: 'GET' });`,
    `}`,
    '',
  ].join('\n'));

  const projectLabel = projectName === '.' ? 'current directory' : projectName.startsWith('/') ? projectName : `./${projectName}`;
  console.error(`vesk: created new project in ${projectLabel}`);
  console.error('');
  console.error(`  ${projectName === '.' ? '' : 'cd ' + projectName + ' && '}npm install`);
  console.error(`  ${projectName === '.' ? '' : 'cd ' + projectName + ' && '}npm run build`);
  process.exit(0);
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

  const targetIdx = restArgs.indexOf('--target');
  const target = targetIdx !== -1 && restArgs[targetIdx + 1] === 'edge' ? 'edge' : 'node';

  const config = await loadConfig(projectDir);
  const plugins = (config as Record<string, unknown>)?.plugins || [];
  const opts: Record<string, unknown> = { publicDir, plugins, seo, strictSeo: strict, codeSplit: !restArgs.includes('--skip-split'), target };

  try {
    await build(appDirPath, opts);
    console.error('vesk build: done');
  } catch (e) {
    console.error(`vesk build: error — ${(e as Error).message}`);
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

if (cmd === 'start') {
  const projectDir = process.cwd();
  const outDir = join(projectDir, '.vesk');
  const port = parseInt(args[1], 10) || 3000;

  startProdServer(outDir, { port });
  await new Promise(() => {});
}

if (cmd === 'dev') {
  const projectDir = process.cwd();
  const appDirPath = join(projectDir, 'app');
  const port = parseInt(args[1], 10) || 3000;

  if (!existsSync(appDirPath)) {
    console.error('vesk: no app/ directory found in ${projectDir}');
    console.error('Run "vesk init" first');
    process.exit(1);
  }

  const config = await loadConfig(projectDir);
  setRuntimeModule(__veskRuntime);
  await startDevServer(port, projectDir, config);
}

const compilerBin = resolve(__dirname, '../../compiler/bin/vesk');

if (!existsSync(compilerBin)) {
  console.error(`vesk: compiler bin not found at ${compilerBin}`);
  process.exit(1);
}

try {
  const { execSync } = await import('child_process');
  execSync(`node ${compilerBin} ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
    stdio: 'inherit',
    encoding: 'utf-8',
  });
  process.exit(0);
} catch (e) {
  process.exit((e as { status?: number }).status || 1);
}
