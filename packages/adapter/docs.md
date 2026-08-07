# @vesk/adapter — Deployment Adapter Docs

> Authoritative, source-verified guide to the `@vesk/adapter` package.
> Every function, signature, and output path below was read directly from
> `packages/adapter/src/*.ts`. Anything not confirmable in source is marked
> `[UNVERIFIED]`.

## What it is

`@vesk/adapter` is the **build + deployment layer** of the Vesk framework. It is
the package that turns a compiled `.vsk`/`.ts`/`.tsx` app directory (`app/`)
into a deployable artifact: server-rendering functions, API routes, client
bundles (with code-splitting and tree-shaking), prerendered (SSG) pages, a
manifest (`config.json`), SEO output, and per-platform deploy payloads
(Vercel / Netlify / Cloudflare / Deno / AWS / Coxmos / generic edge).

It depends on `@vesk/compiler` (parsing/codegen/SSR) and `@vesk/runtime`
(reactivity + client runtime), and shells out to **esbuild** (bundling) and
**sharp** (image optimization).

The package exposes two public entry points from its `src/index.ts`:

- `build(appDir, options?)` — the full production build pipeline.
- `startProdServer(outDir, options?)` — a Node http server that serves a built
  `.vesk/` output.

It also exposes `startDevServer` from `src/dev-server.ts` (not re-exported from
`src/index.ts`).

## Module layout

| File | Role |
|------|------|
| `src/index.ts` | `build()` orchestration — ties every stage together; re-exports `startProdServer`. |
| `src/types.ts` | All shared TypeScript interfaces (no functions). |
| `src/runtime-bundle.ts` | Bundles the **server** runtime → `server/runtime.js` via esbuild. |
| `src/ssr-function.ts` | Generates one SSR handler module per page route. |
| `src/api-function.ts` | Generates one API handler module per API route. |
| `src/client-bundle.ts` | Generates the **client** runtime + main bundle + code-split chunks; tree-shakes the client runtime. |
| `src/middleware.ts` | Compiles the middleware chain into `server/middleware.js` (or inline code). |
| `src/static.ts` | Copies public assets, generates SSG pages, sitemap, robots.txt. |
| `src/manifest.ts` | Builds `config.json` (`Manifest`). |
| `src/image-pipeline.ts` | Finds `<Image>` refs and produces width/format variants via sharp. |
| `src/seo-audit.ts` | Static SEO checks over page/layout sources. |
| `src/hmr.ts` | WebSocket HMR server + file-driven rebuild logic (used by dev server). |
| `src/dev-server.ts` | `startDevServer()` — dev http server with HMR. |
| `src/prod-server.ts` | `startProdServer()` — production http server. |
| `src/platform.ts` | Platform detection from env + the `Platform` type union. |
| `src/platform-handler.ts` | Generates a universal edge `handleRequest(request)` and bundles it. |
| `src/platform-output.ts` | Static-file layout helpers + MIME table for platform emit. |
| `src/platform-deploy.ts` | `emitPlatformOutput()` — universal platform artifact emission. |

## The build pipeline (`build()`)

`build()` in `src/index.ts` runs these stages in order:

1. **Setup** — resolve `appDir`; `outDir` = `options.outDir ?? appDir/../.vesk`;
   `publicDir` = `options.publicDir ?? appDir/../public`; run each
   `plugin.onBuildStart()` hook. Creates `server/functions`, `server/api`,
   `static/public`, `prerendered` directories.
2. **Scan** — dynamically imports from `@vesk/compiler` (`resolveCompilerApi`):
   `scanRoutes(appDir)` → route tree; `scanComponents(componentsDir)` →
   external component map; `scanApiRoutes(apiDir)` → API tree. If no routes are
   found it logs and returns `undefined`.
3. **Bundle server runtime** — `bundleRuntime(appDir, outDir)` → `server/runtime.js`
   (esbuild bundle of compiler server codegen + cookies + `@vesk/runtime` server).
4. **Compile SSR functions** — walks the route tree; for each leaf node with a
   `page.vsk` it resolves the middleware chain, inlines middleware
   (`compileMiddlewareCode`), calls `generateSsrFunction`, writes
   `server/functions/<name>.js`. It also collects server-action ids
   (`collectActionIds` from page + layout + ancestor layouts) into `actionMap`,
   and parses `revalidate` / `isrTags` exports.
5. **Compile API functions** — walks the API tree, calls `generateApiFunction`,
   writes `server/api/<name>.js`.
