#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename, resolve } from 'path'
import { argv, cwd, exit } from 'process'

const args = argv.slice(2)
const projectName = args[0]

if (!projectName || projectName.startsWith('-')) {
	console.error('Usage: npx create-vesk@latest <project-name>')
	exit(1)
}

const targetDir = resolve(cwd(), projectName)

if (existsSync(targetDir)) {
	console.error(`Error: directory "${projectName}" already exists`)
	exit(1)
}

const pkgName = basename(projectName)
const appDirPath = join(targetDir, 'app')
const srcDir = join(targetDir, 'src')

const dirs = [
	appDirPath,
	join(appDirPath, 'about'),
	join(appDirPath, 'blog'),
	join(appDirPath, 'blog', '[slug]'),
	join(appDirPath, 'posts'),
	join(appDirPath, 'statements'),
	join(appDirPath, 'api', 'posts'),
	join(appDirPath, 'api', 'hello'),
	join(appDirPath, 'api', 'echo', '[msg]'),
	srcDir,
	join(targetDir, 'public'),
]
for (const d of dirs) mkdirSync(d, { recursive: true })

// ── package.json ──
// `vesk dev` / `vesk build` / `vesk start` run the pure-TypeScript pipeline.
// esbuild is an optionalDependency: when its native binary cannot run on a
// machine, vesk falls back to esbuild-wasm automatically.
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
		'@vesk/compiler': '^0.2.9',
		'@vesk/runtime': '^0.2.9',
		'@vesk/types': '^0.2.9',
		'@vesk/vesk-cli': '^0.2.9',
		'@vesk/adapter': '^0.2.9',
		'@vesk/plugin-tailwind': '^0.2.9',
	},
	devDependencies: {
		tailwindcss: '^4.0.0',
		typescript: '^5.8.0',
	},
}, null, 2) + '\n')

// ── vesk.config.ts ──
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
	`\t\ttailwindcss({ entry: 'src/global.css', appDir: 'app' }),`,
	`\t],`,
	`\tssg: {},`,
	`});`,
	'',
].join('\n'))

// ── tsconfig.json ──
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
		paths: {
			'@/*': ['./src/*'],
			'@app/*': ['./app/*'],
		},
	},
	include: ['**/*.vsk', '**/*.js', '**/*.ts'],
	exclude: ['node_modules', 'dist'],
}, null, 2) + '\n')

// ── src/global.css ──
writeFileSync(join(srcDir, 'global.css'), [
	`@import 'tailwindcss';`,
	``,
	`@layer base {`,
	`\thtml { scroll-behavior: smooth; }`,
	`}`,
	'',
].join('\n'))

// ── app/layout.vsk ──
writeFileSync(join(appDirPath, 'layout.vsk'), [
	`import type { Component } from '@vesk/types';`,
	`import { NavLink } from '@vesk/runtime/router';`,
	'',
	`interface LayoutProps {`,
	`\tchildren?: Component`,
	`}`,
	'',
	`component Layout(props: LayoutProps) {`,
	`\t<nav class="flex gap-6 px-8 py-4 border-b border-gray-200 bg-white">`,
	`\t\t<NavLink href="/" class="text-gray-500 hover:text-black font-medium no-underline">Home</NavLink>`,
	`\t\t<NavLink href="/about" class="text-gray-500 hover:text-black font-medium no-underline">About</NavLink>`,
	`\t\t<NavLink href="/blog" class="text-gray-500 hover:text-black font-medium no-underline">Blog</NavLink>`,
	`\t\t<NavLink href="/posts" class="text-gray-500 hover:text-black font-medium no-underline">Posts</NavLink>`,
	`\t\t<NavLink href="/statements" class="text-gray-500 hover:text-black font-medium no-underline">Statements</NavLink>`,
	`\t</nav>`,
	`\t<main class="max-w-3xl mx-auto my-8 px-4">{props.children}</main>`,
	`\t<footer class="text-center py-8 text-gray-400 text-sm">`,
	`\t\t<p>Powered by Vesk</p>`,
	`\t</footer>`,
	`}`,
	'',
].join('\n'))

