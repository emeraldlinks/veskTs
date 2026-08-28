# Security

Security is on by default. Configure via the `security` key in
`vesk.config.ts` — see [Configuration](../configuration/doc.md) for
presets.

## Presets

```ts
security: preset('production')            // = 'strict'
security: preset('development')           // strict minus CSP (HMR-friendly)
security: preset('minimal')               // autoEscape only
security: false                           // everything off (not recommended)
```

| Option | Default | Description |
| --- | --- | --- |
| `autoEscape` | `true` | Dynamic text escapes on SSR |
| `csrf` | `true` | Same-origin assert on unsafe methods (see below) |
| `xFrameOptions` | `'DENY'` | Clickjacking protection; string or `false` |
| `contentSecurityPolicy` | strict self-only policy | String or `false`; style-src includes `'unsafe-inline'` for component styles |
| `hsts` | `'max-age=31536000; includeSubDomains'` | Via presets; `false` disables |
| `referrerPolicy` | `'strict-origin-when-cross-origin'` | |
| `cors` | — | `{ origin, methods, headers, credentials, maxAge }` |
| `trustProxy` | `false` | Trust x-forwarded-* headers (`boolean \| string`) |
| `rateLimit` | `{ windowMs: 60000, max: 100 }` | Sliding-window limiter |
| `redactLogs` | `true` | Mask secrets/tokens in dev logs |

A broken config file **fails closed**: production keeps secure defaults and
logs loudly instead of proceeding silently.

## CSRF

Mutating requests (POST/PUT/PATCH/DELETE) from browsers must present an
`Origin` or `Referer` whose authority equals the request `Host`
(one-sided port differences tolerated; different hostnames never).
Non-browser clients without these headers pass through.

Applies to:

- Server actions (`POST /_vesk/action/:id`)
- API routes (opt out per-route with `export const config = { csrf: false }`)

Cross-site browser submissions get **403**.

## Rate limiting

```ts
security: preset('production', {
	rateLimit: { windowMs: 60_000, max: 100 },
}),
```

- Keyed by client IP; proxy headers only honored when `trustProxy` is set
  (prevents spoofing).
- Rejections respond **429** with a `Retry-After` header.
- Applied by `vesk start` automatically from config.

```ts
/** Standalone limiter for custom servers. */
function createRateLimiter(options?: {
	windowMs?: number;          // default 60000
	max?: number;               // default 100
	cleanupIntervalMs?: number; // default 60000
	trustProxy?: boolean;       // default false
}): {
	check(key: string): boolean;
	remaining(key: string): number;
	reset(key: string): void;
	getConfig(): { windowMs: number; max: number };
	middleware(request: Request, response?: Response): boolean;
};

function getClientIp(request: Request | undefined, trustProxy?: boolean | string): string;
function getClientProtocol(request: Request | undefined, trustProxy?: boolean | string): string;
```

## Request body limits

Bodies are capped at `maxBodyBytes` (default **1 MiB**; configurable in
dev/prod server options). Oversized bodies → **413**.

## Error exposure

Detailed errors (messages, stacks, action failures, SSR error comments,
API 500 payloads) render **only outside production**. `vesk start` sets
`NODE_ENV=production`, so users see generic messages.

## Signed cookies

```ts
import { signCookie, unsignCookie, setSignedCookie, readSignedCookie } from '@vesk/runtime/server';

const signed = await signCookie('sid', value);            // HMAC-SHA256
const original = await unsignCookie('sid', signedValue);   // null if tampered
```

`VeskResponse.setCookie` defaults: HttpOnly + Secure **on**, SameSite=Lax,
Path=/.

## Webhooks

HMAC-SHA256 signature verification for inbound webhooks:

```ts
import { webhook } from '@vesk/runtime/server';

const handler = webhook({
	secret: process.env.STRIPE_SECRET!,
	handler: (event) => console.log(event.type),
	// headerName?: default 'x-webhook-signature'
	// signaturePrefix?: default 'sha256='
});

export const POST = handler;
```

Missing/invalid signature → **401** JSON.

## CORS middleware

```ts
import { cors } from '@vesk/runtime/server';

const c = cors({ origin: 'https://app.example.com' });

// OPTIONS preflight → 204 response; other methods → undefined (continue)
export async function GET(req) {
	const pre = c(req);
	if (pre) return pre;
	return c.applyCors(VeskResponse.json({ ok: true }));
}
```

Config-level `cors.credentials` is opt-in and never combined with a
wildcard origin.

## Serialization safety

Inline data scripts (hydration props, SSR data) serialize through
`safeJsonForScript()` which escapes `<` and line separators U+2028/2029 —
blocking `</script>` breakout attacks.

## Misc

- Servers bind **127.0.0.1** by default; exposing requires explicit
  `--host 0.0.0.0` / host option.
- HMR WebSocket upgrades origin-check against loopback aliases; the HMR
  eval hook is nonce-gated per session.
- Static/prerendered serving resolves every path through a containment
  helper — traversal outside the output dir is rejected.
