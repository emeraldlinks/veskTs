#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const args = process.argv.slice(2);
const cmd = args[0];

function usage(code = 0) {
	console.error(`Vesk CLI — Compiler-First Framework for the Post-VDOM Web`);
	console.error(``);
	console.error(`Usage:`);
	console.error(`  vesk init [project-name]    Create a new Vesk project`);
	console.error(`  vesk <file.vsk> [options]   Compile a .vsk file`);
	console.error(`  vesk --router [options]     Build app/ with file-based routing`);
	console.error(`  vesk --help                 Show this help`);
	console.error(``);
	console.error(`Options:`);
	console.error(`  -o <file>     Output to file instead of stdout`);
	console.error(`  --ssg         Generate static HTML (Static Site Generation)`);
	console.error(`  --props <json>  Custom props for SSG`);
	console.error(`  --router      File-based routing (scans ./app/)`);
	process.exit(code);
}

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
	usage(args.length === 0 ? 1 : 0);
}

// ── init ─────────────────────────────────────────────────────
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

	// ═══════════════════════════════════════════════════════════
	// package.json
	// ═══════════════════════════════════════════════════════════
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

	// ═══════════════════════════════════════════════════════════
	// vesk.config.ts — Vesk compiler configuration
	// ═══════════════════════════════════════════════════════════
	writeFileSync(join(targetDir, 'vesk.config.ts'), [
		`import { defineConfig } from '@vesk/compiler'`,
		`import tailwindcss from '@vesk/plugin-tailwind'`,
		``,
		`export default defineConfig({`,
		`\tappDir: './app',`,
		`\toutDir: './dist',`,
		`\tpublicDir: './public',`,
		`\tplugins: [`,
		`\t\ttailwindcss({ entry: 'src/global.css' }),`,
		`\t],`,
		`\tssg: {`,
		`\t\t// Example: pre-render blog posts`,
		`\t\t// getStaticPaths: async () => {`,
		`\t\t//   return { paths: [{ params: { slug: 'hello-world' } }, { params: { slug: 'ssr-in-vesk' } }] };`,
		`\t\t// },`,
		`\t},`,
		`});`,
		'',
	].join('\n'));

	// ═══════════════════════════════════════════════════════════
	// tsconfig.json — TypeScript config for type-checking .vsk
	// ═══════════════════════════════════════════════════════════
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

	// ═══════════════════════════════════════════════════════════
	// tailwind.config.js — Tailwind CSS v4 (PostCSS config)
	// ═══════════════════════════════════════════════════════════
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

	// ═══════════════════════════════════════════════════════════
	// postcss.config.js — PostCSS with Tailwind + autoprefixer
	// ═══════════════════════════════════════════════════════════
	writeFileSync(join(targetDir, 'postcss.config.js'), [
		`export default {`,
		`\tplugins: {`,
		`\t\ttailwindcss: {},`,
		`\t\tautoprefixer: {},`,
		`\t},`,
		`};`,
		'',
	].join('\n'));

	// ═══════════════════════════════════════════════════════════
	// src/global.css — Tailwind entry

	writeFileSync(join(srcDir, 'global.css'), [
		`@import 'tailwindcss';`,
		``,
		`@layer base {`,
		`\thtml { scroll-behavior: smooth; }`,
		`}`,
		'',
	].join('\n'));

	// ═══════════════════════════════════════════════════════════
	// app/layout.vsk — Root layout with Tailwind
	// ═══════════════════════════════════════════════════════════
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

	// ── app/middleware.vsk — Root middleware with onion model ──
	writeFileSync(join(appDir, 'middleware.vsk'), [
		`// Vesk Middleware — onion model (ctx, next)`,
		`//`,
		`// ctx = { request, params, url, locals, cookies }`,
		`//   locals — mutable object shared with page/API`,
		`// next() — passes to next middleware or page render`,
		`// next('/rewrite') — rewrites URL in place`,
		`//`,
		`// Short-circuit: return Response without calling next()`,
		`// Onion: do before work, await next(), do after work`,
		``,
		`export async function middleware(ctx, next) {`,
		`\t// Example: set locals for pages`,
		`\t// ctx.locals.user = { name: 'Alice' };`,
		`\t//`,
		`\t// Example: block access`,
		`\t// if (!ctx.cookies?.token) {`,
		`\t//   return new Response('Unauthorized', { status: 401 });`,
		`\t// }`,
		`\t//`,
		`\t// Example: timing (onion)`,
		`\t// const start = Date.now();`,
		`\t// const response = await next();`,
		`\t// response.headers.set('X-Timing', String(Date.now() - start));`,
		`\t// return response;`,
		``,
		`\treturn next();`,
		`}`,
		'',
	].join('\n'));

	// ── app/page.vsk — Home ─────────────────────────────────
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

	// ── app/about/page.vsk ──────────────────────────────────
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

	// ── app/blog/page.vsk ───────────────────────────────────
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

	// ── app/blog/[slug]/page.vsk ────────────────────────────
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

	// ── public/favicon.svg ──────────────────────────────────
	writeFileSync(join(targetDir, 'public', 'favicon.svg'), [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2563eb"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-family="system-ui" font-weight="bold">V</text></svg>`,
		'',
	].join('\n'));

	// ── .gitignore ───────────────────────────────────────────
	writeFileSync(join(targetDir, '.gitignore'), [
		`node_modules/`,
		`dist/`,
		`.vesk/`,
		`.vsk-cache/`,
		`*.log`,
		`.DS_Store`,
		'',
	].join('\n'));

	// ═══════════════════════════════════════════════════════════
	// app/api/hello/route.ts — Sample API route
	// ═══════════════════════════════════════════════════════════
	const apiDir = join(appDir, 'api', 'hello');
	mkdirSync(apiDir, { recursive: true });
	writeFileSync(join(apiDir, 'route.ts'), [
		`// Vesk API Route — app/api/hello/route.ts`,
		`// Signature (Next.js App Router):`,
		`//   export async function GET(request, { params }) {`,
		`//     const { id } = await params;`,
		`//     return Response.json({ id });`,
		`//   }`,
		``,
		`import type { NextRequest } from '@vesk/runtime';`,
		``,
		`export async function GET(request: NextRequest) {`,
		`	const token = request.cookies?.token || '(none)';`,
		`	return Response.json({`,
		`		message: 'Hello from Vesk API!',`,
		`		timestamp: Date.now(),`,
		`		url: request.url,`,
		`		token,`,
		`	});`,
		`}`,
		``,
		`export async function POST(request: NextRequest) {`,
		`	const body = await request.json();`,
		`	return Response.json({ received: body, ok: true }, { status: 201 });`,
		`}`,
		'',
	].join('\n'));

	// ═══════════════════════════════════════════════════════════
	// app/api/echo/[msg]/route.ts — Dynamic API route
	// ═══════════════════════════════════════════════════════════
	const echoDir = join(appDir, 'api', 'echo', '[msg]');
	mkdirSync(echoDir, { recursive: true });
	writeFileSync(join(echoDir, 'route.ts'), [
		`// Dynamic API route — /api/echo/hello  →  params.msg === "hello"`,
		``,
		`export async function GET(request: Request, { params }: { params: Promise<Record<string, string>> }) {`,
		`	const { msg } = await params;`,
		`	return Response.json({ message: msg || '(empty)', method: 'GET' });`,
		`}`,
		'',
	].join('\n'));

	const projectLabel = projectName === '.' ? 'current directory' : projectName.startsWith('/') ? projectName : `./${projectName}`;
	console.error(`vesk: created new project in ${projectLabel}`);
	console.error(``);
	console.error(`  ${projectName === '.' ? '' : 'cd ' + projectName + ' && '}npm install`);
	console.error(`  ${projectName === '.' ? '' : 'cd ' + projectName + ' && '}npm run build`);
	process.exit(0);
}

