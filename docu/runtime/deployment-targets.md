# Deployment Targets

Vesk builds one SSR function and one client bundle; how they are served
depends on the target platform. The default is a standard Node.js server;
`vesk build --platform <name>` switches the output shape.

## Supported platforms

`packages/adapter/src/platform.ts` defines:

```
type Platform = 'node' | 'vercel' | 'netlify' | 'cloudflare' | 'deno' | 'aws' | 'edge' | 'coxmos'
```

Platform detection order (during `vesk build`):

1. Explicit `--platform <name>` CLI override
2. Well-known platform environment variables (e.g. `DENO_DEPLOYMENT_ID`,
   `DENO_REGION`, `DENO_DEPLOY_URL` → `deno`)
3. Default: `node`

## Node server (default)

- `vesk build` emits an SSR function (`ssr-function.ts` — `handle(request)`
  entry, server actions via `handleAction(request, id)`) plus static
  assets.
- `vesk start` serves the build with `startProdServer(outDir, { port })`
  (prod-server.ts, default port 3000).
- Server-only runtime APIs (`cookies`, `headers`, `locals`, ISR, request
  security) run in this environment.

## Deno

`--platform deno` switches the build to Deno-shaped output (platform
deploy/handler paths in the adapter).

## Server rendering

The server render path is `packages/compiler/src/server-render.ts` +
`server-jsgen.ts`:

- **Rendered:** static HTML, dynamic interpolation `{expr}`, conditionals,
  `.map()` / `for` lists, child component HTML, `{#server}` blocks, styles.
- **Not rendered:** event-handler attributes (`on*` — client-only), and
  `{#client}` blocks (stripped). Tracked state renders its initial value;
  reactivity is client-side.
- **Escaping:** all dynamic text content is escaped with `escapeHtml()`
  (XSS-safe); static attribute values from source are trusted.

## Browser

The client bundle is built from the compiled client codegen plus the
runtime's `index-client.ts` barrel, tree-shaken to the exports actually
used, with hydration entry points (`hydrate`, `hydrateViewport`,
`hydrateIdle`, `hydrateOnInteraction`, `needsHydration`,
`createHydrateWalker`, `collectVskMarkers`, `reactiveProps`). See
[hydration.md](hydration.md).

## Verified against

- `packages/adapter/src/platform.ts` — platform list + detection
- `packages/adapter/src/ssr-function.ts`, `prod-server.ts` — Node outputs
- `packages/compiler/src/server-jsgen.ts`, `server-render.ts` — SSR
  behavior
- Commit `2a5b19d`