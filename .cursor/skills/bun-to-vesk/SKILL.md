---
name: bun-to-vesk
description: >-
  Convert Bun applications and Bun-specific server code to Vesk (.vsk) with
  verified APIs. Use when migrating Bun.serve, Bun.file, Bun.$,
  Bun.env, Bun.password, Bun.sql, Bun.spawn, Web APIs, and Bun projects to
  Vesk's compiler-first component, routing, API-route, middleware, and
  runtime model. Read skills/vesk/SKILL.md first. Never claim that Bun APIs
  are bundled into Vesk; preserve them only in explicitly supported server
  modules or replace them with standard Web/Node equivalents.
---

# Bun → Vesk conversion

Bun is a runtime/toolchain, not a UI framework. This conversion has two
separate parts:

1. Move the UI and page shell into Vesk's `.vsk` file-based application.
2. Move Bun-only server/runtime behavior into explicit Vesk server modules or
   replace it with a documented Vesk/Node/Web API.

Read the canonical `skills/vesk/SKILL.md` before writing Vesk code. In
particular, use `track()`/`&[]`, statement mode, `{props.children}`, explicit
`bindValue` refs, and the documented Vesk API routes. Never emit React, Vue,
or Bun UI syntax.

## Bun-to-Vesk decision rules

| Bun source | Vesk target | Rule |
| --- | --- | --- |
| `Bun.serve({ fetch })` | `app/api/**/route.ts` or a server module | Vesk owns the HTTP server; export method handlers instead of starting a second server |
| `Bun.serve({ routes })` | Vesk file routes or `createRouter`/`createFileRouter` | Preserve route semantics; do not leave a Bun server running inside the Vesk process |
| `new Response(...)` | `return new Response(...)` or `VeskResponse` | Vesk accepts standard `Response` objects |
| `Bun.file(path)` | `fs/promises` or an API route using a supported Node API | `Bun.file` is not a Vesk runtime API; mark it as an external Bun dependency or replace it |
| `Bun.write`, `Bun.$`, `Bun.spawn` | `node:fs/promises`, `node:child_process`, or a documented package | Vesk does not auto-polyfill Bun globals in browser/client code |
| `Bun.env` | `process.env` on the server | Never assume a Bun environment variable reaches the client bundle |
| `Bun.password` | An explicitly installed password library or server-side Web Crypto implementation | There is no Vesk `Bun.password` wrapper |
| `Bun.sql` | An explicit database driver/package | There is no Vesk SQL API |
| `Bun.serve` WebSocket upgrade | A Vesk API route only if the adapter/server supports WebSockets | Do not claim that file routes automatically support upgrades |
| `Bun.build` | Vesk build/dev pipeline | Do not run a second Bun bundler for `.vsk` files |
| `Bun.env` public config | Explicitly fetch or pass public values | Vesk does not automatically expose `Bun.env` to client code |
| `Bun.file(...).text()` | `await response.text()`, `fs.readFile`, or `fetch` | Choose based on whether the source is a URL or filesystem path |
| `Bun.env.NODE_ENV` | `process.env.NODE_ENV` in server tooling | Vesk CLI/start sets the relevant environment |

## Server conversion

A Bun `fetch` handler becomes a Vesk route handler:

```ts
// Bun source
Bun.serve({
  port: 3000,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/api/hello') return Response.json({ hello: 'world' })
    return new Response('Not found', { status: 404 })
  },
})
```

```ts
// Vesk target: app/api/hello/route.ts
import { VeskRequest, VeskResponse } from '@vesk/runtime/server'

export async function GET(req: VeskRequest) {
  return VeskResponse.json({ hello: 'world' })
}
```

Do not add `Bun.serve()` to a Vesk app. The Vesk dev/start server owns the
listener. For a handler that needs Bun at runtime, keep the dependency
explicit and document that the deployment must provide Bun; do not imply that
Vesk's supported Node deployment magically provides Bun globals.

## Files and filesystem

Bun's `Bun.file()` is not part of `@vesk/runtime`. Choose one of these:

```ts
// URL or HTTP response
const response = await fetch('/api/document')
const text = await response.text()
```

```ts
// Server-only filesystem access
import { readFile } from 'node:fs/promises'
const text = await readFile('data/document.txt', 'utf8')
```

Never read a server secret or private file from a default server component.
Put filesystem access in an API route, server module, async server component,
or server-only action as appropriate.

## Environment and secrets

Bun applications often use `Bun.env`. In a Vesk server module use:

```ts
const token = process.env.API_TOKEN
if (!token) throw new Error('API_TOKEN is not configured')
```

The Vesk CLI loads `.env` and `.env.local` for local development. Environment
values are not automatically copied into the client bundle. Fetch a safe
public endpoint or pass an explicitly public value through server-rendered
props/data instead.

Never emit:

```ts
const secret = import.meta.env.SECRET // not a Vesk client-env contract
```

## UI conversion

Bun has no Vesk JSX/body-mode contract. Convert HTML/JSX to Vesk:

