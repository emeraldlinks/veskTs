export type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: { slug: string; title: string; description: string; group: string; blocks: Block[] }[] = [
  {
    slug: "config",
    title: "Configuration",
    description:
      "vesk.config.js / vesk.config.ts, defineConfig and how it normalizes security, environment loading, platforms, and the app-level events + context system.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text:
          "Vesk projects are configured with `vesk.config.js` or `vesk.config.ts` in the project root. TypeScript configs are transpiled inline at startup — no separate build step needed.",
      },
      { kind: "h2", text: "Basic config" },
      {
        kind: "code",
        filename: "vesk.config.ts",
        code: `import { defineConfig } from '@vesk/compiler'

export default defineConfig({
  appDir: './app',
  outDir: '.vesk',
  publicDir: './public',
  security: 'strict',
  md: {
    html: 'escape',
  },
})`,
      },
      { kind: "h2", text: "Loading" },
      {
        kind: "list",
        items: [
          "The CLI looks for `vesk.config.js` first, then `vesk.config.ts`; if neither exists, the app runs with defaults.",
          "TS configs are transpiled inline (`typescript.transpile`); `@vesk/compiler` imports are stripped, `defineConfig` / `definePlugin` / `preset` are injected via `globalThis.__vesk_inject`, the result is written to `.vesk/config.tmp.js`, imported, and the exports map makes the helpers available inside the config.",
          "The loaded object flows through `defineConfig` (normalization + security defaults) and then `validateConfig` (plugin contract checks) before any command runs.",
          "Environment files load before the config (`loadEnvFiles` runs first), so `process.env` is already populated when `vesk.config.ts` evaluates.",
        ],
      },
      { kind: "h2", text: "Config options" },
      {
        kind: "table",
        head: ["Option", "Type", "Description"],
        rows: [
          ["appDir", "string", "Source directory holding routes and components. CLI default: `./app`."],
          ["outDir", "string", "Build output directory. Default: `resolve(appDir, '..', '.vesk')` — the `.vesk/` folder."],
          ["publicDir", "string", "Static-assets directory served as-is. CLI default: `./public`."],
          ["ssg", "SSGConfig", "Static-site generation marker: `{ getStaticPaths?() }`. Pages exporting `getStaticProps` (dynamic pages exporting `getStaticPaths`) pre-render into `.vesk/prerendered/`."],
          ["plugins", "VeskPlugin[]", "Plugin objects registered into the build/dev pipelines (see the Plugin API page)."],
          ["security", "SecurityConfig", "Preset name, object, `false`, or a function receiving `preset` — see Security below."],
          ["routeDataCache", "number", "Client-router route-data freshness TTL in ms. Default `0` = always fetch fresh server data on an SPA visit."],
          ["md", "MdConfig", "Global markdown options for `<Md>`: `html` (`'escape'` default | `'allow'` | `'allowlist'`) and `allowTags`. `'allowlist'` with no `allowTags` uses the built-in default tag list (a, abbr, b, br, code, em, i, kbd, mark, q, s, samp, small, span, strong, sub, sup, time, u, var, wbr, and more)."],
        ],
      },
      { kind: "h2", text: "defineConfig" },
      {
        kind: "p",
        text:
          "`defineConfig(config)` returns the config after normalizing it. It resolves `security` (preset string to object, `'off'`/`false` to `{}`, function to its return value) and then fills in guard defaults that apply on top of any preset.",
      },
      {
        kind: "list",
        items: [
          "`security` may be a named preset (`'strict'`, `'default'`, `'minimal'`), `'off'` / `false`, a plain object, or a function `(preset) => VeskSecurity` that receives the `preset()` helper.",
          "Applying the defaults fills: `autoEscape: true`, `csrf: true` (same-origin check for unsafe methods), `xFrameOptions: 'DENY'`, the default Content-Security-Policy, and `redactLogs: true` — even when `security` was `false`/`'off'` (those only suppress the named-preset picks).",
          "The default CSP is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`.",
          "`routeDataCache` defaults to `0` when absent.",
          "`md.html` must be one of `escape` / `allow` / `allowlist` (anything else throws a config error); `md.allowTags` entries are lowercased and stripped to `[a-z0-9-]`.",
        ],
      },
      { kind: "h2", text: "Security presets" },
      {
        kind: "p",
        text:
          "The named presets are built in `@vesk/compiler/src/config.ts`. `'default'` is defined as a shallow copy of `'strict'`. Presets only set the fields shown; the rate-limit / CORS / trust-proxy knobs live on `VeskSecurity` but are not part of any preset.",
      },
      {
        kind: "table",
        head: ["Preset", "Auto-escape", "CSRF", "X-Frame-Options", "HSTS", "Content-Security-Policy", "Referrer-Policy", "Redact logs"],
        rows: [
          ["'strict'", "✓", "✓", "DENY", "max-age=31536000; includeSubDomains", "default CSP (lockdown)", "strict-origin-when-cross-origin", "✓"],
          ["'default'", "✓", "✓", "DENY", "max-age=31536000; includeSubDomains", "default CSP", "strict-origin-when-cross-origin", "✓"],
          ["'minimal'", "✓", "—", "SAMEORIGIN", "—", "—", "—", "—"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "`security: false` / `'off'` sets the security object to `{}`. `defineConfig` then still applies its guard defaults (auto-escape, same-origin CSRF, `X-Frame-Options: DENY`, the default CSP, log redaction). `securityHeaders` always emits `X-Content-Type-Options: nosniff` and `X-XSS-Protection: 0` as well.",
      },
      { kind: "h2", text: "preset()" },
      {
        kind: "p",
        text:
          "`preset(name, overrides?)` returns a security object for `'production'` (strict settings) or `'development'` (strict minus Content-Security-Policy). Unknown names throw, and `overrides` are merged last. It is normally reached through the `security` function form:",
      },
      {
        kind: "code",
        filename: "vesk.config.ts",
        code: `import { defineConfig } from '@vesk/compiler'

export default defineConfig({
  security: (preset) =>
    preset('production', {
      contentSecurityPolicy: false,
    }),
})`,
      },
      { kind: "h2", text: "Environment variables" },
      {
        kind: "list",
        items: [
          "`vesk` loads `.env` then `.env.local` from the project root before anything else; because keys are only set when not already in `process.env`, `.env.local` wins over `.env`.",
          "Only `KEY=VAL` lines are read. Blank lines and `#` comments are skipped; surrounding quotes on values are stripped.",
          "Keys already present in `process.env` are never overridden by either file.",
          "Loaded before `vesk.config.ts` evaluates, so config files can read `process.env` at load time.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "There is no built-in mechanism that copies environment variables into client code. Anything the client needs must be fetched or explicitly wired — do not rely on env vars leaking into the client bundle.",
      },
      { kind: "h2", text: "Platforms" },
      {
        kind: "p",
        text:
          "`vesk build --platform <name>` picks the deployment artifact. Without the flag, the adapter auto-detects the platform from well-known CI/build environment variables and otherwise defaults to a standard Node server.",
      },
      {
        kind: "table",
        head: ["Platform", "How it is selected"],
        rows: [
          ["node", "Default when nothing else matches."],
          ["vercel", "`--platform vercel`, or `VERCEL` / `VERCEL_ENV` / `NOW_REGION` / `VERCEL_GIT_COMMIT_SHA` are set."],
          ["netlify", "`--platform netlify`, or `NETLIFY` / `NETLIFY_BUILD_CONTEXT` / `NETLIFY_LOCAL` / `NETLIFY_EDGE` are set."],
          ["cloudflare", "`--platform cloudflare`, or `CF_PAGES` / `CF_PAGES_BRANCH` / `CF_PAGES_URL` / `CLOUDFLARE_WORKERS` / `WORKERS_NAME` are set."],
          ["deno", "`--platform deno`, or `DENO_DEPLOYMENT_ID` / `DENO_REGION` / `DENO_DEPLOY_URL` are set."],
          ["aws", "`--platform aws`, or `AWS_LAMBDA_FUNCTION_NAME` / `AWS_LAMBDA_FUNCTION_VERSION` / `LAMBDA_TASK_ROOT` / `LAMBDA_RUNTIME_DIR` are set."],
          ["edge", "Edge deployment via `--platform edge` (an artifact builder); `--target edge` separately selects the edge runtime target."],
          ["coxmos", "`--platform coxmos`, or `COXMOS` / `COXMOS_DEPLOYMENT_ID` / `COXMOS_ENV` / `VESK_DEPLOY` / `VESK_PLATFORM=coxmos` are set."],
        ],
      },
      { kind: "h2", text: "App events and server context" },
      {
        kind: "p",
        text:
          "App-level lifecycle events live in one convention file: `app/_events.ts` (or `app/_events.js`), which exports optional `onStart`, `onRequest` and `onStop` handlers. The `_` prefix marks the file private — it is never routed. Both the events file and plugin `onStart`/`onStop` hooks receive a `ServerEventContext`.",
      },
      {
        kind: "code",
        filename: "app/_events.ts",
        code: `import type { ServerEventContext } from '@vesk/types'

export async function onStart(ctx: ServerEventContext) {
  ctx.set('bootedAt', Date.now())
}

export async function onRequest(ctx: ServerEventContext) {
  const hits = (ctx.get('hits') as number) || 0
  ctx.set('hits', hits + 1)
}`,
      },
      {
        kind: "list",
        items: [
          "`onStart` runs once when a dev/start server boots, before it begins listening; on serverless/edge targets it runs lazily once per isolate. Node servers additionally expose `server`, `port`, and `host`.",
          "`onRequest` runs for every request and receives the per-request `request`, `params`, `url`, `cookies` and `locals` in addition to the shared store.",
          "`onStop` runs on graceful shutdown (`SIGINT`/`SIGTERM`). Node dev/start servers only — serverless/edge targets have no shutdown lifecycle.",
          "`ctx.set(key, value)` / `ctx.get(key)` read and write the process-wide store exposed as `serverLocals`. Values set during `onStart` are pre-seeded into every request's `locals()`.",
          "Dev servers run the live handlers and reload them on HMR; production builds bake `app/_events.ts` into `server/events.js` at build time.",
        ],
      },
      {
        kind: "table",
        head: ["Field", "Description"],
        rows: [
          ["server", "The running Node `http.Server`, or `null` on serverless/edge targets and at build time."],
          ["port / host", "The port (0 without a persistent server) and bind address."],
          ["request / params / url / cookies", "Per-request values, populated for `onRequest`."],
          ["locals", "Per-request context, pre-seeded from the server-wide store."],
          ["serverLocals", "The process/isolate-wide store shared across every request."],
          ["set(key, value) / get(key)", "Write / read the server-wide store."],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "The plugin `onStart` and `onStop` hooks receive the same `ServerEventContext` — see the Plugin API page. Plugin objects only exist in dev/build processes; the production process runs the baked `app/_events.ts` handlers instead.",
      },
      { kind: "h2", text: "Component context (createContext)" },
      {
        kind: "p",
        text:
          "`createContext` is a component-scoped runtime API (from `@vesk/runtime/src/context.ts`), not a config or plugin feature. It is auto-imported from `@vesk/runtime` whenever a `.vsk` component uses it. `createContext(defaultValue)` returns a `Context<T>`: `get()` walks up the active-component chain returning the nearest value set by an ancestor (falling back to the default), and `set(value)` stores a value for the currently rendering component (it throws `No active component found, cannot set context` outside a render). `getActiveComponent()` / `setActiveComponent()` are the runtime's lower-level hooks for tracking the active component and are used by renderer internals.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "Statement mode",
            filename: "theme.vsk",
            code: `component Theme {
  const Theme = createContext('light')
  Theme.set('dark')
  <p>{Theme.get()}</p>
}`,
          },
          {
            label: "Expression mode",
            filename: "theme.vsk",
            code: `component Theme {
  const Theme = createContext('light')
  Theme.set('dark')
  return <p>{Theme.get()}</p>
}`,
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Component context (`createContext` / `Context`) is per-component-tree state and is unrelated to the server-wide `serverLocals` store above, and to the plugin `provides` injection mechanism.",
      },
    ],
  },
  {
    slug: "plugin-api",
    title: "Plugin API",
    description:
      "The VeskPlugin shape, definePlugin, every real hook, provides, registration and validation, and how @vesk/plugin-tailwind integrates.",
    group: "Tooling",
    blocks: [
      {
        kind: "p",
        text:
          "Vesk plugins extend the build pipeline and dev server. There is no Vite adapter — `vesk dev` / `vesk build` are the entry points, and plugins are plain objects registered in `vesk.config.ts`. The hook contract is defined by `VeskPlugin` in `@vesk/types`.",
      },
      { kind: "h2", text: "Plugin shape" },
      {
        kind: "list",
        items: [
          "`name: string` — required; used for activation state and the validation error message.",
          "`provides` — a record of values or factories injected into the per-request middleware context (see below).",
          "The hooks below — every one is optional, but a plugin with no recognized hook and no `provides` is rejected.",
        ],
      },
      { kind: "h2", text: "Registering plugins" },
      {
        kind: "code",
        filename: "vesk.config.ts",
        code: `import { defineConfig, definePlugin } from '@vesk/compiler'
import tailwindcss from '@vesk/plugin-tailwind'

export default defineConfig({
  plugins: [
    tailwindcss({ entry: 'src/global.css', appDir: 'app' }),
    definePlugin({
      name: 'my-plugin',
      onBuildEnd: async () => {
        console.log('build finished')
      },
    }),
  ],
})`,
      },
      { kind: "h2", text: "Hooks" },
      {
        kind: "table",
        head: ["Hook", "Signature", "When it runs"],
        rows: [
          ["onBuildStart", "() => void | Promise<void>", "Start of `vesk build` (also once at dev-server CSS pipeline boot)."],
          ["onBuildEnd", "() => void | Promise<void>", "End of `vesk build`."],
          ["onCSS", "(content: string, filePath: string) => string | null", "Transform CSS output in dev and build. Return `null` to keep the input unchanged."],
          ["onTransformJS", "(code: string, filePath: string) => string | null", "Transform an emitted client bundle or code-split chunk source."],
          ["onFileWatch", "(filePath: string) => { handled: boolean }", "A recognized hook where a plugin signals whether it claims a file-change event it manages itself."],
          ["onRequest", "(ctx: MiddlewareContext) => void | Promise<void>", "Every request passing through the middleware chain, after `provides` are injected."],
          ["onStart", "(ctx: ServerEventContext) => void | Promise<void>", "Once when a dev/start server boots (once per isolate on serverless/edge targets), before it begins listening."],
          ["onStop", "(ctx: ServerEventContext) => void | Promise<void>", "Graceful shutdown (SIGINT/SIGTERM) on Node dev/start servers; no-op on serverless/edge."],
          ["onHead", "(headHtml: string, ctx?: RenderPluginContext) => string | null", "Rewrite the assembled `<head>`; runs in config order on every rendered document."],
          ["onHtml", "(html: string, ctx?: RenderPluginContext) => string | null", "Rewrite the finalized full HTML document. Non-streamed documents only."],
        ],
      },
      { kind: "h2", text: "Hook contracts" },
      {
        kind: "list",
        items: [
          "`onCSS`, `onTransformJS`, `onHead`, `onHtml` return the new string to replace output, or `null` to leave it unchanged; a string return always replaces.",
          "`onHead` hooks chain in config order — a later hook sees the output of the earlier hooks. In dev and build/SSG the live hooks run; in production the build bakes the plugin head contribution into `headExtra` (merged into SSR functions and not-found/error pages, with the page head winning).",
          "`onHtml` runs only for non-streamed documents (SSG pre-render and buffered `renderFullPage`, including not-found/error). Streaming paths and the bake-for-prod path apply `onHead` only.",
          "`onStart` / `onStop` receive a `ServerEventContext` (same shape the app-level `app/_events.ts` handlers get — see the config page). Values `set()` in `onStart` land in the server-wide store and are pre-seeded into every request's `locals()`.",
          "`onRequest` receives a `MiddlewareContext` (per-request `locals`, `params`, `cookies`, `request`, `set`/`get`) and runs inside the middleware chain.",
          "Plugin objects exist only in dev/build processes — the production server runs baked assets, so prod-time behavior must be expressed through bake-time hooks (`onHead` → `headExtra`, `onBuildEnd`, static output).",
        ],
      },
      { kind: "h2", text: "Registration and validation" },
      {
        kind: "list",
        items: [
          "`definePlugin(plugin)` requires an object with a non-empty `name` string and throws otherwise.",
          "After config load the CLI runs `validateConfig`, which rejects a plugin with no `name` and any plugin whose only surface is unrecognized — it must implement at least one of `onCSS`, `onFileWatch`, `onTransformJS`, `onBuildStart`, `onBuildEnd`, `onRequest`, `onStart`, `onStop`, `onHead`, `onHtml`, or provide a non-empty `provides`.",
          "Config-declared plugins default to active. Activation can be overridden through the dev panel / `.vesk/plugins.json` state file; an inactive plugin is dropped from every build and dev pipeline, and an uninstalled plugin can never be active.",
        ],
      },
      { kind: "h2", text: "provides" },
      {
        kind: "p",
        text:
          "`provides` is a `Record<string, value-or-factory>`. When a request enters the middleware chain, each entry is resolved — a function is invoked (and awaited when async), any other value is used as-is — and written into the per-request context with `ctx.set(key, …)` before `onRequest` runs.",
      },
      {
        kind: "code",
        filename: "my-plugin.ts",
        code: `import { definePlugin } from '@vesk/compiler'

export default definePlugin({
  name: 'my-plugin',
  provides: {
    greeting: () => 'hello from the plugin',
  },
  onRequest: async (ctx) => {
    const g = ctx.get('greeting') ?? ''
    ctx.set('greetingLength', g.length)
  },
})`,
      },
      { kind: "h2", text: "@vesk/plugin-tailwind" },
      {
        kind: "p",
        text:
          "The Tailwind integration ships as a plugin factory imported by default export. `tailwindcss(options?)` accepts `{ entry?, appDir? }` with defaults `entry: 'src/global.css'` and `appDir: 'app'`, and returns a plugin named `@vesk/plugin-tailwind`.",
      },
      {
        kind: "list",
        items: [
          "`onCSS` fires only for the configured entry file — every other `filePath` passes through untouched.",
          "It extracts Tailwind v4 directives (`@import tailwindcss`, `@source`, `@theme`, `@layer base|components|utilities`, `@utility`) from the entry, compiles the remaining user CSS with Tailwind, and returns the compiled stylesheet.",
          "Class purging: it scans `.vsk`, `.js`, `.ts`, `.jsx`, `.tsx` files for `class=\"…\"` / `classname=\"…\"` attributes and feeds those class strings (length > 1, not `{…}` expressions) into the Tailwind candidate list.",
          "On a compile error it logs the failure and falls back to the non-directive user CSS.", 
          "Dev: the compiled CSS is rebuilt live and served at `/_vesk/static/global.css`; editing a `.vsk` or the entry CSS re-runs `onCSS` and hot-swaps the stylesheet.",
          "Build: the output is written to `.vesk/static/global.css`, which the rendered HTML links as `/_vesk/static/global.css`.",
          "`onBuildStart` resets its dependency set, and `onFileWatch` reports the dependency files it tracks — the plugin keeps a `dependencies` set fed by Tailwind's `onDependency` callbacks.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Because the export is the default, configure it with `import tailwindcss from '@vesk/plugin-tailwind'`. A bare CSS pipeline (no plugin) still copies `src/global.css` to `.vesk/static/global.css` — the plugin only decides whether that copy is Tailwind-compiled.",
      },
      {
        kind: "note",
        tone: "info",
        text:
          "For app-level lifecycle events (`app/_events.ts`, `ServerEventContext`, `serverLocals`) see the Configuration page's App events section — plugin `onStart`/`onStop` share that same context type.",
      },
    ],
  },
];