// ── app/page.vsk ──
writeFileSync(join(appDirPath, 'page.vsk'), [
	`import { track } from '@vesk/runtime'`,
	``,
	`component Home {`,
	`\t<Head>`,
	`\t\t<title>${pkgName}</title>`,
	`\t</Head>`,
	`\tconst &[count] = track(0)`,
	``,
	`\t<h1 class="text-4xl font-bold mb-2">Welcome to Vesk</h1>`,
	`\t<p class="text-gray-500 mb-4">`,
	`\t\tA compiler-first reactive UI framework for the post-VDOM web.`,
	`\t</p>`,
	`\t<p class="text-2xl font-semibold">count: {count}</p>`,
	`\t<button onClick={() => count++} class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg mr-2">+</button>`,
	`\t<button onClick={() => count--} class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg">-</button>`,
	`\t<div class="bg-white rounded-xl p-6 mt-8 shadow-sm border border-gray-100">`,
	`\t\t<h2 class="text-xl font-semibold mb-2">Getting Started</h2>`,
	`\t\t<p>Edit <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">app/page.vsk</code> to change this page.</p>`,
	`\t</div>`,
	`}`,
	'',
].join('\n'))

// ── app/about/page.vsk ──
writeFileSync(join(appDirPath, 'about', 'page.vsk'), [
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
].join('\n'))

// ── app/blog/page.vsk ──
writeFileSync(join(appDirPath, 'blog', 'page.vsk'), [
	`import { Link } from '@vesk/runtime/router';`,
	``,
	`component Blog {`,
	`\t<h1 class="text-3xl font-bold mb-4">Blog</h1>`,
	`\t<div class="bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100">`,
	`\t\t<h2 class="text-lg font-semibold mb-1">`,
	`\t\t\t<Link href="/blog/hello-world" class="text-gray-900 no-underline hover:text-blue-600">Hello World</Link>`,
	`\t\t</h2>`,
	`\t\t<p class="text-gray-400 text-sm">First post powered by Vesk</p>`,
	`\t</div>`,
	`\t<div class="bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100">`,
	`\t\t<h2 class="text-lg font-semibold mb-1">`,
	`\t\t\t<Link href="/blog/ssr-in-vesk" class="text-gray-900 no-underline hover:text-blue-600">SSR in Vesk</Link>`,
	`\t\t</h2>`,
	`\t\t<p class="text-gray-400 text-sm">How server-side rendering works</p>`,
	`\t</div>`,
	`}`,
	'',
].join('\n'))

// ── app/blog/[slug]/page.vsk ──
writeFileSync(join(appDirPath, 'blog', '[slug]', 'page.vsk'), [
	`import { Link } from '@vesk/runtime/router';`,
	``,
	`component BlogPost(props: { params: { slug: string } }) {`,
	`\t<Link href="/blog" class="inline-block mb-6 text-blue-600 no-underline hover:underline">`,
	`\t\t← Back to blog`,
	`\t</Link>`,
	`\t<h1 class="text-3xl font-bold mb-2">Post: {props.params.slug}</h1>`,
	`\t<div class="text-gray-600 leading-relaxed">`,
	`\t\t<p>This is a dynamic blog post rendered at <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">/{props.params.slug}</code>.</p>`,
	`\t</div>`,
	`}`,
	'',
].join('\n'))

// ── app/posts/page.vsk ──
writeFileSync(join(appDirPath, 'posts', 'page.vsk'), [
	`import { track } from '@vesk/runtime'`,
	``,
	`component PostCard(props) {`,
	`\t<article class="bg-white rounded-lg p-6 mb-4 shadow-sm border border-gray-100">`,
	`\t\t<div class="flex items-center justify-between mb-2">`,
	`\t\t\t<h2 class="text-xl font-semibold">{props.post.title}</h2>`,
	`\t\t\t<span class="text-gray-400 text-sm">{props.post.date}</span>`,
	`\t\t</div>`,
	`\t\t<p class="text-gray-500 mb-3">{props.post.excerpt}</p>`,
	`\t\t<div class="flex gap-2 mb-3">`,
	`\t\t\tfor (const tag in props.post.tags) {`,
	`\t\t\t\t<span class="bg-blue-50 text-blue-600 text-xs px-2 py-1 rounded-full">{tag}</span>`,
	`\t\t\t}`,
	`\t\t</div>`,
	`\t\t<p class="text-gray-400 text-sm">By {props.post.author}</p>`,
	`\t</article>`,
	`}`,
	``,
	`export default component Posts {`,
	`\t<Head>`,
	`\t\t<title>Posts — useFetch demo</title>`,
	`\t</Head>`,
	`\tlet &[posts] = track<{ id: number; title: string; slug: string; excerpt: string; author: string; tags: string[]; date: string }[]>([])`,
	`\tconst postsResource = useFetch('/api/posts', {`,
	`\t\tkey: 'posts',`,
	`\t\tinto: posts,`,
	`\t\tstaleTime: 30000,`,
	`\t\tkeepPreviousData: true,`,
	`\t\tretry: 2,`,
	`\t\tretryDelay: 400,`,
	`\t\ttimeout: 8000,`,
	`\t})`,
	`\t<div class="flex items-center justify-between mb-6">`,
	`\t\t<div>`,
	`\t\t\t<h1 class="text-3xl font-bold mb-1">Posts</h1>`,
	`\t\t\t<p class="text-gray-500">`,
	`\t\t\t\tFetched with useFetch — deduped, cached with staleTime, retried with backoff, timed out,`,
	`\t\t\t\tand written into a tracked cell.`,
	`\t\t\t</p>`,
	`\t\t</div>`,
	`\t\t<div class="flex items-center gap-3">`,
	`\t\t\t<span class="text-sm text-gray-400">{postsResource.loading ? (posts.length > 0 ? 'Refreshing…' : 'Loading…') : 'Fresh'}</span>`,
	`\t\t\t<button onClick={() => postsResource.refresh()} class="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg">Refresh</button>`,
	`\t\t</div>`,
	`\t</div>`,
	`\tif (postsResource.error) {`,
	`\t\t<div class="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4">`,
	`\t\t\t<p class="mb-2">Failed to load posts: {postsResource.error.message}</p>`,
	`\t\t\t<button onClick={() => postsResource.refresh()} class="bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-lg">Retry</button>`,
	`\t\t</div>`,
	`\t}`,
	`\tfor (const post of posts) {`,
	`\t\t<PostCard post={post} />`,
	`\t}`,
	`}`,
	'',
].join('\n'))