// ── Config loader ──────────────────────────────────────────────
async function loadConfig(projectDir) {
  const jsPath = join(projectDir, 'vesk.config.js');
  const tsPath = join(projectDir, 'vesk.config.ts');
  let configPath = null;
  if (existsSync(jsPath)) configPath = jsPath;
  else if (existsSync(tsPath)) configPath = tsPath;

  if (!configPath) return {};

  const { defineConfig, validateConfig } = await import(
    resolve(__dirname, '../../compiler/src/config.js')
  );

  let raw;
  if (configPath.endsWith('.ts')) {
    const { transpile } = await import('typescript');
    const src = readFileSync(configPath, 'utf-8');
    const result = transpile(src, { module: 99, target: 99 });
    const tmpFile = join(projectDir, '.vesk', 'config.tmp.js');
    mkdirSync(dirname(tmpFile), { recursive: true });
    writeFileSync(tmpFile, result, 'utf-8');
    raw = (await import(tmpFile)).default;
  } else {
    raw = (await import(configPath)).default;
  }

  const config = typeof defineConfig === 'function' ? defineConfig(raw) : raw;
  if (typeof validateConfig === 'function') validateConfig(config);
  return config;
}

// ── build ────────────────────────────────────────────────────
if (cmd === 'build') {
  const projectDir = process.cwd();
  const appDirPath = join(projectDir, 'app');
  const publicDir = join(projectDir, 'public');

  if (!existsSync(appDirPath)) {
    console.error(`vesk build: no app/ directory found in ${projectDir}`);
    process.exit(1);
  }

  const config = await loadConfig(projectDir);
  const plugins = config.plugins || [];
  const opts = { publicDir, plugins };

  const { build } = await import(resolve(__dirname, '../../adapter/src/index.js'));
  try {
    await build(appDirPath, opts);
    console.error(`vesk build: done`);
  } catch (e) {
    console.error(`vesk build: error — ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── start ────────────────────────────────────────────────────
if (cmd === 'start') {
  const projectDir = process.cwd();
  const outDir = join(projectDir, '.vesk');
  const port = parseInt(args[1], 10) || 3000;

  const { startProdServer } = await import(resolve(__dirname, '../../adapter/src/index.js'));
  startProdServer(outDir, { port });
  await new Promise(() => {});
}

// ── dev ──────────────────────────────────────────────────────
if (cmd === 'dev') {
	const projectDir = process.cwd();
	const appDirPath = join(projectDir, 'app');
	const publicDir = join(projectDir, 'public');
	const port = parseInt(args[1], 10) || 3000;

	if (!existsSync(appDirPath)) {
		console.error(`vesk: no app/ directory found in ${projectDir}`);
		console.error(`Run "vesk init" first`);
		process.exit(1);
	}

	const { renderPage, renderFullPage } = await import('../../compiler/src/server-codegen.js');
	const { compileClient } = await import('../../compiler/src/client-codegen.js');
	const { scanRoutes, matchUrl, collectSources } = await import('../../compiler/src/router.js');
	const { scanApiRoutes, matchApiUrl, buildWebRequest, executeApiRoute } = await import('../../compiler/src/api-routes.js');
	const { collectMiddlewareChain, executeMiddlewareChain } = await import('../../compiler/src/middleware.js');
	const { createServer } = await import('node:http');
	const { WebSocketServer } = await import('ws');
	const { watch, readFileSync, statSync, existsSync: fsExists } = await import('node:fs');
	const { resolve: resolvePath, extname, join: joinPath } = await import('node:path');

	const runtimeDir = resolvePath(projectDir, 'node_modules', '@vesk/runtime', 'src');
	if (!fsExists(runtimeDir)) {
		console.error(`vesk: @vesk/runtime not found. Run npm install first.`);
		process.exit(1);
	}

	const devConfig = await loadConfig(projectDir);
	const devPlugins = devConfig.plugins || [];

	// Build CSS through plugin pipeline
	let devCssContent = '';
	const srcDir = joinPath(projectDir, 'src');
	const cssPath = joinPath(srcDir, 'global.css');
	const altCssPath = joinPath(srcDir, 'app.css');
	if (fsExists(cssPath)) {
		devCssContent = readFileSync(cssPath, 'utf-8');
	} else if (fsExists(altCssPath)) {
		devCssContent = readFileSync(altCssPath, 'utf-8');
	}
	if (devCssContent) {
		for (const plugin of devPlugins) {
			if (typeof plugin.onBuildStart === 'function') {
				await plugin.onBuildStart();
			}
		}
		for (const plugin of devPlugins) {
			if (typeof plugin.onCSS === 'function') {
				const result = await plugin.onCSS(devCssContent, cssPath);
				if (result !== null && typeof result === 'string') {
					devCssContent = result;
				}
			}
		}
	}

	let routeTree = scanRoutes(appDirPath);
	let clientBundle = '';
	let runtimeBundle = '';

	function bundleRuntime() {
		try {
		const files = [
			'ripple-constants.js', 'ripple-utils.js', 'ripple-runtime.js', 'ripple-blocks.js',
			'context.js', 'hydrate.js', 'resource.js', 'portal.js',
			'reconcile.js', 'bindings.js', 'router.js', 'request.js',
		];
			let code = '';
			for (const f of files) {
				const p = joinPath(runtimeDir, f);
				if (fsExists(p)) {
					let src = readFileSync(p, 'utf-8');
					src = src.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?\n?/gm, '');
					src = src.replace(/^export\s+/gm, '');
					code += `// --- ${f} ---\n${src}\n`;
				}
			}
			const indexSrc = readFileSync(joinPath(runtimeDir, 'index-client.js'), 'utf-8');
			const exportNames = indexSrc.match(/export\s*\{\s*([^}]+)\s*\}\s*from/g)
				?.flatMap(m => m.replace(/export\s*\{\s*|\s*\}\s*from/g, '').split(',').map(s => s.trim()))
				|| [];
			code += `// --- exports ---\n`;
			for (const name of [...new Set(exportNames)]) {
				if (name) code += `export { ${name} };\n`;
			}
			runtimeBundle = code;
			console.error(`vesk: runtime bundle: ${code.length} bytes`);
		} catch (e) {
			console.error(`vesk: runtime bundle error:`, e.message);
		}
	}

	async function buildClientBundle() {
		try {
			const seen = new Set();
			const sources = collectSources(routeTree);
			const componentLines = [];
			const hydratorLines = [];
			const aliasLines = [];
			const hydratorAliasLines = [];
			const runtimeImportNames = new Set();
			runtimeImportNames.add('track');
			runtimeImportNames.add('get');
			runtimeImportNames.add('set');
			runtimeImportNames.add('destroy_block');
			runtimeImportNames.add('getActiveComponent');
			runtimeImportNames.add('setActiveComponent');
			runtimeImportNames.add('effect');
			runtimeImportNames.add('createFileRouter');
			runtimeImportNames.add('NavLink');
			runtimeImportNames.add('Link');

			for (const [compName, sourcePath] of sources) {
				if (seen.has(sourcePath)) continue;
				seen.add(sourcePath);
				const src = readFileSync(sourcePath, 'utf-8');

				// Non-hydrate version — for SPA navigation
				const compCode = compileClient(src, null, { forceClient: true });
				if (compCode) {
					const stripped = compCode
						.replace(/^import\s*\{[^}]*\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm, (match) => {
							const names = match.match(/\{([^}]*)\}/)?.[1] || '';
							names.split(',').map(s => s.trim()).filter(Boolean).forEach(n => runtimeImportNames.add(n));
							return '';
						})
						.replace(/^const __components = \{\};\s*\n?/gm, '')
						.replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, '');
					const withoutLeadingBlank = stripped.replace(/^\n+/, '').replace(/\n+$/, '');
					componentLines.push(withoutLeadingBlank);
					const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
					if (actualName && actualName !== compName) {
						aliasLines.push(`__components[${JSON.stringify(compName)}] = __components[${JSON.stringify(actualName)}];`);
					}
				}

				// Hydrate version — for initial hydration
				const hydCode = compileClient(src, null, { hydrate: true, forceClient: true });
				if (hydCode) {
					const stripped = hydCode
						.replace(/^import\s*\{[^}]*\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm, (match) => {
							const names = match.match(/\{([^}]*)\}/)?.[1] || '';
							names.split(',').map(s => s.trim()).filter(Boolean).forEach(n => runtimeImportNames.add(n));
							return '';
						})
						.replace(/^const __components = \{\};\s*\n?/gm, '')
						.replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, '')
						.replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '')
						.replace(/__components/g, '__hydrators');
					const withoutLeadingBlank = stripped.replace(/^\n+/, '').replace(/\n+$/, '');
					hydratorLines.push(withoutLeadingBlank);
					const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
					if (actualName && actualName !== compName) {
						hydratorAliasLines.push(`__hydrators[${JSON.stringify(compName)}] = __hydrators[${JSON.stringify(actualName)}];`);
					}
				}
			}

			const importStr = [...runtimeImportNames].join(', ');
			clientBundle = '';
			clientBundle += `import { ${importStr} } from '/_vesk/runtime.js';\n\n`;
			clientBundle += `const __components = {};\n\n`;
			clientBundle += `const __hydrators = {};\n\n`;
			clientBundle += `const __runtime_comps = __components;\n\n`;
			clientBundle += componentLines.join('\n\n');
			if (aliasLines.length > 0) {
				clientBundle += '\n' + aliasLines.join('\n') + '\n';
			}
			if (hydratorLines.length > 0) {
				clientBundle += '\n' + hydratorLines.join('\n') + '\n';
			}
			if (hydratorAliasLines.length > 0) {
				clientBundle += '\n' + hydratorAliasLines.join('\n') + '\n';
			}
			clientBundle += `\nfunction __cleanup(start, end) {\n\tlet n = start.nextSibling;\n\twhile (n && n !== end) {\n\t\tconst next = n.nextSibling;\n\t\tn.remove();\n\t\tn = next;\n\t}\n}\n`;
			const treeJson = JSON.stringify(routeTree);
			clientBundle += `\nconst __routeTree = ${treeJson};\n`;
			clientBundle += `function __resolveNames(nodes) { for (const n of nodes) { if (typeof n.page === 'string') { n._pageName = n.page; n.page = __components[n.page]; } if (typeof n.layout === 'string') { n._layoutName = n.layout; n.layout = __components[n.layout]; } if (n.children) __resolveNames(n.children); } }\n`;
			clientBundle += `__resolveNames(__routeTree);\n`;
			clientBundle += `const __router = createFileRouter(__routeTree);\n`;
			clientBundle += `__router.__hydrators = __hydrators;\n`;
			clientBundle += `globalThis.__vesk_router = __router;\n`;
			clientBundle += `if (typeof document !== 'undefined') __router.start();\n`;
			console.error(`vesk: client bundle: ${clientBundle.length} bytes`);
		} catch (e) {
			console.error(`vesk: client build error:`, e.message);
		}
	}

	bundleRuntime();
	await buildClientBundle();

	try {
		let debounceTimer = null;
		watch(appDirPath, { recursive: true }, (eventType, filename) => {
			if (filename && filename.endsWith('.vsk')) {
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(async () => {
					try {
						routeTree = scanRoutes(appDirPath);
						updateSourceMapping();
						const changedSource = filename.startsWith('/') ? filename : joinPath(appDirPath, filename);
						const changedComponents = sourceToComponents.get(changedSource) || [];

						clientBundle = '';
						await buildClientBundle();

						if (changedComponents.length > 0 && typeof globalThis.__vesk_broadcastHmr === 'function') {
							globalThis.__vesk_broadcastHmr({
								type: 'update',
								components: Object.fromEntries(changedComponents.map(name => [name, true]))
							});
						}
						console.error(`vesk: rebuilt (${filename})`);
					} catch (e) {
						console.error(`vesk: rebuild error:`, e.message);
					}
				}, 200);
			}
		});
	} catch (e) {
		console.error(`vesk: file watching unavailable, serving without auto-rebuild`);
	}

	const MIME = {
		'.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'application/javascript',
		'.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
		'.html': 'text/html', '.json': 'application/json',
	};

	const HMR_CLIENT_SCRIPT = `if(typeof window!=='undefined'){try{const ws=new WebSocket('ws://'+(location.host||'localhost:3000')+'/_vesk/hmr');ws.onmessage=function(e){try{const msg=JSON.parse(e.data);if(msg.type==='update'){globalThis.__updatedComponents=new Set(Object.keys(msg.components));if(window.__vesk_router&&window.__vesk_router.hmrUpdate){window.__vesk_router.hmrUpdate();}}}catch(e){console.error('HMR parse error:',e)}};ws.onerror=function(){setTimeout(()=>location.reload(),1000)};}catch(e){}}`;

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://localhost:${port}`);

		// Runtime bundle
		if (url.pathname === '/_vesk/runtime.js') {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end(runtimeBundle);
			return;
		}

		// Client bundle
		if (url.pathname === '/_vesk/client.js') {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end(clientBundle);
			return;
		}

		// Static CSS (processed through plugins)
		if (url.pathname === '/_vesk/static/global.css') {
			res.writeHead(200, { 'Content-Type': 'text/css' });
			res.end(devCssContent);
			return;
		}

		// HMR client script
		if (url.pathname === '/_vesk/hmr.js') {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end(HMR_CLIENT_SCRIPT);
			return;
		}

		// Static files from public/
		if (url.pathname !== '/') {
			const staticPath = joinPath(publicDir, url.pathname);
			if (fsExists(staticPath) && statSync(staticPath).isFile()) {
				const ext = extname(staticPath);
				res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
				res.end(readFileSync(staticPath));
				return;
			}
		}

		// ── API Routes ─────────────────────────────────────────────
		const apiDirPath = joinPath(appDirPath, 'api');
		if (url.pathname.startsWith('/api') && fsExists(apiDirPath)) {
			const apiRoutes = await scanApiRoutes(apiDirPath);
			const apiMatch = matchApiUrl(apiRoutes, req.url || url.pathname);
			if (apiMatch) {
				const webRequest = buildWebRequest(req, req.url || url.pathname);
				const response = await executeApiRoute(apiMatch.node.filePath, (req.method || 'GET').toUpperCase(), webRequest, apiMatch.params);
				res.writeHead(response.status, Object.fromEntries(response.headers));
				const body = await response.text();
				res.end(body);
				return;
			}
		}

		// ── SSR route matching + layout composition ───────────────
		const match = matchUrl(routeTree, url.pathname);
		if (!match) {
			res.writeHead(404, { 'Content-Type': 'text/html' });
			res.end(`<!DOCTYPE html><html><body><h1>404</h1><p>${url.pathname}</p></body></html>`);
			return;
		}

		// Clean chain: only keep nodes that correspond to actual URL segments.
		const urlParts = url.pathname.split('/').filter(Boolean);
		const cleanChain = [];
		let segIdx = 0;
		for (const node of match.nodes) {
			if (node.fullPath === '/') {
				cleanChain.push(node);
			} else if (!node.isGroup && node.segmentCount > 0) {
				if (segIdx < urlParts.length) {
					cleanChain.push(node);
					segIdx++;
				}
			} else {
				cleanChain.push(node);
			}
		}

		// ── Middleware (onion model) + SSR ──
		const mwChain = collectMiddlewareChain(routeTree, url.pathname, appDirPath);

		async function renderSSR() {
			const chain = cleanChain;
			let body = '';
			let head = '';

			function extractCompName(src) {
				const m = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m);
				return m ? m[1] : null;
			}

			for (let i = chain.length - 1; i >= 0; i--) {
				const node = chain[i];
				const pageFilePath = resolvePath(appDirPath, node.sourceDir, 'page.vsk');
				const layoutFilePath = resolvePath(appDirPath, node.sourceDir, 'layout.vsk');

				if (i === chain.length - 1 && node.page && fsExists(pageFilePath)) {
					const src = readFileSync(pageFilePath, 'utf-8');
					const compName = extractCompName(src) || node.page;
					const result = renderPage(src, compName, { params: match.params }, new Map(), { hydrate: true });
					body = result.body;
					head = result.head || '';
				}

				if (node.layout && fsExists(layoutFilePath)) {
					const src = readFileSync(layoutFilePath, 'utf-8');
					const compName = extractCompName(src) || node.layout;
					const result = renderPage(src, compName, { children: body }, new Map(), { hydrate: true });
					body = result.body;
					head = (result.head || '') + head;
				}
			}

			const hasLayout = chain.some(n => n.layout && fsExists(resolvePath(appDirPath, n.sourceDir, 'layout.vsk')));
			let html;
			if (hasLayout) {
				const { prettifyHtml } = await import('../../compiler/src/server-codegen.js');
				html = `<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n${head ? '\t' + head.split('\n').join('\n\t') + '\n' : ''}</head>\n<body>\n<div id="root">\n${prettifyHtml(body)}\n</div>\n\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>\n</html>`;
			} else {
				const leaf = chain.find(n => n.page);
				if (leaf) {
					const src = readFileSync(resolvePath(appDirPath, leaf.sourceDir, 'page.vsk'), 'utf-8');
					const compName = extractCompName(src) || leaf.page;
					html = renderFullPage(src, compName, { params: match.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js' });
					html = html.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
				} else {
					throw new Error('No page or layout matched');
				}
			}
			return html;
		}

		let mwLocals = {};
		try {
			if (mwChain.length > 0) {
				const mwReq = new Request(`http://localhost${url.pathname}${url.search}`, {
					headers: req.headers,
					method: req.method || 'GET',
				});
				const mwResult = await executeMiddlewareChain(mwChain, mwReq, match.params, {
					onLast: async (rewrite) => {
						if (rewrite) url.pathname = rewrite;
						const ctx = {
							headers: Object.fromEntries(
								Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])
							),
							url: req.url,
							method: req.method || 'GET',
							cookies: (() => {
								const obj = {};
								const raw = req.headers.cookie || '';
								for (const pair of raw.split(';')) {
									const eq = pair.indexOf('=');
									if (eq === -1) continue;
									const k = pair.slice(0, eq).trim();
									const v = pair.slice(eq + 1).trim();
									if (k) obj[k] = v;
								}
								return obj;
							})(),
							locals: mwLocals,
						};
						const prev = globalThis.__vesk_request;
						globalThis.__vesk_request = ctx;
						try {
							const html = await renderSSR();
							return new Response(html, { headers: { 'Content-Type': 'text/html' } });
						} finally {
							globalThis.__vesk_request = prev;
						}
					},
				});
				mwLocals = mwResult.locals;
				if (mwResult.response) {
					res.writeHead(mwResult.response.status, Object.fromEntries(mwResult.response.headers));
					res.end(await mwResult.response.text());
					return;
				}
			} else {
				const ctx = {
					headers: Object.fromEntries(
						Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])
					),
					url: req.url,
					method: req.method || 'GET',
					cookies: (() => {
						const obj = {};
						const raw = req.headers.cookie || '';
						for (const pair of raw.split(';')) {
							const eq = pair.indexOf('=');
							if (eq === -1) continue;
							const k = pair.slice(0, eq).trim();
							const v = pair.slice(eq + 1).trim();
							if (k) obj[k] = v;
						}
						return obj;
					})(),
					locals: {},
				};
				const prev = globalThis.__vesk_request;
				globalThis.__vesk_request = ctx;
				try {
					const html = await renderSSR();
					const injected = html.replace('</body>', `\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>`);
					res.writeHead(200, { 'Content-Type': 'text/html' });
					res.end(injected);
				} finally {
					globalThis.__vesk_request = prev;
				}
				return;
			}
		} catch (e) {
			if (e.name === 'Redirect') {
				res.writeHead(e.status || 302, { Location: e.url });
				res.end(`<!DOCTYPE html><html><body><a href="${e.url}">Redirect</a></body></html>`);
			} else if (e.name === 'NotFoundError') {
				res.writeHead(404, { 'Content-Type': 'text/html' });
				res.end(`<!DOCTYPE html><html><body><h1>404 — Not Found</h1></body></html>`);
			} else {
				res.writeHead(500, { 'Content-Type': 'text/html' });
				res.end(`<!DOCTYPE html><html><body><h1>500</h1><pre>${e.message}\n${e.stack}</pre></body></html>`);
			}
		}
	});

	server.listen(port, () => {
		console.error(`vesk dev server at http://localhost:${port}`);
	});

	// Track source file -> component name mapping for HMR
	const sourceToComponents = new Map();
	function updateSourceMapping() {
		sourceToComponents.clear();
		for (const [compName, sourcePath] of collectSources(routeTree)) {
			const existing = sourceToComponents.get(sourcePath) || [];
			existing.push(compName);
			sourceToComponents.set(sourcePath, existing);
		}
	}
	updateSourceMapping();

	const hmrClients = new Set();
	const wss = new WebSocketServer({ noServer: true });
	wss.on('connection', (ws) => {
		hmrClients.add(ws);
		ws.on('close', () => hmrClients.delete(ws));
	});
	server.on('upgrade', (req, socket, head) => {
		if (req.url === '/_vesk/hmr') {
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit('connection', ws, req);
			});
		} else {
			socket.destroy();
		}
	});

	globalThis.__vesk_broadcastHmr = (update) => {
		const msg = JSON.stringify(update);
		for (const ws of hmrClients) {
			if (ws.readyState === 1) ws.send(msg);
		}
	};

	// Don't exit — keep serving
	await new Promise(() => {});
}

// ── Delegate to compiler bin ─────────────────────────────────
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
	process.exit(e.status || 1);
}
