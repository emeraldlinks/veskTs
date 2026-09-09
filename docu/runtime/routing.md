# Routing

Vesk uses file-based routing. The file system structure under `app/`
determines URL routes.

## Route conventions

| File path | URL route |
|-----------|-----------|
| `app/page.vsk` | `/` |
| `app/about/page.vsk` | `/about` |
| `app/blog/page.vsk` | `/blog` |
| `app/blog/[slug]/page.vsk` | `/blog/:slug` |
| `app/shop/[id]/page.vsk` | `/shop/:id` |

### Dynamic segments

Wrap a folder name in brackets for dynamic segments:

```
app/flights/[id]/page.vsk   →  /flights/:id
```

Access the parameter via `useParams()`:

```vsk
component FlightDetail() {
  const { id } = useParams();
  return <p>Flight {id}</p>;
}
```

### Nested routes

```
app/
  layout.vsk          ← wraps all routes
  page.vsk            ← /
  shop/
    layout.vsk        ← wraps /shop/* routes
    page.vsk          ← /shop
    [id]/
      page.vsk        ← /shop/:id
```

The `layout.vsk` at each level wraps its children via `{props.children}`.

## Navigation components

All auto-imported from `@vesk/runtime` — no import needed.

### Link

```vsk
<Link href="/about">About</Link>
```

Client-side navigation — no full page reload. Prefetches on hover by
default.

### NavLink

```vsk
<NavLink href="/shop" activeClass="font-bold text-accent">Shop</NavLink>
```

Like `Link` but adds `activeClass` when the current URL matches.

### Redirect

```vsk
<Redirect to="/login" />
```

Server-side redirect (302 by default). Can also be used in server code:

```ts
import { redirect } from '@vesk/runtime';
return redirect('/login', 302);
```

## Hooks

All auto-imported inside components.

### useRouter

```vsk
const router = useRouter();

// Programmatic navigation
router.push('/about');
router.back();
router.refresh();  // re-fetch current route data
```

### useNavigate

```vsk
const navigate = useNavigate();
navigate('/dashboard');
```

### useParams

```vsk
const { id, slug } = useParams();
```

Returns route parameters for the current page.

### usePathname

```vsk
const pathname = usePathname();
// "/blog/my-post"
```

### useSearchParams

```vsk
const params = useSearchParams();
const page = params.get('page') || '1';
```

## Router options

```ts
createRouter({
  prefetch: true,           // prefetch on Link hover
  viewTransitions: true,    // use document.startViewTransition()
  hydrate: 'viewport',      // 'full' | 'viewport' | 'idle' | 'interaction'
  hash: false,              // hash-based routing
  routeDataCache: 30000,    // TTL ms for cached route data
  offline: OfflineComponent, // shown when network is offline
});
```

## Navigation guards

```vsk
component AuthGuard() {
  const router = useRouter();

  router.beforeEach((to, from) => {
    if (to.path === '/admin' && !isAuthenticated()) {
      return '/login';  // redirect
    }
    return true;        // allow
  });

  return <Outlet />;
}
```

## Server-side redirects

```ts
import { redirect, permanentRedirect } from '@vesk/runtime';

export async function Loader() {
  const user = await getUser();
  if (!user) return redirect('/login');
  return { user };
}
```

- `redirect(url, status?)` — 302 default
- `permanentRedirect(url, status?)` — 308 default
- `notFound()` — throws `NotFoundError`, renders `not-found.vsk`

## Verified against

- `packages/runtime/src/router.ts` — `createRouter`, `createFileRouter`,
  `buildRouteTree`, `matchRoute`, `defineRoute`
- `packages/runtime/src/router-components.ts` — `Link`, `NavLink`,
  `Outlet`, `Redirect`
- `packages/compiler/src/router.ts` — `scanRoutes`, file-system mapping
- `packages/runtime/src/index-client.ts` — router exports