6. **Root middleware** — `collectMiddlewareChain(routeTree, '/')`; if present,
   `compileMiddleware` writes `server/middleware.js` and sets
   `middlewareEnabled = true`.
7. **Client bundle** — `generateClientBundle` produces `{ main, chunks }`; the
   monolith (or code-split main) is written to `static/client.js`, and each
   chunk to `static/page-<slug>.js`. This stage also produces the tree-shaken
   client runtime (unless `importRuntime` is set).
8. **Static assets** — `copyStaticAssets(publicDir, outDir)` → `static/public/`.
9. **CSS** — reads `src/global.css` (or `src/app.css`), strips Tailwind
   directives → `static/global.css`; runs any `plugin.onCSS` hooks and writes
   `static/_tailwind.css`.
10. **SSG** (only if `options.ssg`) — `generateSsgRoutes` renders
    `getStaticProps`/`getStaticPaths` pages into `prerendered/*.html`.
11. **Images** — `optimizeImages(appDir, outDir)` → `static/images/*`.
    > Note: the current `index.ts` invokes `optimizeImages` **twice** (once right
    > after the SSG stage and again after the SEO stage). It is idempotent but
    > duplicated; see "Common mistakes / fixes" below.
12. **SEO** (only if `options.seo`) — `runSeoAudit(appDir)`; if
    `options.strictSeo` and there are errors, `build()` throws.
13. **Sitemap / robots** — `generateSitemap` → `static/public/sitemap.xml` and
    `generateRobotsTxt` → `static/public/robots.txt`, **unless** those files
    already exist in `static/public` (user overrides win).
14. **Manifest** — `generateManifest(...)` → `config.json`.
15. **Platform emit** — `detectPlatform(...)`; if the result is not `'node'`,
    `emitPlatformOutput(platform, ctx)` writes the platform artifact under
    `.vesk/<platform>/` (and, for Vercel, creates a `.vercel/output` symlink).
    A `target: 'edge'` option forces `node` → `edge`.
16. **Teardown** — runs each `plugin.onBuildEnd()` hook; logs "done"; returns
    `{ routeTree, apiTree, ssrRoutes, apiRoutes, manifest }`.


## The `.vesk/` output structure

Default `outDir` is `<project>/.vesk`:

```
.vesk/
├── config.json              # Manifest (routes, prerendered, static, actions, middleware)
├── server/
│   ├── runtime.js           # Bundled server runtime (renderFullPage, renderPageStream, renderPage, parseCookies, ...)
│   ├── middleware.js        # Optional — root middleware chain
│   ├── functions/           # One ESM module per SSR page route
│   │   └── <name>.js        #   defines `export async function handle(request)`
│   └── api/                 # One ESM module per API route
│       └── <name>.js        #   defines `export async function handle(request)`
├── static/
│   ├── client.js            # Main client bundle (also aliased to /_vesk/runtime.js)
│   ├── page-<slug>.js       # Code-split route chunks (only when codeSplit: true)
│   ├── global.css           # Stripped user CSS
│   ├── _tailwind.css        # Tailwind output (post plugin.onCSS)
│   ├── images/              # Optimized image variants (sharp)
│   └── public/              # Copied public assets + sitemap.xml + robots.txt
├── prerendered/             # SSG output (only when ssg: true)
│   └── <path>.html
└── <platform>/              # Platform artifacts (only when platform != node)
    ├── index.js / _worker.js / functions/__index.func/...
    ├── static/              # Platform static layout
    └── manifest.json        # Emit metadata
```

## Usage patterns

### Build via the `vesk` CLI

`packages/cli/src/index.ts` wires the adapter into the CLI:

- `vesk build` → `build(join(cwd,'app'), { publicDir, plugins, seo, strictSeo,
  codeSplit, target, platform })`. Code-splitting is on by default unless
  `--skip-split` is passed; `target: 'edge'` maps from `--target edge`.
- `vesk start` → `startProdServer(join(cwd, '.vesk'), { port })` then blocks.
- `vesk dev` → `startDevServer(port, projectDir, config)` (the CLI's own
  dev-server wrapper).
- `vesk seo` → `runSeoAudit(appDir)` directly.

### Using `build()` directly

