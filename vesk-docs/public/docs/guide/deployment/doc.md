# Deployment

You wrote the app once — deploy it anywhere. `vesk build` produces an
optimized `.vesk/` bundle, and the `--platform` flag reshapes it for your
host of choice, generating the entrypoints and config files each platform
expects. Eight targets are supported out of the box: `node`, `vercel`,
`netlify`, `cloudflare`, `deno`, `aws`, `edge`, and `coxmos`. Building on
CI without a flag? Vesk detects the platform from environment variables
your host sets.

## Platform detection

Precedence: explicit `--platform` → CI env vars → `node`.

| Platform | Detection env vars |
| --- | --- |
| vercel | `VERCEL`, `VERCEL_ENV`, `NOW_REGION`, `VERCEL_GIT_COMMIT_SHA` |
| netlify | `NETLIFY`, `NETLIFY_BUILD_CONTEXT`, `NETLIFY_LOCAL`, `NETLIFY_EDGE` |
| cloudflare | `CF_PAGES`, `CF_PAGES_BRANCH`, `CF_PAGES_URL`, `CLOUDFLARE_WORKERS`, `WORKERS_NAME` |
| deno | `DENO_DEPLOYMENT_ID`, `DENO_REGION`, `DENO_DEPLOY_URL` |
| aws | `AWS_LAMBDA_FUNCTION_NAME`, `AWS_LAMBDA_FUNCTION_VERSION`, `LAMBDA_TASK_ROOT`, `LAMBDA_RUNTIME_DIR` |
| coxmos | `COXMOS`, `COXMOS_DEPLOYMENT_ID`, `COXMOS_ENV`, `VESK_DEPLOY`, `VESK_PLATFORM==='coxmos'` |

## Node (default)

```sh
vesk build
vesk start            # serves .vesk/ — SSR, streaming, ISR, API, SSG, 404
```

Run behind your own process manager (`systemd`, Docker, PM2). Bind
explicitly with `-H 0.0.0.0 -p $PORT` when needed.

## Vercel

```sh
vercel               # or: vesk build --platform vercel && vercel deploy
```

Emits `.vesk/vercel/` following the **Vercel Build Output API**:

- `functions/__index.func/` — Node function (`nodejs22.x`,
  response streaming enabled) exposing `handleRequest`
- static assets under `static/`, CDN-served
- `config.json` routes: prerendered rewrites → static HTML, filesystem
  handler, catch-all → the function
- `.vercel/output` symlink for tooling

## Netlify

```sh
vesk build --platform netlify
# deploy .vesk/netlify/
```

- `netlify/functions/__index.js` — `export default { fetch: handleRequest }`
  with `config = { path: '/*', preferStatic: true }`
- Static files at artifact root, CDN-served

## Cloudflare

```sh
vesk build --platform cloudflare
wrangler deploy      # deploys .vesk/cloudflare/_worker.js
```

- Single `_worker.js` edge bundle (no Node builtins)
- Unmatched asset requests fall through to `env.ASSETS.fetch`
- Static assets served via Workers Assets from the artifact root

## Deno / coxmos

```sh
vesk build --platform deno
deno run --allow-net --allow-read .vesk/deno/index.js
```

- `Deno.serve({ port: Number(Deno.env.get('PORT') || 8000) })`
- Static read from disk (`./static/`) then `handleRequest`;
  `export default handleRequest` also available
- `coxmos` emits an identical shell to `.vesk/coxmos/`
- Default port is **8000** (via `PORT` env), unlike Node's 3000

## AWS Lambda

```sh
vesk build --platform aws
sam deploy --guided        # uses generated template.yaml
```

- `.vesk/aws/index.mjs` — Payload v2 handler (`rawPath`,
  base64-encoded bodies) → `Request` → response `{statusCode, headers,
  body(base64)}`
- Generated SAM template: `AWS::Serverless::Function`, runtime
  `nodejs22.x`, memory 512 MB, timeout 30 s, HttpApi `$default` ANY,
  no authorizer
- Static embedded on disk next to the bundle

## Generic edge

```sh
vesk build --target edge     # or --platform edge
```

- Runtime-agnostic bundle exporting `handleEdgeRequest(request)`
- No filesystem access: **static assets inline into the bundle**
  (text as strings, binary as base64 in a `__STATIC` map)
- Works on any edge runtime that accepts a fetch-like handler

## What every non-node build includes

1. Universal handler source routing SSR pages, `/api/*`, prerendered
   paths and middleware (ISR cache included)
2. Static layout mapping `.vesk/static/**` into the platform's convention
3. Prerendered HTML written as static files (+ trailing-slash twins)
4. `manifest.json`: `{ platform, runtime, static mode, handler, routes,
   apiRoutes, prerendered }`

## Environment variables at runtime

| Var | Meaning |
| --- | --- |
| `PORT` | Listen port for Deno-family servers (default 8000); node uses CLI flags |
| `NODE_ENV` | Set to production by `vesk start`; gates error detail exposure |

## Checklist

- [ ] Set `siteUrl` (build option) so sitemap URLs are absolute
- [ ] Behind a proxy? `security.preset('production', { trustProxy: true })`
- [ ] Provide `sharp` in the build environment for image resizing
- [ ] Verify CSP if you inject third-party scripts (strict default)