// ── app/statements/page.vsk ──
writeFileSync(join(appDirPath, 'statements', 'page.vsk'), [
	`component Statements {`,
	`\t<Head>`,
	`\t\t<title>Statements — every JS construct</title>`,
	`\t</Head>`,
	`\tconst items = ['alpha', 'beta', 'gamma']`,
	`\tconst obj = { name: 'Vesk', year: 2026, tags: ['fast', 'reactive'] }`,
	`\tconst score = 7`,
	`\tlet n = 0`,
	``,
	`\t<h1 class="text-3xl font-bold mb-4">JS Statement Demo</h1>`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">if / else</h2>`,
	`\tif (score > 5) {`,
	`\t\t<p class="text-green-600">Score {score} is above the threshold</p>`,
	`\t} else {`,
	`\t\t<p class="text-red-600">Score {score} is low</p>`,
	`\t}`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">ternary</h2>`,
	`\t<p>{score % 2 === 0 ? 'even' : 'odd'}</p>`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">switch</h2>`,
	`\tswitch (score) {`,
	`\t\tcase 1:`,
	`\t\t\t<p>One</p>`,
	`\t\t\tbreak`,
	`\t\tcase 7:`,
	`\t\t\t<p>Seven</p>`,
	`\t\t\tbreak`,
	`\t\tdefault:`,
	`\t\t\t<p>Something else</p>`,
	`\t}`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">for loop</h2>`,
	`\tfor (let i = 0; i < 3; i++) {`,
	`\t\t<span class="mr-2">i={i}</span>`,
	`\t}`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">for-of (array values)</h2>`,
	`\tfor (const item of items) {`,
	`\t\t<span class="mr-2">{item}</span>`,
	`\t}`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">for-in (object keys)</h2>`,
	`\tfor (const key in obj) {`,
	`\t\t<span class="mr-2">{key}:{obj[key]}</span>`,
	`\t}`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">while</h2>`,
	`\twhile (n < 3) {`,
	`\t\t<span class="mr-2">{n}</span>`,
	`\t\tn = n + 1`,
	`\t}`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">try / catch / throw</h2>`,
	`\ttry {`,
	`\t\tthrow new Error('Boom!')`,
	`\t} catch(e) {`,
	`\t\t<p class="text-red-600">Caught: {e.message}</p>`,
	`\t}`,
	``,
	`\t<h2 class="text-xl font-semibold mt-6 mb-2">runtime statements</h2>`,
	`\tconst total = items.length * 2`,
	`\t<p>items.length * 2 = {total}</p>`,
	`}`,
	'',
].join('\n'))