```ts
import { build, startProdServer } from '@vesk/adapter/src/index';

const result = await build('/path/to/project/app', {
  outDir: '/path/to/project/.vesk',
  publicDir: '/path/to/project/public',
  plugins: [/* VeskPlugin[] */],
  seo: true,
  strictSeo: true,
  siteUrl: 'https://example.com',
  ssg: true,
  codeSplit: true,
  platform: 'vercel',   // or auto-detect
  target: 'node',       // or 'edge'
});
/* result: { routeTree, apiTree, ssrRoutes, apiRoutes, manifest } */

const server = await startProdServer('/path/to/project/.vesk', { port: 3000 });
```

### In-process build + serve

```ts
import { build } from '@vesk/adapter/src/index';
import { startProdServer } from '@vesk/adapter/src/prod-server';

await build(appDir, { outDir, codeSplit: true });
const server = await startProdServer(outDir, { port: 3099 });
```

(This is exactly the pattern used by `src/hydration.test.ts` and
`src/code-split.test.ts`.)

### Dev server with HMR

```ts
import { startDevServer } from '@vesk/adapter/src/dev-server';
await startDevServer(appDir, { port: 3000, publicDir, block: false });
```

`block` defaults to true (keeps the process alive). HMR is served over a
WebSocket at `/_vesk/hmr` and a client script at `/_vesk/hmr.js`.


## Common mistakes + fixes

| Mistake | Fix |
|---------|-----|
| `no routes found in <appDir>` and `build()` returns `undefined` | Build a non-empty `app/` containing at least one `page.vsk` so `scanRoutes` returns entries. |
| `@vesk/compiler/dist not found — run "npm run build" first` (from `runtime-bundle` / `client-bundle` `find*Src`) | Build the monorepo packages first (`npx tsx packages/cli/src/build-packages.ts`) so `compiler/dist` and `runtime/dist` exist. |
| `@vesk/runtime/dist not found` | Same root cause — build the runtime package. |
| Code-split chunks not loading at runtime | Make sure `options.codeSplit` is true and that `static/page-*.js` chunks are actually emitted; verify `matchRoute`/`ensureChunk` are in the used runtime name set. |
| `importRuntime` causes blank bundles | `importRuntime: true` emits `import {...} from '/_vesk/runtime.js'` instead of inlining the tree-shaken runtime — ensure the runtime URL is served (`/_vesk/runtime.js`). |
| SSG output missing | Call `build` with `ssg: true` and have `getStaticProps`/`getStaticPaths` present in page.vsk sources. |
| SEO build fails on `strictSeo` | Fix the reported errors, or don't pass `strictSeo`. |
| Platform artifact missing | `emitPlatformOutput` returns `null` for `platform === 'node'`. Use a non-node platform or set `target: 'edge'` when `platform` is `node`. |
| Double image processing | The current `index.ts` calls `optimizeImages` twice; it is idempotent, but if you wrap it in a flag it may silently skip producing images. |
| Imported tree-shaken runtime doesn't expose names | The tree-shaken runtime is a closed IIFE; only the explicitly re-exported names resolve — pass every name your app uses to `buildTreeShakenRuntime`/make sure it's in `runtimeImportNames`. |

## Testing

Adapter tests run from the package source (`src/*.test.ts`). They are plain
scripts (no test framework) that print a pass/fail tally and `process.exit(1)`
on failure.

- SEO unit test (no browser needed):
  `npx tsx packages/adapter/src/seo-audit.test.ts`
- Tree-shake runtime test (no browser needed):
  `npx tsx packages/adapter/src/tree-shake.test.ts`
- HMR end-to-end (needs a dev server + WebSocket; fixture under
  `test/fixtures/hmr-app`):
  `npx tsx packages/adapter/src/hmr.test.ts`
- Hydration end-to-end (builds + starts prod server + puppeteer-core):
  `npx tsx packages/adapter/src/hydration.test.ts`
- Code-split end-to-end (builds with `codeSplit: true`, prod server +
  puppeteer-core):
  `npx tsx packages/adapter/src/code-split.test.ts`

Notes:
- The puppeteer tests hardcode a Chromium executable path
  (`/data/data/com.termux/files/usr/bin/chromium-browser`) and read
  `VESK_E2E`/`VESK_E2E_PROD_PORT`/`VESK_E2E_DEV_PORT` env vars.
- E2E tests depend on a built compiler + runtime `dist/`. Run
  `npx tsx packages/cli/src/build-packages.ts` first if `dist/` is stale.
- Static type-check: `npm run typecheck` (runs `tsc --noEmit` in the package);
  build: `npm run build` (`tsc -p tsconfig.build.json`).

