# Middleware

Vesk middleware runs in an onion model — each layer wraps the next,
enabling pre/post processing of requests.

## Defining middleware

Create `app/middleware.ts` (or `.js`):

```ts
import type { MiddlewareContext } from '@vesk/types';

export default async function middleware(ctx: MiddlewareContext) {
  const start = Date.now();

  // Run the next middleware/page
  await ctx.next();

  // Post-processing
  const duration = Date.now() - start;
  ctx.setHeader('X-Response-Time', `${duration}ms`);
}
```

## MiddlewareContext

| Property | Type | Description |
|----------|------|-------------|
| `request` | `VeskRequest` | The incoming request |
| `response` | `VeskResponse` | The response being built |
| `next()` | `() => Promise<void>` | Call to continue the chain |
| `set(key, value)` | `(key: string, value: unknown) => void` | Store per-request data |
| `get(key)` | `(key: string) => unknown` | Read per-request data |
| `setHeader(name, value)` | `(name: string, value: string) => void` | Set response header |
| `redirect(url, status?)` | `(url: string, status?: number) => void` | Short-circuit with redirect |
| `rewrite(url)` | `(url: string) => void` | Internally rewrite the URL |

## Onion model

```
Request → Middleware A → Middleware B → Page → Middleware B → Middleware A → Response
```

Each `ctx.next()` passes control to the next layer. Code after `ctx.next()`
runs on the way back out.

## Examples

### Logging

```ts
export default async function logging(ctx: MiddlewareContext) {
  const start = Date.now();
  await ctx.next();
  const ms = Date.now() - start;
  console.log(`${ctx.request.method} ${ctx.request.url} ${ms}ms`);
}
```

### Authentication guard

```ts
export default async function auth(ctx: MiddlewareContext) {
  const token = ctx.request.cookies.get('token');
  if (ctx.request.url.startsWith('/admin') && !token) {
    ctx.redirect('/login', 302);
    return;
  }
  await ctx.next();
}
```

### CORS

```ts
import { cors } from '@vesk/runtime';

const corsMiddleware = cors({
  origin: 'https://example.com',
  methods: ['GET', 'POST'],
});

export default async function handler(ctx: MiddlewareContext) {
  await corsMiddleware(ctx.request);
  await ctx.next();
}
```

### Rate limiting

```ts
export default async function rateLimit(ctx: MiddlewareContext) {
  const ip = ctx.request.ip;
  const count = ctx.get(`rate:${ip}`) || 0;

  if (count > 100) {
    ctx.response = VeskResponse.json({ error: 'Too many requests' }, { status: 429 });
    return;
  }

  ctx.set(`rate:${ip}`, count + 1);
  await ctx.next();
}
```

## Security middleware

```ts
import { applyRequestSecurity } from '@vesk/runtime';

export default async function security(ctx: MiddlewareContext) {
  applyRequestSecurity(ctx.request, ctx.response);
  await ctx.next();
}
```

## Verified against

- `packages/adapter/src/middleware.ts` — middleware chain compilation
- `packages/compiler/src/middleware.ts` — `collectMiddlewareChain`
- `packages/types/src/index.ts` — `MiddlewareContext`