// ── app/middleware.ts ──
writeFileSync(join(appDirPath, 'middleware.ts'), [
	`// Vesk Middleware — onion model (ctx, next)`,
	`// ctx = { request, params, url, locals, cookies, set, get }`,
	`//   ctx.set('user', val) → ctx.locals.user`,
	`//   ctx.user             → ctx.locals.user`,
	`// next() — passes to next middleware or page render`,
	`// next('/rewrite') — rewrites URL in place`,
	`// Short-circuit: return Response without calling next()`,
	`// Types come from @vesk/types (import type { MiddlewareContext }).`,
	``,
	`export async function middleware(ctx, next) {`,
	`\tctx.set('startTime', Date.now());`,
	`\treturn next();`,
	`}`,
	'',
].join('\n'))

// ── app/not-found.vsk ──
writeFileSync(join(appDirPath, 'not-found.vsk'), [
	`import { Link } from '@vesk/runtime/router';`,
	``,
	`component NotFound404(props) {`,
	`\t<main class="max-w-3xl mx-auto my-16 px-4 text-center">`,
	`\t\t<h1 class="text-6xl font-bold text-gray-200 mb-4">404</h1>`,
	`\t\t<h2 class="text-2xl font-semibold mb-2">Page Not Found</h2>`,
	`\t\t<p class="text-gray-500 mb-8">Sorry, we couldn't find <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">{props.url}</code></p>`,
	`\t\t<Link href="/" class="text-blue-600 no-underline hover:underline font-medium">← Go home</Link>`,
	`\t</main>`,
	`}`,
	'',
].join('\n'))

// ── app/error.vsk ──
writeFileSync(join(appDirPath, 'error.vsk'), [
	`component ErrorPage(props) {`,
	`\t<div class="min-h-screen flex items-center justify-center bg-gray-50">`,
	`\t\t<div class="max-w-2xl mx-auto p-8 bg-white rounded-xl shadow-sm border border-gray-200">`,
	`\t\t\t<h1 class="text-4xl font-bold text-red-600 mb-4">Error {props.statusCode}</h1>`,
	`\t\t\t<p class="text-lg text-gray-700 mb-6">{props.error}</p>`,
	`\t\t\t<pre class="bg-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto max-h-64 overflow-y-auto">{props.stack}</pre>`,
	`\t\t\t<p class="mt-6 text-gray-500 text-sm">{props.url}</p>`,
	`\t\t</div>`,
	`\t</div>`,
	`}`,
	'',
].join('\n'))

// ── app/api/posts/route.ts ──
writeFileSync(join(appDirPath, 'api', 'posts', 'route.ts'), [
	`import type { VeskRequest } from '@vesk/types';`,
	`import { VeskResponse } from '@vesk/runtime/server';`,
	``,
	`export interface Post {`,
	`\tid: number;`,
	`\ttitle: string;`,
	`\tslug: string;`,
	`\texcerpt: string;`,
	`\tbody: string;`,
	`\tauthor: string;`,
	`\ttags: string[];`,
	`\tdate: string;`,
	`}`,
	``,
	`const posts: Post[] = [`,
	`\t{`,
	`\t\tid: 1,`,
	`\t\ttitle: 'Hello Vesk',`,
	`\t\tslug: 'hello-vesk',`,
	`\t\texcerpt: 'First post powered by Vesk — a compiler-first reactive UI framework for the post-VDOM web.',`,
	`\t\tbody: 'Vesk compiles your components to targeted, minimal JavaScript with a ripple-reactive runtime. No virtual DOM, no diffing — just direct DOM updates where things change.',`,
	`\t\tauthor: 'Vesk Team',`,
	`\t\ttags: ['intro', 'compiler'],`,
	`\t\tdate: '2026-07-01',`,
	`\t},`,
	`\t{`,
	`\t\tid: 2,`,
	`\t\ttitle: 'SSR in Vesk',`,
	`\t\tslug: 'ssr-in-vesk',`,
	`\t\texcerpt: 'How server-side rendering works, including awaiting in-flight fetches before writing the body.',`,
	`\t\tbody: 'Server components render to HTML while useFetch promises are in flight. The renderer awaits them, re-renders with data, and serializes the results so the client hydrates without re-fetching.',`,
	`\t\tauthor: 'Vesk Team',`,
	`\t\ttags: ['ssr', 'fetch'],`,
	`\t\tdate: '2026-07-08',`,
	`\t},`,
	`\t{`,
	`\t\tid: 3,`,
	`\t\ttitle: 'Reactivity without a VDOM',`,
	`\t\tslug: 'no-vdom',`,
	`\t\texcerpt: 'Ripple tracked cells and fine-grained effects mean only the exact nodes that changed are updated.',`,
	`\t\tbody: 'Tracked cells, derived values, and scoped effects let Vesk update exactly the DOM that depends on a change — no tree diffing, no reconciliation pass. Mutate a cell and the precise text nodes, attributes, or lists re-render.',`,
	`\t\tauthor: 'Vesk Team',`,
	`\t\ttags: ['reactivity', 'performance'],`,
	`\t\tdate: '2026-07-22',`,
	`\t},`,
	`];`,
	``,
	`export async function GET(req: VeskRequest) {`,
	`\tconst limit = Math.min(Number(req.query.limit) || posts.length, posts.length);`,
	`\tconst list = posts.slice(0, limit).map(({ body: _body, ...rest }) => rest);`,
	`\treturn VeskResponse.json(list);`,
	`}`,
	'',
].join('\n'))

