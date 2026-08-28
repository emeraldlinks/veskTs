# Dev Server

`vesk dev` is a full-stack dev environment: SSR, API routes, middleware,
server actions and HMR — with production security features honored.

```sh
vesk dev                    # http://127.0.0.1:3000
vesk dev -p 5173 -H 0.0.0.0 # explicit port + expose on your network
```

Requires an `app/` directory (it exits with the `create-vesk` hint
otherwise).

## What happens on startup

1. `.env` then `.env.local` load from the project root (`KEY=VAL`, quotes
   stripped; existing process env never overridden).
2. `vesk.config.ts`/`.js` loads + validates; markdown policy applies to
   `<Md>`; log redaction enables unless disabled.
3. The banner prints project dir, page/route list, API route count and
   `hmr enabled — edit app/ to hot reload`.

## HMR

- Watches `app/` and `public/` with a 12 ms debounce.
- Content-only `.vsk` edits hot-swap in ~90–150 ms end-to-end: surgical
  component updates over WebSocket (nonce-gated eval), no full reload.
- Layout changes re-navigate; some changes fall back to full reload.
- CSS changes hot-swap stylesheet links without losing state.
- Compile errors push an **error overlay** to the browser.
- A small **status dot** in the corner reflects connection state:
  connecting / connected / compiling / disconnected / error.
- The HMR WebSocket origin-checks upgrades (loopback aliases allowed) and
  its eval hook is nonce-gated per session.

## Served endpoints

| Path | Content |
| --- | --- |
| everything else | SSR pages via the same pipeline as production |
| `/api/*` | API routes (`app/api/**/route.ts`) |
| `/_vesk/action/:id` | server actions |
| `/_vesk/client.js` | client bundle for the current app |
| `/_vesk/runtime.js` | shared runtime |
| `/_vesk/static/*` | build assets (global.css, `_tailwind.css`, …) |
| `/_vesk/ssr-data.js?t=…` | hydration-data script (token store capped at 100) |
| `/_vesk/hmr` | HMR WebSocket |

## SPA data phase

Client-side navigations fetch route data with `X-Vesk-Data: 1`; the dev
server responds with JSON (`{ props, head }` or redirect/notFound/error
payloads) exactly like production — so offline/error/loading behavior is
identical in dev.

## Security in dev

Production security features are active by default so surprises can't
wait until deploy:

- request body cap (`maxBodyBytes`, default 1 MiB → 413),
- security headers on responses,
- CORS config,
- rate limiting,
- trust-proxy-aware client IPs,
- same-origin CSRF assert on actions/API mutations.

Loopback binding (`127.0.0.1`) is the default; exposing requires an
explicit `-H 0.0.0.0`.

## Environment files

```
# .env
DATABASE_URL=postgres://…
PUBLIC_API_URL=https://api.example.com
```

- `.env.local` overrides `.env`; neither overrides real process env.
- Available server-side via `process.env`.

## Tips

- Keep heavy work out of component top-level code — it runs during every
  SSR render.
- The floating status dot doubles as a compile-health indicator while
  editing.
- Use `vesk typecheck` alongside `vesk dev` for instant TS feedback on
  `.vsk` files.
