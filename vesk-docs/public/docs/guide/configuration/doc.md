# Configuration

A new Vesk app needs no configuration at all — conventions carry you. The
day you want to change something (a different routes folder, stricter
security, static generation, Tailwind), `vesk.config.ts` at your project
root is the single place to do it. Everything in it is optional and
validated when the CLI starts, so typos fail loudly instead of silently.

All configuration lives in `vesk.config.ts` (or `.js`). The canonical
type is `VeskConfig` from `@vesk/types`.

## Complete annotated config

Every key, with defaults — this file is exhaustive:

```ts
import { defineConfig, preset } from '@vesk/compiler';
import tailwindcss from '@vesk/plugin-tailwind';

export default defineConfig({
	// ── Paths ────────────────────────────────────────────────────────────
	appDir: './app',          // route/page source dir            (default './app')
	outDir: '.vesk',          // build output                     (default '.vesk')
	publicDir: './public',    // static assets copied to builds   (default './public')

	// ── Security ─────────────────────────────────────────────────────────
	// object | preset name | false (=off) | function receiving preset()
	security: preset('production', {
		trustProxy: true,                                  // behind nginx/Cloudflare
		// rateLimit: { windowMs: 60_000, max: 100 },      // sliding window
		// cors: { origin: ['https://app.example.com'] },
	}),
	// security: false        // everything off (not recommended)

	// ── Plugins ──────────────────────────────────────────────────────────
	plugins: [
		tailwindcss({ entry: 'src/global.css', appDir: 'app' }),
	],

	// ── Static Site Generation ───────────────────────────────────────────
	ssg: {},                  // prerender pages exporting getStaticPaths/Props

	// ── Client router ────────────────────────────────────────────────────
	routeDataCache: 0,        // ms TTL for SPA route data. 0 = always refetch

	// ── Markdown (<Md>) ──────────────────────────────────────────────────
	md: {
		html: 'escape',         // 'escape' | 'allow' | 'allowlist'   (default 'escape')
		allowTags: ['em', 'strong', 'a'],  // only for 'allowlist'
	},
});
```

## Reference

### `VeskConfig`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `appDir` | `string` | `'./app'` | Scanned for pages/boundaries/middleware/API |
| `outDir` | `string` | `'.vesk'` | Resolved relative to appDir's parent |
| `publicDir` | `string` | `'./public'` | Copied to `static/public/`; sitemap/robots generated here unless user-supplied |
| `ssg` | `{ getStaticPaths? }` | — | Enables prerendering (see SSG page) |
| `plugins` | `VeskPlugin[]` | `[]` | Must each pass validation |
| `security` | see below | preset defaults | See table below |
| `routeDataCache` | `number` | `0` | SPA nav data TTL in ms |
| `md` | `MdConfig` | `{ html: 'escape' }` | `<Md>` raw-HTML policy |

### `VeskSecurity`

| Key | Default (`strict`) | Values |
| --- | --- | --- |
| `autoEscape` | `true` | SSR dynamic-text escaping |
| `csrf` | `true` | Same-origin assert on unsafe methods |
| `xFrameOptions` | `'DENY'` | string \| `false` |
| `contentSecurityPolicy` | self-only policy (+ style inline) | string \| `false` |
| `hsts` | `'max-age=31536000; includeSubDomains'` | string \| `false` |
| `referrerPolicy` | `'strict-origin-when-cross-origin'` | string \| `false` |
| `cors` | — | `{ origin, methods?, headers?, credentials?, maxAge? }` |
| `trustProxy` | `false` | boolean \| string — honor x-forwarded-* |
| `rateLimit` | `{ windowMs: 60000, max: 100 }` | sliding-window limiter → 429 + Retry-After |
| `redactLogs` | `true` | Mask secrets in dev-server logs |

### Presets

```ts
preset('production')    // = 'strict': everything above
preset('development')   // strict minus CSP (HMR-friendly)
preset('minimal')       // autoEscape only; no CSRF/HSTS/CSP; SAMEORIGIN
// or: security: false   // all off
```

Compose overrides: `preset('production', { trustProxy: true })`.
Function form: `security: (p) => p('production', { trustProxy: true })`.

## Normalization rules (`defineConfig`)

- Unknown preset names throw listing valid options.
- `md.html` must be `escape|allow|allowlist`; `allowTags` lowercases and
  strips to `[a-z0-9-]`.
- Plugin objects must have a non-empty string `name` **and** at least one
  hook (`onCSS`, `onFileWatch`, `onTransformJS`, `onBuildStart`,
  `onBuildEnd`, `onRequest`) or a non-empty `provides` record.
- Defaults fill anything undefined (see tables above).
- A broken/unreadable config in production fails **closed**: secure
  defaults apply with a loud warning.

## API reference

```ts
/** Normalize + validate a Vesk configuration. Throws descriptively. */
function defineConfig(config: VeskConfig): VeskConfig;

/** Named security preset with optional overrides. */
function preset(name: 'production' | 'development' | VeskSecurityPreset,
                overrides?: VeskSecurity): VeskSecurity;

/** Definition-time plugin validation wrapper. */
function definePlugin(plugin: VeskPlugin): VeskPlugin;

/** Validate an already-built config object. */
function validateConfig(config: VeskConfig): void;

/**
 * Default allowTags for md.html:'allowlist' — inline formatting only:
 * a abbr b bdi bdo br cite code data del dfn em i ins kbd mark q rp rt
 * ruby s samp small span strong sub sup time u var wbr
 */
const MD_DEFAULT_ALLOW_TAGS: string[];
```