// ── app/api/hello/route.ts ──
writeFileSync(join(appDirPath, 'api', 'hello', 'route.ts'), [
	`import type { VeskRequest } from '@vesk/types';`,
	`import { VeskResponse } from '@vesk/runtime/server';`,
	``,
	`export async function GET(req: VeskRequest) {`,
	`\treturn VeskResponse.json({ message: 'Hello from Vesk!' })`,
	`\t\t.setCookie('session', 'abc123', { httpOnly: true, secure: true, path: '/', maxAge: 3600 });`,
	`}`,
	``,
	`export async function POST(req: VeskRequest) {`,
	`\tconst body = await req.json();`,
	`\treturn VeskResponse.json({ received: body, ok: true }, { status: 201 });`,
	`}`,
	'',
].join('\n'))

// ── app/api/echo/[msg]/route.ts ──
writeFileSync(join(appDirPath, 'api', 'echo', '[msg]', 'route.ts'), [
	`// Dynamic API route — /api/echo/hello  →  params.msg === "hello"`,
	``,
	`export async function GET(request: Request, { params }: { params: Promise<Record<string, string>> }) {`,
	`\tconst { msg } = await params;`,
	`\treturn Response.json({ message: msg || '(empty)', method: 'GET' });`,
	`}`,
	'',
].join('\n'))

// ── public/favicon.svg ──
writeFileSync(join(targetDir, 'public', 'favicon.svg'), [
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2563eb"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-family="system-ui" font-weight="bold">V</text></svg>`,
	'',
].join('\n'))

// ── .env.example ──
writeFileSync(join(targetDir, '.env.example'), [
	`# Vesk environment variables (copy to .env.local for local overrides)`,
	`# These are loaded automatically in dev and build commands.`,
	``,
	`# Example:`,
	`# DATABASE_URL=postgres://user:pass@localhost:5432/db`,
	`# STRIPE_SECRET=sk_test_...`,
	`# PUBLIC_API_URL=https://api.example.com`,
	'',
].join('\n'))

// ── .gitignore ──
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
].join('\n'))

// ── README.md ──
writeFileSync(join(targetDir, 'README.md'), [
	`# ${pkgName}`,
	'',
	`Created with [create-vesk](https://www.npmjs.com/package/create-vesk) — a new [Vesk](https://vesk.dev) project.`,
	'',
	`## Getting started`,
	'',
	'```bash',
	'npm install',
	'npm run dev',
	'```',
	'',
	'## Scripts',
	'',
	`- \`npm run dev\` — dev server with HMR at http://localhost:3000`,
	`- \`npm run build\` — production build (SSG + SSR) into \`.vesk/\``,
	`- \`npm run start\` — run the production server`,
	`- \`npm run typecheck\` — typecheck \`app/\` and \`src/\``,
	'',
	'## Project structure',
	'',
	'```',
	'app/',
	'  layout.vsk           # root layout (nav + {props.children})',
	'  page.vsk             # / — tracked counter',
	'  about/page.vsk       # /about',
	'  blog/page.vsk        # /blog',
	'  blog/[slug]/page.vsk # /blog/:slug (dynamic)',
	'  posts/page.vsk       # /posts — useFetch + tracked cell',
	'  statements/page.vsk  # /statements — every JS construct',
	'  not-found.vsk        # custom 404',
	'  error.vsk            # custom error page',
	'  middleware.ts        # request middleware (onion model)',
	'  api/posts/route.ts   # /api/posts',
	'  api/hello/route.ts   # /api/hello',
	'src/global.css        # tailwind entry',
	'public/               # static assets',
	'vesk.config.ts        # framework config',
	'```',
	'',
].join('\n'))

console.log('')
console.log(`  ${pkgName} created successfully!`)
console.log('')
console.log(`  cd ${projectName}`)
console.log('  npm install')
console.log('  npm run dev')
console.log('')
