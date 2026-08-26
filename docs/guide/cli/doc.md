# CLI Reference

Everything Vesk does on your machine happens through one command: `vesk`.
It compiles your `.vsk` files, serves them during development with instant
hot reload, produces optimized production builds, and runs the result as a
server. You rarely need anything else — `vesk dev` while building,
`vesk build` + `vesk start` when it's time to ship.

The binary ships in the `@vesk/vesk-cli` package, installed automatically
by the scaffolder.

```
Vesk CLI — Compiler-First Framework for the Post-VDOM Web

Usage:
  vesk build [--platform <name>] [--seo] [--strict] [--skip-split]  Build app/ for production
  vesk build                       Auto-detect platform from CI env
  vesk seo [--strict]              Run SEO analysis on app/
  vesk typecheck [--no-strict]     Typecheck .vsk/.ts files (strict by default)
  vesk start [-p 3000]             Start production server
  vesk dev [-p 3000]               Start dev server with HMR
  vesk init                        Create src/global.css (Tailwind entrypoint) if missing
  vesk --help                      Show this help

Scaffolding:  npx create-vesk@latest <project-name>
```

## `vesk dev`

Starts the development server over the `app/` directory in the current
working directory.

| Flag | Default | Description |
| --- | --- | --- |
| `-p`, `--port <n>` | `3000` | Port. Accepts `-p 3000`, `--port 3000`, `--port=3000`; invalid values fall back to 3000. |
| `-H`, `--host <addr>` | `127.0.0.1` | Bind address. Loopback by default; pass `--host 0.0.0.0` to expose on your network deliberately. |

Behavior:

- Requires an `app/` directory — otherwise exits with a hint to run
  `npx create-vesk@latest`.
- Loads `.env` then `.env.local` (never overriding existing env vars).
- Loads + validates `vesk.config.{js,ts}`; applies the configured markdown
  policy to `<Md>` rendering.
- Watches `app/` and `public/`; pushes HMR/reload events over a WebSocket
  (origin-checked, loopback-only by default).
- Serves: SSR pages, `/api/*` routes, server actions
  (`/_vesk/action/:id`), client bundle (`/_vesk/client.js`), runtime,
  static assets, global CSS/Tailwind output, and the hydration-data script.
- Honors production security features in dev too: body-size cap, security
  headers, CORS, rate limit, trust proxy.
- Startup banner prints project dir, page/route list, API route count and
  `hmr enabled`.

## `vesk build`

Builds `app/` for production into `.vesk/` (or your configured `outDir`).

| Flag | Description |
| --- | --- |
| `--platform <name>` | Target platform: `node` \| `vercel` \| `netlify` \| `cloudflare` \| `deno` \| `aws` \| `edge` \| `coxmos`. Omitted → auto-detected from CI env vars, else `node`. |
| `--target edge` | Shorthand that promotes the node build to the generic edge target. |
| `--seo` | Run the SEO audit as part of the build. |
| `--strict` | With `--seo`: SEO errors **fail** the build (`strictSeo`). |
| `--skip-split` | Disable per-route code splitting of the client bundle. |

Output layout:

```
.vesk/
├── config.json               # build manifest (routes, prerendered, actions…)
├── server/
│   ├── runtime.js            # shared server runtime (renderPage/streaming)
│   ├── middleware.js         # compiled middleware chain (when present)
│   ├── functions/<name>.js   # one SSR function per page route
│   └── api/<name>.js         # one handler per API route
├── static/
│   ├── client.js             # client bundle (+ per-route chunks when split)
│   ├── global.css            # user CSS
│   ├── _tailwind.css         # compiled Tailwind output
│   ├── public/               # copy of public/ + generated sitemap.xml + robots.txt
│   └── images/               # optimized image variants (sharp pipeline)
└── prerendered/              # SSG output (index.html, <path>.html)
```

After building, markdown raw-HTML warnings are summarized once
(`<tag>×N`) if any were emitted during render.

## `vesk start`

Runs the production server from a previous build.

```sh
vesk start            # .vesk/ on http://127.0.0.1:3000
vesk start -p 8080 -H 0.0.0.0
```

| Flag | Default | Description |
| --- | --- | --- |
| `-p`, `--port <n>` | `3000` | Listen port. |
| `-H`, `--host <addr>` | `127.0.0.1` | Bind address. |

- Requires `.vesk/config.json` — errors with `Run "vesk build" first`
  otherwise.
- Sets `NODE_ENV=production` if unset (error details become generic).
- Request pipeline: static files → hydration-data script → runtime →
  static assets → prerendered pages → middleware chain → server actions →
  API routes → SSR pages (with ISR where configured) → custom 404.
- Injects security headers on every response; applies rate limiting from
  config; enforces the request-body size cap (default 1 MiB).

## `vesk typecheck`

Typechecks `.vsk` and `.ts` files under `app/` via the compiler's
`tsc-in-.vsk` language service (in-memory TSX transform — like vue-tsc).

```sh
vesk typecheck                # strict by default
vesk typecheck --no-strict    # TS strict:false
```

- Prints diagnostics as `file(line,col): TSCODE: message` (warnings first,
  then errors) and **exits 1** when errors exist.
- Success message: `vesk typecheck: no type errors found`.

## `vesk seo`

```sh
vesk seo            # audit report
vesk seo --strict   # exit 1 when errors exist
```

Runs the 8-point SEO audit against every page combined with its layout.
See [SEO](../seo/doc.md#seo-audit).

## `vesk init`

Creates `src/global.css` only if missing:

```css
@import 'tailwindcss';

@layer base {
	html { scroll-behavior: smooth; }
}
```

Useful after adding Tailwind to an existing project manually.

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `NODE_ENV` | prod/dev servers | Set by `vesk start` / `vesk dev` if unset. Gates error-detail exposure (prod returns generic messages). |
| `PORT` | deno/coxmos bootstrap | Listen port for `Deno.serve` (default **8000**). Node servers use `-p/--port` instead (default 3000). |
| `CHROMIUM_PATH` | repo test probes only | Chromium binary for puppeteer-based test suites — not used at runtime. |

## Config loading order

1. `.env` then `.env.local` at project root (`KEY=VAL`, quotes stripped;
   never overrides existing process env).
2. `vesk.config.js` preferred over `vesk.config.ts`. TS configs are
   transpiled with the TypeScript compiler; imports from `@vesk/compiler`
   are injected as globals during load.
3. Result passes through `defineConfig()` normalization then
   `validateConfig()`.
4. If `security.redactLogs !== false`, log redaction is enabled
   (secrets/tokens are masked in dev-server logs).
