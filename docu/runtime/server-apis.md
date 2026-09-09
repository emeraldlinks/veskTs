# Server APIs

Vesk provides server-side APIs for request handling, cookies, headers,
response building, and middleware.

## Request context

Auto-imported in server-side code (pages, actions, middleware).

### cookies

```ts
import { cookies } from '@vesk/runtime';

// Read a cookie
const token = cookies().get('session');

// Read all cookies
const all = cookies().getAll();
```

Returns a `CookieStore` with `get(name)`, `getAll()`, and `toString()`.

### headers

```ts
import { headers } from '@vesk/runtime';

const accept = headers().get('accept');
const contentType = headers().get('content-type');
```

### locals

Per-request data shared between middleware and pages:

```ts
import { locals } from '@vesk/runtime';

const user = locals().user;  // set by middleware
```

### useParams (server)

```ts
import { useParams } from '@vesk/runtime';

const { id } = useParams();  // route parameters
```

### useBody

```ts
import { useBody } from '@vesk/runtime';

const body = await useBody();  // parsed JSON, form data, or text
```

### useRequest

```ts
import { useRequest } from '@vesk/runtime';

const req = useRequest();
const ip = req.ip;
const url = req.parsedUrl;
```

## VeskRequest

Extended `Request` with convenience properties:

| Property | Type | Description |
|----------|------|-------------|
| `host` | `string` | Request host |
| `origin` | `string` | Request origin |
| `query` | `URLSearchParams` | Parsed query string |
| `ip` | `string` | Client IP address |
| `protocol` | `string` | `http` or `https` |
| `hostname` | `string` | Request hostname |
| `parsedUrl` | `URL` | Parsed URL object |

Methods: `resolveUrl(path)`, `set(key, value)`, `get(key)`,
`setCsp(policy)`, `setRateLimit(options)`, `setCsrf(enable)`.

## VeskResponse

Build responses fluently:

```ts
import { VeskResponse } from '@vesk/runtime';

// Static methods
VeskResponse.json({ message: 'hello' });
VeskResponse.redirect('/login', 302);
VeskResponse.html('<h1>Hello</h1>');
VeskResponse.stream(readableStream);

// Instance methods
VeskResponse({ name: 'hello' })
  .setStatus(201)
  .setCookie('token', 'abc', { httpOnly: true, maxAge: 3600 })
  .cache(60)
  .cors({ origin: '*' })
  .build();
```

### Cookie options

```ts
.setCookie('session', value, {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 86400,
  path: '/',
});
```

### Security headers

```ts
.setCsp({ defaultSrc: ["'self'"], scriptSrc: ["'self'"] })
.setSecurityHeader('X-Frame-Options', 'DENY')
.noCache()
```

## ServerResponse

Base response with static helpers:

```ts
ServerResponse.json(body, init?);
ServerResponse.redirect(url, status?);
ServerResponse.rewrite(url);
ServerResponse.next();
```

## CORS

```ts
import { cors } from '@vesk/runtime';

// In middleware or config
cors({
  origin: 'https://example.com',
  methods: ['GET', 'POST'],
  credentials: true,
});
```

## Cookie signing

```ts
import { signCookie, unsignCookie, setSignedCookie, readSignedCookie } from '@vesk/runtime';

const signed = await signCookie('session', value);
const original = await unsignCookie('session', signed);
```

## Hooks

Lifecycle hooks for request processing:

```ts
import { defineHook, removeHook, runHooks } from '@vesk/runtime';

defineHook('beforeRequest', async (req) => {
  // runs before each request
});

removeHook('beforeRequest', handler);
await runHooks('beforeRequest', request);
```

## Server events

Process-wide context shared across requests:

```ts
import { setServerContext, getServerContext, serverLocals } from '@vesk/runtime';

// Set at boot (in app/_events.ts)
setServerContext('db', await createDatabase());

// Read anywhere in server code
const db = getServerContext('db');

// serverLocals is an alias for the same store
const store = serverLocals();
```

## Verified against

- `packages/runtime/src/request.ts` — `cookies`, `headers`, `locals`,
  `useParams`, `useBody`, `useRequest`, `VeskRequest`, `VeskResponse`,
  `ServerRequest`, `ServerResponse`, `cors`, `signCookie`, etc.
- `packages/runtime/src/server-events.ts` — `serverLocals`,
  `getServerContext`, `setServerContext`
- `packages/runtime/src/index-server.ts` — server barrel exports
