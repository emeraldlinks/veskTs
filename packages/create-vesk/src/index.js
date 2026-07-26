#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename, resolve } from 'path'
import { argv, cwd, exit } from 'process'

const args = argv.slice(2)
const projectName = args[0]
const useRouter = args.includes('--router')

if (!projectName || projectName.startsWith('--')) {
	console.error('Usage: npx create-vesk@latest <project-name> [--router]')
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

const dirs = [appDirPath, srcDir, join(targetDir, 'public')]
if (useRouter) {
	dirs.push(join(appDirPath, 'about'), join(appDirPath, 'blog'),
		join(appDirPath, 'blog', '[slug]'))
}
for (const d of dirs) mkdirSync(d, { recursive: true })

// ── package.json ──
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
		tailwindcss: '^4.0.0',
		typescript: '^5.8.0',
	},
}, null, 2) + '\n')

// ── vesk.config.ts ──
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
		baseUrl: '.',
		paths: {
			'@/*': ['./src/*'],
			'@app/*': ['./app/*'],
		},
	},
	include: ['**/*.vsk', '**/*.js', '**/*.ts'],
	exclude: ['node_modules', 'dist'],
}, null, 2) + '\n')

// ── .gitignore ──
writeFileSync(join(targetDir, '.gitignore'), [
	'node_modules',
	'dist',
	'.vesk',
	'*.log',
	'',
].join('\n'))

// ── src/global.css ──
writeFileSync(join(srcDir, 'global.css'), [
	`@import 'tailwindcss';`,
	``,
	`@layer base {`,
	`\thtml { scroll-behavior: smooth; }`,
	`}`,
	'',
].join('\n'))

if (useRouter) {
	// ── File-based routing ──

	// app/layout.vsk
	writeFileSync(join(appDirPath, 'layout.vsk'), [
		`import { NavLink } from '@vesk/runtime'`,
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
	].join('\n'))

	// app/page.vsk
	writeFileSync(join(appDirPath, 'page.vsk'), [
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
	].join('\n'))

	// app/about/page.vsk
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

	// app/blog/page.vsk
	writeFileSync(join(appDirPath, 'blog', 'page.vsk'), [
		`component Blog {`,
		`\t<h1 class="text-3xl font-bold mb-4">Blog</h1>`,
		`\t<div class="bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100">`,
		`\t\t<h2 class="text-lg font-semibold mb-1">`,
		`\t\t\t<a href="/blog/hello-world" class="text-gray-900 no-underline hover:text-blue-600">Hello World</a>`,
		`\t\t</h2>`,
		`\t\t<p class="text-gray-400 text-sm">First post powered by Vesk</p>`,
		`\t</div>`,
		`}`,
		'',
	].join('\n'))

	// app/blog/[slug]/page.vsk
	writeFileSync(join(appDirPath, 'blog', '[slug]', 'page.vsk'), [
		`component BlogPost({ params }) {`,
		`\t<h1 class="text-3xl font-bold mb-4">Post: {params.slug}</h1>`,
		`\t<p class="text-gray-600">This is a dynamic blog post rendered at /blog/{params.slug}.</p>`,
		`}`,
		'',
	].join('\n'))

	// app/middleware.ts
	writeFileSync(join(appDirPath, 'middleware.ts'), [
		`// Vesk Middleware — onion model (ctx, next)`,
		`// ctx = { request, params, url, locals, cookies }`,
		`//   locals — mutable object shared with page/API`,
		`// next() — passes to next middleware or page render`,
		`// next('/rewrite') — rewrites URL in place`,
		`// Short-circuit: return Response without calling next()`,
		``,
		`export async function middleware(ctx, next) {`,
		`\treturn next();`,
		`}`,
		'',
	].join('\n'))
} else {
	// ── Manual routing (default) ──

	// app/page.vsk — single page app with manual router
	writeFileSync(join(appDirPath, 'page.vsk'), [
		`import { createRouter, Outlet, Link } from '@vesk/runtime'`,
		``,
		`component Home {`,
		`\t<h1 class="text-4xl font-bold mb-2">Home</h1>`,
		`\t<p class="text-gray-500 mb-4">Welcome to Vesk!</p>`,
		`\t<Link href="/about" class="text-blue-600 underline">About</Link>`,
		`}`,
		``,
		`component About {`,
		`\t<h1 class="text-3xl font-bold mb-4">About</h1>`,
		`\t<p class="text-gray-600 mb-3">Vesk is a compiler-first reactive UI framework.</p>`,
		`\t<Link href="/" class="text-blue-600 underline">Home</Link>`,
		`}`,
		``,
		`component App {`,
		`\t<nav class="flex gap-6 px-8 py-4 border-b border-gray-200 bg-white">`,
		`\t\t<Link href="/" class="text-gray-500 hover:text-black font-medium no-underline">Home</Link>`,
		`\t\t<Link href="/about" class="text-gray-500 hover:text-black font-medium no-underline">About</Link>`,
		`\t</nav>`,
		`\t<main class="max-w-3xl mx-auto my-8 px-4"><Outlet /></main>`,
		`\t<footer class="text-center py-8 text-gray-400 text-sm">`,
		`\t\t<p>Powered by Vesk</p>`,
		`\t</footer>`,
		`}`,
		``,
		`const routes = {`,
		`\t'/': Home,`,
		`\t'/about': About,`,
		`}`,
		``,
		`createRouter(routes, App)`,
		'',
	].join('\n'))
}

console.log(`\n  ${pkgName} created successfully!\n`)
console.log(`  cd ${projectName}`)
console.log('  npm install')
console.log('  npm run dev\n')
