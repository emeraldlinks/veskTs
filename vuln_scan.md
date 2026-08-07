# Vesk Framework — Vulnerability & Security Scan Report

**Date:** 2026-08-07
**Scope:** packages/compiler, packages/runtime, packages/adapter, packages/cli,
packages/lsp, packages/plugin-tailwind, packages/create-vesk, extension/,
test-app/, scripts/
**Methodology:** Fresh static source analysis against working tree (post
CSP/external-data-script fix, commits 85d8dd6 + 70db7ed). Coverage extended
beyond the original report's eval focus to include: image src handling, HMR /
WebSocket, static file serving, CSRF / server actions, cookie signing, header
injection, prototype pollution, and edge-runtime crypto availability.

---

## Executive Summary

Vesk is a compiler-first, signals-based web framework with SSR + hydration.
Its posture is mixed: auto-escaping codegen, allow-listed CORS, security
headers, and a `script-src 'self'` CSP are strong foundations. However several
high-severity issues remain — the most important of which are **new** to this
scan: **server actions execute with no CSRF protection at all**, and every
**cryptographic primitive is either `crypto.subtle`-based (breaks on edge
runtimes) or keyed with `Math.random()`** plus a non-cryptographic MAC.

**Edge runtime constraint:** the framework targets Node.js, Vercel Edge,
Cloudflare Workers, and Deno Deploy. `crypto.subtle` is **NOT** available on
Cloudflare Workers or Vercel Edge Runtime (Node and Deno have it). Therefore
every recommendation in this report uses only `crypto.getRandomValues` (which
is available on all targets) or pure-JS fallbacks. A pure-JS HMAC-SHA256
(~40-60 lines) is the recommended replacement for every `crypto.subtle` call
below; it runs identically on Node and edge.

**Overall risk rating: HIGH** — not safe for production multi-tenant or
untrusted-content use until the Critical/High items are addressed.

---

## Vulnerability Inventory by Severity

### CRITICAL

#### 1. Server actions execute with no CSRF protection

**Locations:** `packages/cli/src/action-handler.ts:187-232`, `packages/compiler/src/server-utils.ts:234-246`

