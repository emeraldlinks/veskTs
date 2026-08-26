# Getting Started

Vesk is a full-stack framework: you write `.vsk` components, and the
compiler renders them to HTML on the server, hydrates them in the browser,
and keeps client bundles tiny. This page takes you from an empty folder to
a running application in about two minutes.

## Requirements

- Node.js **>= 20**

## Scaffold a new app

```sh
npx create-vesk@latest my-app
cd my-app
npm install
npm run dev
```

`create-vesk` fails if the directory already exists or the name is missing.

## What gets scaffolded

```
my-app/
├── package.json
├── vesk.config.ts          # framework config (app dir, plugins, security, ssg)
├── tsconfig.json           # strict TS, jsxImportSource: @vesk/compiler
├── .env.example            # DATABASE_URL / STRIPE_SECRET / PUBLIC_API_URL examples
├── .gitignore              # node_modules, dist, .vesk, env files …
├── README.md
├── public/
│   └── favicon.svg         # static assets served at /
├── src/
│   └── global.css          # Tailwind entrypoint (@import 'tailwindcss')
└── app/                    # ← your application (the only dir you edit daily)
    ├── layout.vsk          # root layout: nav + {props.children} + footer
    ├── page.vsk            # route "/" — counter demo with tracked state
    ├── about/page.vsk      # "/about"
    ├── blog/page.vsk       # "/blog" — Link list of posts
    ├── blog/[slug]/page.vsk# dynamic route — reads props.params.slug
    ├── posts/page.vsk      # useFetch + loading/error/retry demo
    ├── statements/page.vsk # statement-mode tour (if/switch/for/try)
    ├── not-found.vsk       # custom 404
    ├── error.vsk           # custom error boundary
    ├── middleware.ts       # onion-model middleware demo
    └── api/
        ├── posts/route.ts        # GET with ?limit= query
        ├── hello/route.ts        # GET (+cookie) and POST handlers
        └── echo/[msg]/route.ts   # dynamic API route
```

### `package.json`

```json
{
  "type": "module",
  "scripts": {
    "dev": "vesk dev",
    "build": "vesk build",
    "start": "vesk start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vesk/compiler": "^0.2.7",
    "@vesk/runtime": "^0.2.7",
    "@vesk/types": "^0.2.7",
    "@vesk/vesk-cli": "^0.2.7",
    "@vesk/adapter": "^0.2.7",
    "@vesk/plugin-tailwind": "^0.2.7"
  },
  "devDependencies": {
    "tailwindcss": "^4.0.0",
    "typescript": "^5.8.0"
  }
}
```

### `vesk.config.ts`

```ts
import { defineConfig, preset } from '@vesk/compiler'
import tailwindcss from '@vesk/plugin-tailwind'

export default defineConfig({
	appDir: './app',
	outDir: './dist',
	publicDir: './public',
	security: preset('production', {
		trustProxy: true, // behind nginx/Cloudflare
	}),
	plugins: [
		tailwindcss({ entry: 'src/global.css', appDir: 'app' }),
	],
	ssg: {},
});
```

See [Configuration](../configuration/doc.md) for every option.

## The dev loop

```sh
npm run dev        # → http://localhost:3000
```

- Edits under `app/` hot-reload (~90–150 ms for content edits) via
  WebSocket HMR; no full browser reload needed.
- `public/` is watched too; CSS rebuilds automatically.
- API routes, middleware, server actions and SSR all run in dev.

## First component

Create `app/hello/page.vsk`:

```vsk
component HelloPage() {
	let &[count] = track(0)

	<Head>
		<title>Hello Vesk</title>
	</Head>

	<div>
		<h1>Hello, Vesk!</h1>
		<button onClick={() => count++}>Clicked {count} times</button>
	</div>
}
```

Visit `/hello`. What happened:

- `component HelloPage()` declares a component (see
  [Components](../language/components/doc.md)).
- `let &[count] = track(0)` creates a reactive cell; reads/writes of
  `count` compile to per-cell DOM updates — no virtual DOM (see
  [Reactivity](../reactivity/doc.md)).
- Bare JSX without a wrapper `return` is **statement mode** — markup as
  statements (see [Body Modes](../language/body-modes/doc.md)).
- `<button onClick={…}>` is interactive on the client after hydration.
- `<Head>` collects metadata into the document head.

## Typechecking

```sh
npm run typecheck        # plain tsc over the project
npx vesk typecheck       # tsc-in-.vsk language service (strict by default)
npx vesk typecheck --no-strict
```

## Production build & serve

```sh
npm run build            # outputs to dist/ per vesk.config outDir (default .vesk/)
npm run start            # serves the build on http://localhost:3000
```

The production server handles SSR pages, streaming, prerendered SSG pages,
API routes, middleware, server actions, static files, ISR and custom
404/error pages. See [CLI](../cli/doc.md) and
[Deployment](../deployment/doc.md).

## Next steps

- [Language: components](../language/components/doc.md)
- [Routing](../routing/file-based/doc.md)
- [Data fetching](../data-fetching/doc.md)
- [Forms & actions](../forms-actions/doc.md)
