# Cookies

Sessions, consent toggles, "remember me" — cookies remain the workhorse
of web state. Vesk gives you three layers, from simplest to safest:
read cookies anywhere with `cookies()`, write them fluently on responses
with `setCookie()` (secure defaults built in), and make values
tamper-proof with HMAC-signed cookie helpers.

## Reading — `cookies()`

```ts
import { cookies } from '@vesk/runtime/server';

export async function GET() {
	const c = cookies();
	const sid = c.get('sid');        // string | undefined
	const all = c.getAll();          // [{ name, value }]
	return VeskResponse.json({ sid });
}
```

```ts
interface CookieStore {
	get(name: string): string | undefined;
	getAll(): Array<{ name: string; value: string }>;
	toString(): string;              // "k=v; k2=v2"
}
```

On the server it reads the request's `Cookie` header (via the ambient
request context); in browser code it falls back to `document.cookie`.

Middleware also receives parsed cookies directly:
`ctx.cookies.get('sid')` on `MiddlewareContext`.

## Writing — `VeskResponse.setCookie`

```ts
import { VeskResponse } from '@vesk/runtime/server';

export async function POST(req: VeskRequest) {
	return VeskResponse.json({ ok: true })
		.setCookie('session', 'abc123', {
			httpOnly: true,
			secure: true,
			sameSite: 'Lax',
			path: '/',
			maxAge: 3600,
		});
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `httpOnly` | **true** | JS cannot read the cookie |
| `secure` | **true** | HTTPS only |
| `sameSite` | `'Lax'` | `'Lax' \| 'Strict' \| 'None'` |
| `path` | `'/'` | Scope |
| `domain` | host | Domain scope |
| `maxAge` | session | Seconds |

Safe-by-default: `httpOnly`/`secure` are ON unless you explicitly pass
`false`. Chain `.clearCookie(name)` to expire (`maxAge: 0`), and
`.build()` when constructing responses manually so pending `Set-Cookie`
headers flush.

Real working route from a scaffolded app:

```ts
// app/api/hello/route.ts
import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
	return VeskResponse.json({ message: 'Hello from Vesk!' })
		.setCookie('session', 'abc123', { httpOnly: true, secure: true, path: '/', maxAge: 3600 })
		.setStatus(201);
}
```

## Signed cookies

Tamper-proof values via HMAC-SHA256:

```ts
import {
	signCookie, unsignCookie,
	setSignedCookie, readSignedCookie,
} from '@vesk/runtime/server';

// create: value + signature ("value.signature")
const signed = await signCookie('pref', JSON.stringify(prefs));

// verify: original value, or null when tampered/expired
const original = await unsignCookie('pref', incoming);

// convenience pair for responses / raw header strings
await setSignedCookie('pref', value, { maxAge: 86400 });
const v = await readSignedCookie('pref', req.headers.get('cookie') ?? '');
```

All four accept an optional trailing `host` to bind the signature to a
deployment origin. They lazily load the compiler's crypto helpers — in
standalone runtime-only deployments without the compiler package they
throw with an explanatory message.

## Patterns

### Session flow

```ts
export async function POST(req: VeskRequest) {
	const { user, pass } = await req.json();
	if (!(await checkLogin(user, pass))) {
		return VeskResponse.json({ error: 'invalid' }, { status: 401 });
	}
	return VeskResponse.json({ ok: true })
		.setCookie('session', await createSession(user), { maxAge: 60 * 60 * 24 });
}

export async function GET() {
	const c = cookies();
	if (!c.get('session')) return VeskResponse.redirect('/login');
	return VeskResponse.json({ user: await readSession(c.get('session')!) });
}
```

### Consent toggle without JS

Any page can post to an API route that sets a cookie and redirects back —
works with forms before hydration.
