# Configuration

Vesk projects are configured with `vesk.config.js` or `vesk.config.ts`
in the project root.

## Basic config

```js
// vesk.config.js
import { defineConfig } from '@vesk/compiler';

export default defineConfig({
  appDir: './app',
  outDir: './dist',
  publicDir: './public',
});
```

## TypeScript config

```ts
// vesk.config.ts
import { defineConfig } from '@vesk/compiler';

export default defineConfig({
  appDir: './app',
  outDir: './dist',
  publicDir: './public',
  security: {
    preset: 'production',
  },
});
```

TypeScript configs are transpiled inline at startup — no extra build step
needed.

## Config options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appDir` | `string` | `'./app'` | Source directory containing routes and components |
| `outDir` | `string` | `'./dist'` | Build output directory |
| `publicDir` | `string` | `'./public'` | Static assets directory |
| `ssg` | `SSGConfig` | — | Static site generation options |
| `plugins` | `VeskPlugin[]` | `[]` | Build/dev plugins |
| `security` | `SecurityConfig` | — | Security presets (strict/default/minimal) |
| `routeDataCache` | `number` | — | Default TTL in ms for route data caching |
| `md` | `MdConfig` | — | Global markdown configuration |

## Security presets

```ts
import { defineConfig, preset } from '@vesk/compiler';

export default defineConfig({
  security: preset('production', {
    trustProxy: true,
  }),
});
```

Three presets:

| Preset | CSP | Rate Limiting | CORS |
|--------|-----|---------------|------|
| `'strict'` | Full lockdown | Enabled | Disabled |
| `'default'` | Balanced | Enabled | Same-origin |
| `'minimal'` | Relaxed | Disabled | Open |

## Environment variables

Vesk loads `.env` then `.env.local` before starting. Format:

```
DATABASE_URL=postgres://...
PUBLIC_API_URL=https://api.example.com
```

Rules:
- `KEY=VAL` lines only — no quotes needed (stripped if present)
- Existing `process.env` keys are never overridden
- `.env.local` takes precedence over `.env`

Public variables (accessible in client code) should be prefixed with
`PUBLIC_` by convention.

## Define helpers

```ts
import { defineConfig, definePlugin, preset } from '@vesk/compiler';

// defineConfig — validates config shape
export default defineConfig({ ... });

// definePlugin — validates plugin shape at definition time
const myPlugin = definePlugin({
  name: 'my-plugin',
  onBuildEnd: () => console.log('done'),
});

// preset — applies security defaults
const security = preset('production', { trustProxy: true });
```

## Supported platforms

The `--platform` flag (or `VESK_PLATFORM` env) controls output format:

| Platform | Output | Use case |
|----------|--------|----------|
| `node` | Default Node.js server | Self-hosted Node |
| `vercel` | Vercel edge functions | Vercel deployment |
| `netlify` | Netlify functions | Netlify deployment |
| `cloudflare` | Cloudflare Workers | CF Workers |
| `deno` | Deno-compatible | Deno Deploy |
| `deno` | AWS Lambda handlers | AWS |
| `edge` | Generic edge runtime | Any edge platform |
| `coxmos` | Coxmos format | Coxmos platform |

## Verified against

- `packages/compiler/src/config.ts` — `defineConfig`, `definePlugin`,
  `preset`, `validateConfig`
- `packages/cli/src/index.ts` — config loading (`loadConfig`)
- `packages/types/src/index.ts` — `VeskConfig`, `SecurityConfig`