`csrfGuard` exists in `server-utils.ts` but is **never wired into the action
handler**. `handleActionRequest` accepts any cross-origin POST to
`/_vesk/action/<id>` and executes the registered action. The only
same-origin signal used is the `Referer` header (`action-handler.ts:197-204`),
which is **fully attacker-controlled** (a malicious page can submit a form
with a forged Referer, or use `referrerpolicy`). Its only role is picking the
redirect path — it is not a CSRF check. Any state-changing action
(delete, logout, charge, etc.) is trivially CSRF-able from any website the
victim visits. The `csrfGuard` function itself is also cryptographically
broken (see Critical #3).

**Fix (edge-safe):**
- In `handleActionRequest`, reject state-changing methods unless `Origin` is
  same-host (or `x-csrf-token` verifies). An Origin check is pure string logic
  — no crypto needed, works on every runtime.
- Add the `x-csrf-token` to the action client form submission and verify via
  the same code path.

#### 2. Server-Side Code Injection via eval and new Function (architecture-inherent)

**Locations:**
- `packages/adapter/src/prod-server.ts:125` — `eval(\`(${result})\`)` on transpiled `vesk.config.ts`
- `packages/compiler/src/middleware.ts:89` — `eval(\`(${src})\`)` on `.vsk` middleware source
- `packages/compiler/src/server-utils.ts:545,550,556` — `new Function('props', 'return (' + raw + ')')` in `tryEvalExpr`
- `packages/compiler/src/server-utils.ts:720,738,756,774` — `new Function(...)` for top-level code / component evaluation
- `packages/compiler/src/server-head.ts:33` — `new Function('props', ...)` on head initializer
- `packages/compiler/src/server-jsgen.ts` — SSR render functions built via `new Function`
- `packages/adapter/src/static.ts:42` — `new Function(...params, body)` for prerendered static routes
- `packages/adapter/src/client-bundle.ts:345` + `packages/runtime/src/hmr-client.ts:23` — `globalThis.__vesk_hmr_eval = (code) => eval(code)` injected into the dev client bundle

**Threat model (important):** the eval'd sources are the app's **own authored
files** (config, middleware, `.vsk` components) compiled by the framework —
trusted developer input, not request input. There is no request-path that
feeds attacker bytes into these eval sites. The genuine exposure surfaces are:
(a) the dev server binds all interfaces and serves pages containing
`__vesk_hmr_eval` (any LAN client receives an eval-enabled bundle); (b) if an
attacker can write into the app directory (supply chain, compromised editor,
malicious dependency) the eval sites make compromise trivial.

**Fix:**
- Load `vesk.config.ts` via `await import()` of the transpiled module (or
  `vm.runInNewContext`) instead of `eval`.
- Remove `__vesk_hmr_eval` from the client bundle; perform HMR code evaluation
  through a scoped `new Function` inside the HMR module only, and require the
  dev server to bind `localhost` by default.
- Document the remaining `new Function` sites as deliberate compiler-runtime
  architecture (generated SSR functions), which is a first-class design choice.

#### 3. Forgeable CSRF/cookie MAC keyed with Math.random (non-cryptographic)

**Locations:** `packages/compiler/src/server-utils.ts:196-232, 248-281`

- `csrfSecret` (line 201) and `cookieSecret` (line 253) are generated with
  `Math.random()` — not a CSPRNG.
- `csrfHmac` (lines 206-215) is a 32-bit FNV-style polynomial over
  (value, secret), **not a MAC**: a 32-bit state space is offline-brute-
  forceable once an attacker holds one valid token; the secret contributes
  only 32 bits of state.
- `verifyCsrfToken` (line 231) and `unsignCookie` (line 280) compare with
  `===` (timing side-channel) instead of constant-time compare.
- The secret is selected **per `Host` header** (`csrfSecret(host)`,
  `cookieSecret(host)`), and the Host header is attacker-controlled when the
  server does not validate it — an attacker can request with a spoofed Host,
  receive a token signed under that host's secret, and replay it.
- `signCookie`/`unsignCookie` (lines 258-281) additionally rely on
  `crypto.subtle` (see High #1).

**Fix (edge-safe):**
- Generate secrets with `crypto.getRandomValues` (16+ bytes, hex/base64url).
- Replace `csrfHmac` with pure-JS HMAC-SHA256 over `value` keyed by the
  secret; use constant-time comparison.
- Do not key the secret map by attacker-controlled Host; derive from the
  server's configured host or use a single process secret.
- Validate `Host` against the configured host allowlist before using it.

### HIGH

#### 4. crypto.subtle dependence breaks webhooks and signed cookies on edge runtimes

**Locations:** `packages/runtime/src/request.ts:158-174`, `packages/compiler/src/server-utils.ts:258-281`

`webhook()` computes HMAC-SHA256 via `crypto.subtle.importKey` + `crypto.subtle.sign`.
On Cloudflare Workers / Vercel Edge `globalThis.crypto.subtle` is `undefined`,
so `computeSignature` **throws** "Web Crypto API not available" — webhook
verification is broken on those targets, and it is the user's own code, not a
compile error, so it fails at runtime. Signed cookies share the same
dependency.

**Fix (edge-safe):** add a small pure-JS HMAC-SHA256 module (no imports of
`node:crypto`, no `crypto.subtle`) in `packages/runtime/src` and use it for
both `webhook()` and the compiler's cookie signing. `crypto.getRandomValues`
remains fine for key/token generation. Verify with the existing webhook
constant-time loop (`request.ts:199-202`) and keep that loop for cookies too.

#### 5. SSR data-script token is predictable and appears in URLs/logs

**Locations:** `packages/cli/src/dev-server.ts:60-64`, `packages/adapter/src/runtime-bundle.ts:88-94`, `packages/adapter/src/prod-server.ts:243-253`

The `/ssr-data.js` token is `Math.random().toString(36) + Date.now().toString(36)`.
The endpoint is single-use (store-and-delete — good) but the token is
guessable, and the token travels as a `?t=` query string where it lands in
server access logs and `Referer`. `props` and `ssrData` often contain
session-sensitive values.

**Fix (edge-safe):** `crypto.getRandomValues` → 16-byte base64url token; set a
short TTL on the store entry; keep single-use semantics. Prefer passing the
token via a short-lived cookie set on the same response instead of the URL
(removes the log/Referer leak).

#### 6. Unbounded request-body reads (memory DoS)

**Locations:** `packages/cli/src/action-handler.ts:191-193`, `packages/cli/src/dev-server.ts:515-516`, `packages/adapter/src/prod-server.ts:15`

All three handlers stream the entire request body into an in-memory buffer
with no `Content-Length` cap. An unauthenticated client can exhaust memory.

**Fix:** enforce a body-size limit (e.g. 10 MB) from `Content-Length` and by
counting streamed bytes; reject with 413.

#### 7. Dev server binds all interfaces; HMR WebSocket has no Origin check

**Locations:** `packages/cli/src/dev-server.ts:851,864-878`, `packages/adapter/src/hmr.ts:240-243`, `packages/adapter/src/prod-server.ts:451`

`server.listen(port)` (no host) binds 0.0.0.0. The HMR `WebSocketServer` on
`/_vesk/hmr` accepts connections from any origin (CSWSH): a malicious website
the developer visits can open a WebSocket to `localhost:<port>`, receive
broadcasts (file paths, route lists, HMR payloads) and hold connections open.
The server only broadcasts (no message handler) so this is disclosure/resource
exhaustion, not RCE — but combined with #2's eval-enabled bundle it raises the
dev-server exposure.

**Fix:** bind dev (and prod) server to `localhost` by default with an explicit
`--host` override; validate the `Origin` header in the upgrade handler against
`http://localhost:<port>` (and configured LAN host) before
`wss.handleUpgrade`; in `adapter/hmr.ts` use the `verifyClient` option.

### MEDIUM

#### 8. Inline JSON data scripts allow `</script>` breakout (XSS)

**Locations:** `packages/compiler/src/server-render.ts:216-218, 259-260`

`ssg()` and the `buildDataScripts` inline fallback emit
`<script>const __vesk_props = ${JSON.stringify(props)};</script>`. JSON
`stringify` does **not** escape `</` — a prop/ssrData string containing
`</script><script>…</script>` breaks out of the element and executes.
The external-data-script path (current dev/prod default) avoids this, but
`ssg()` always uses inline, and any caller omitting `externalDataScript`
inherits the risk.

**Fix:** JSON-safe-encode: `String(JSON.stringify(v)).replace(/</g, '\\u003c')`
(or replace `<\/`), and additionally escape `\u2028`/`\u2029`. Better: route
SSG through `externalDataScript` too.

#### 9. Image component: attribute escaping gap and unvalidated `on*` attrs

**Locations:** `packages/runtime/src/image.ts:60-66`

The SSR path escapes only `"` in attribute values (not `&<>`), and `...rest`
spreads arbitrary attribute names — including `onerror`/`onload` — into the
markup. `src`/`srcset` accept any scheme (e.g. `javascript:`), though the
default CSP `script-src 'self'` (no `unsafe-inline`) blocks inline handlers in
both prod and dev, so exploitability depends on CSP being disabled or
developer-modified.

**Fix:** escape `&<>"` in values; drop `on*` keys from `rest`; validate
`src`/`srcset` schemes (http/https/data/relative only).

#### 10. Static-serving sanitization relies on regex-stripping `..`

**Locations:** `packages/adapter/src/prod-server.ts:234,266`

`sanitized = url.pathname.replace(/\.\./g, '')` is fragile: the WHATWG URL
parser already normalizes literal and percent-encoded dot segments, so it is
not currently exploitable, and the `_vesk/static/*` branch additionally has a
`startsWith(staticDir)` guard. But the regex approach breaks under future
parser/encoding changes and is inconsistent with the root-file branch (which
depends on the `startsWith(publicDir)` guard alone). `%2e%2e` / double-encoded
variants must not be relied upon to stay inert.

**Fix:** normalize via the parsed URL only, `resolve()` + prefix check on every
static branch (already present for `_vesk/static/`), and reject any decoded
path containing `..` instead of stripping it.

#### 11. Markdown renderer does not restrict link/image URL schemes

**Locations:** `packages/runtime/src/md.ts:434-436`

`<a href="${escapeHtml(link.url)}">` and `<img src=...>` emit the parsed URL
verbatim (escaped for HTML, but not scheme-filtered). A markdown source
containing `[x](javascript:...)` produces an executable link when clicked.

**Fix:** allowlist http/https/mailto for links and http/https/data for images;
otherwise render the text with the href dropped.

#### 12. API-route load failures disclose filesystem paths

**Locations:** `packages/compiler/src/api-routes.ts:239`

Failed route-module imports return `details: (e as Error).message` to the
client, which embeds absolute file paths. Low-grade info disclosure.

**Fix:** log the error server-side; return a generic 500.

#### 13. Protocol spoofing via x-forwarded-proto when trustProxy is off

**Locations:** `packages/compiler/src/server-utils.ts:524`, `packages/adapter/src/prod-server.ts:209`

`getClientProtocol` honors `x-forwarded-proto` even when `trustProxy` is
false, and uses it to build `__vesk_ssr_base_url`. A client can set
`x-forwarded-proto: https` to get `https://` absolute URLs over plain HTTP
(and the reverse), causing mixed-content and redirect anomalies.

**Fix:** only honor `x-forwarded-*` when `trustProxy` is enabled; otherwise
derive from `req.socket.encrypted`.

### LOW

1. Non-CSPRNG tokens: render tokens at `server-render.ts:67,119,403` use
   `Math.random()`. Not a boundary, but cheap to fix with
   `crypto.getRandomValues`.
2. Non-constant-time comparisons at `server-utils.ts:231` (CSRF) and `:280`
   (cookie unsigning) — timing oracle over an HMAC. Use the constant-time loop
   already in `request.ts:199-202`.
3. `__vesk_hmr_eval` global is present on every dev-served page
   (`client-bundle.ts:345`, `hmr-client.ts:23`); eval input is dev-compiled
   app code, but the global is an attractive target if any other sink appears.
   Remove when not in dev and gate on `location.hostname === 'localhost'`.
4. `Date.now()` in tokens leaks timing information; redundant once tokens use
   `getRandomValues`.
5. Prod `eval` of `vesk.config.ts` (`prod-server.ts:125`) loads the config
   file from disk on every start — developer file, but see #2 for the
   replacement mechanism.
6. Host header flows into `__vesk_ssr_base_url` (`prod-server.ts:210`) without
   validation — used only for absolute URL construction, but validate Host
   against a configured allowlist to preempt open-redirect scenarios.

### Mitigated / Positives (verified, not defects)

- **Auto-escaping codegen:** text nodes and attribute values are escaped via
  `__escape` / `escapeHtml` (`server-jsgen.ts:105,373-374`).
- **CSP defaults:** `script-src 'self'` in prod with no `unsafe-inline`/
  `unsafe-eval`; dev adds only `'unsafe-eval'` (`dev-server.ts:392-395`).
  `img-src 'self' data:` restricts image exfiltration sources.
- **External SSR data scripts** (recent fix) keep hydration data out of inline
  scripts, so no CSP relaxation is required for hydration.
- **Static file serving** is guarded by `resolve` + prefix checks and WHATWG
  URL dot-segment normalization.
- **CORS** is allow-list only, with a same-origin short-circuit
  (`server-utils.ts:356-381`); no wildcard+credentials combination is emitted.
- **Security headers:** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  HSTS, `X-XSS-Protection: 0` (`server-utils.ts:329-343`).
- **Rate limiter** default on the prod server, per-IP, with `Retry-After`
  (`prod-server.ts:212-220`).
- **ISR cache** has no unauthenticated HTTP purge/revalidate endpoint
  (`isr.ts:84-107`); revalidation is programmatic only.
- **Webhook** signature comparison is constant-time (`request.ts:199-202`).
- **Image pipeline** resolves `src` only from build-time scanned refs
  (`image-pipeline.ts:89-126`) — no request-time SSRF surface.
- `crypto.getRandomValues` is available on Node ≥17.4 and all edge targets —
  the recommended replacement primitive throughout this report.

---

## Recommended remediation order

1. **Edge-safe HMAC module** (pure JS) replacing every `crypto.subtle` use;
   secrets from `crypto.getRandomValues` (fixes Critical #3, High #4, Low #2).
2. **CSRF for server actions** via same-origin check on state-changing methods
   (fixes Critical #1).
3. **Dev/prod server bind to `localhost` by default** + HMR Origin validation
   (fixes High #7; shrinks the blast radius of Critical #2).
4. **CSPRNG data-script tokens** with TTL + non-URL delivery (fixes High #5).
5. **Body-size limits** (fixes High #6).
6. **JSON-safe encoding** for inline data scripts, incl. `ssg()` (fixes Medium #8).
7. Harden Image attrs (Medium #9), static sanitization (Medium #10), md schemes
   (Medium #11), API error leakage (Medium #12), proto spoofing (Medium #13).
8. Document the remaining `new Function` sites as intentional compiler-runtime
   architecture and sandbox the config eval (Critical #2 mitigations).
