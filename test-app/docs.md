# test-app/ — Documentation

> The **feature-heavy integration/E2E/hydration fixture** for the Vesk framework. Lives at
> `/root/vesk/test-app/`. It is a real Vesk project with 14 routes, multiple API routes,
> middleware, Tailwind, and a plugin example.

## Project structure

```
test-app/
  package.json        # private, deps pinned to local tarballs
  vesk.config.ts      # defineConfig + tailwind plugin + test plugin + security preset
  tsconfig.json       # strict TS, jsxImportSource '@vesk/compiler'
  src/global.css      # tailwind entry (@import 'tailwindcss')
  public/
    favicon.svg
  app/
    layout.vsk                # root layout
    page.vsk                  # / — Home (tracked counter, Throws, Appx, Appxx)
    about/page.vsk            # /about
    blog/
      page.vsk                # /blog
      middleware.ts            # blog-specific middleware
      [slug]/page.vsk          # /blog/:slug
    posts/page.vsk             # /posts
    statements/page.vsk        # /statements — every JS construct
    async/page.vsk             # /async — async load() + useFetch
    map/page.vsk               # /map — inline .map(), filter().map(), keyed maps
    md/page.vsk                # /md — markdown render
    store/
      page.vsk                 # /store
      [item]/page.vsk           # /store/:item
      error.vsk                 # /store error boundary
      not-found.vsk             # /store 404
    empty/page.vsk             # /empty — empty clause test
    actions/page.vsk           # /actions — server actions
    comp-test/
      helper.vsk               # shared component
      page.vsk                 # /comp-test
    typed/page.vsk             # /typed — TypeScript props
    not-found.vsk              # global 404
    error.vsk                  # global error boundary
    middleware.ts              # root middleware (onion model)
    admin/middleware.ts         # admin middleware
    api/
      bench/route.ts           # /api/bench
      hello/route.ts           # /api/hello
      protected/route.ts       # /api/protected
      echo/[msg]/route.ts      # /api/echo/:msg
      posts/route.ts           # /api/posts
```

## Route inventory

| Path | Source | Notes |
|---|---|---|
| `/` | `app/page.vsk` | Home — tracked counter, error boundaries, client component |
| `/about` | `app/about/page.vsk` | Static about page |
| `/blog` | `app/blog/page.vsk` | Blog index |
| `/blog/:slug` | `app/blog/[slug]/page.vsk` | Dynamic blog post |
| `/posts` | `app/posts/page.vsk` | useFetch + tracked cell |
| `/statements` | `app/statements/page.vsk` | if/else, ternary, switch, for, for-of, for-in, while, do-while, try/catch, labeled blocks, runtime statements |
| `/async` | `app/async/page.vsk` | async `load()`, server-side data fetch |
| `/map` | `app/map/page.vsk` | inline `.map()`, index param, keyed maps |
| `/md` | `app/md/page.vsk` | markdown render |
| `/store` | `app/store/page.vsk` | nested layout + params |
| `/store/:item` | `app/store/[item]/page.vsk` | dynamic nested |
| `/empty` | `app/empty/page.vsk` | empty clause |
| `/actions` | `app/actions/page.vsk` | server actions |
| `/comp-test` | `app/comp-test/page.vsk` | component composition |
| `/typed` | `app/typed/page.vsk` | TypeScript props |
| `/api/*` | `app/api/**/route.ts` | 5 API routes |
| `/not-found` | `app/not-found.vsk` | global 404 |
| `/error` | `app/error.vsk` | global error boundary |

## Config

`vesk.config.ts`:
- `appDir: './app'`, `outDir: './dist'`, `publicDir: './public'`.
- `security: preset('production', { trustProxy: true, cors: { origin: ['http://localhost:3002'] } })`.
- `plugins: [tailwindcss({ entry: 'src/global.css', appDir: 'app' }), testPlugin]` where `testPlugin` is a custom `definePlugin` with `provides` and `onRequest`.

## Dependencies

Pinned to local tarballs in `tarballs/`:
- `@vesk/compiler@0.1.6`
- `@vesk/runtime@0.1.6`
- `vesk@0.1.6`
- `@vesk/adapter@0.1.6`
- `@vesk/plugin-tailwind@0.1.3`

## Testing

The test-app is the fixture for:
- `hydration-test.mjs` (111 production hydration tests)
- `production-hydration-test.mjs`
- `tests/dev-test.mjs` (dev server E2E)
- `tests/prod-test.mjs` (production build E2E)
- `scripts/e2e-setup.js` (spins up prod + dev servers for E2E)

```bash
cd /root/vesk/test-app
npm install   # from tarballs
npm run dev   # http://localhost:3000
npm run build # → .vesk/
npm run start # serve .vesk/
```