```vsk
import { track } from '@vesk/runtime'

component Counter() {
  let &[count] = track(0)
  <button onClick={() => count++}>{count}</button>
}
```

Use statement mode for pages and interactive components. Use expression mode
only for small presentational components. Do not use Bun-specific JSX
transforms, JSX factories, or `Bun.serve` rendering functions.

## Reactivity mapping

If the Bun app used a framework or hand-written reactive store:

- Mutable state → `track()`.
- Derived/computed state → `derived()`.
- Side effects and browser subscriptions → `effect()`.
- Cleanup → effect return or `on_destroy()`.
- Multiple synchronous writes → `flushSync()`.
- DOM binding → `ref={bindValue(cell)}` with the raw cell.

Never use `.value` on a Vesk cell and never emit `batch`.

## Web standards

Most Web APIs remain Web APIs:

- `fetch`, `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`.
- `AbortController` and `AbortSignal`.
- `FormData`, `Blob`, `ReadableStream`.
- `crypto` APIs when supported by the deployment runtime.
- `localStorage`, `sessionStorage`, `navigator`, and `window` only inside a
  client island, `effect()`, or `{#client}` block.

Do not claim that a browser Web API is available on the Vesk server.

## Routing conversion

Prefer Vesk file routes:

```text
src/index.ts       → app/page.vsk
src/about.ts       → app/about/page.vsk
src/posts/[id].ts  → app/posts/[id]/page.vsk
src/routes/*       → corresponding app route files or createRouter tree
```

For a programmatic route tree, use only the documented Vesk router APIs:

```ts
import { createRouter } from '@vesk/runtime/router'

const router = createRouter({
  '/': () => import('./pages/Home'),
  '/posts/:id': () => import('./pages/Post'),
}, { container: document.getElementById('root')! })
router.start()
```

Do not translate Bun route objects into an invented Vesk route API. If the
original route behavior cannot be represented, list it as an explicit
migration decision.

## Bun server utilities

Map each utility by capability, not by name:

- HTTP server → Vesk dev/start server or an API route.
- Static files → `public/` and Vesk's static asset pipeline.
- Environment → `process.env` in server code.
- Child processes → an explicit `node:child_process` dependency.
- SQL → an explicit database driver.
- Password hashing → an explicit security-reviewed package or Web Crypto
  implementation.
- WebSockets → a deployment-specific adapter; verify support before claiming
  Vesk supports the upgrade.
- Bundling `.vsk` files → `vesk build`; never use `Bun.build` for Vesk
  components.
- File watching/dev reload → `vesk dev` and its supported file watchers.

## Mandatory conversion workflow

1. Inventory Bun files and classify them as UI, route, server utility, build
   configuration, or runtime-specific integration.
2. Produce a source-to-target manifest before editing.
3. Read the canonical Vesk skill and verify every target API in framework
   source/declarations.
4. Scaffold or reuse the Vesk app and move routes into `app/`.
5. Convert server handlers to `app/api/**/route.ts` or server modules.
6. Convert UI to `.vsk`, using statement mode for pages/interactive UI.
7. Replace Bun-only APIs or mark them as explicit deployment dependencies.
8. Run `npx vesk typecheck`.
9. Run the relevant Vesk tests and production hydration checks for reactive or
   browser-facing changes.
10. Search output for Bun globals and unverified APIs:

```sh
grep -RInE 'Bun\\.|Bun\\b|useState|useEffect|className|slot/|batch' app src
```

Any remaining `Bun.*` must be an intentional, documented server/deployment
integration and must not occur in a client bundle by accident.

## Anti-patterns

- Do not put `Bun.serve()` inside a Vesk app.
- Do not use `Bun.env` as a client-side public environment API.
- Do not assume `Bun.file`, `Bun.password`, `Bun.sql`, or `Bun.$` exists in
  Vesk.
- Do not use Bun's JSX transform to compile `.vsk` files.
- Do not use `Bun.build` for Vesk components.
- Do not claim that Vesk file routes automatically provide WebSocket upgrades.
- Do not read private files at module top level in a server component.
- Do not leave `Bun` references in a client bundle.
- Do not use `bindValue={cell}`; use `ref={bindValue(cell)}`.
- Do not use `useState`, `useEffect`, `.value`, `className`, `<slot/>`, or
  `batch`.

## Final gate

- [ ] Source inventory and conversion manifest exist.
- [ ] Canonical `skills/vesk/SKILL.md` was read first.
- [ ] Every target API is verified in Vesk source/declarations.
- [ ] Bun server listeners were removed or explicitly isolated.
- [ ] Bun-only APIs are replaced or documented as deployment dependencies.
- [ ] No Bun globals leak into client code.
- [ ] Pages and interactive components use statement mode.
- [ ] `npx vesk typecheck` passes.
- [ ] Hydration is tested for browser-facing/reactive changes.
- [ ] Intentional remaining Bun references are listed explicitly.

When uncertain, use the canonical Vesk skill and framework source. Never
invent a Bun compatibility layer or claim that an API exists without evidence.
