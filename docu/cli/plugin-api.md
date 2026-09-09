# Plugin API

Vesk plugins extend the build pipeline and dev server. There is no Vite
adapter — `vesk dev` / `vesk build` are the entry points, and plugins hook
into those pipelines directly.

## Plugin shape

`VeskPlugin` (`@vesk/types`, re-exported by `packages/compiler/src/types.ts`):

```ts
interface VeskPlugin {
  name: string;
  provides?: Record<string, (() => unknown | Promise<unknown>) | unknown>;
  onStart?: (ctx: ServerEventContext) => void | Promise<void>;
  onRequest?: (ctx: MiddlewareContext) => void | Promise<void>;
  onCSS?: (content: string, filePath: string) => string | null | Promise<string | null>;
  onFileWatch?: (filePath: string) => { handled: boolean } | Promise<{ handled: boolean }>;
  onTransformJS?: (code: string, filePath: string) => string | null | Promise<string | null>;
  onStop?: (ctx: ServerEventContext) => void | Promise<void>;
  onBuildStart?: () => void | Promise<void>;
  onBuildEnd?: () => void | Promise<void>;
  onHead?: (headHtml: string, ctx?: RenderPluginContext) => string | null | Promise<string | null>;
  onHtml?: (html: string, ctx?: RenderPluginContext) => string | null | Promise<string | null>;
  [key: string]: unknown;
}
```

- `name` is required and must be a string.
- At least one hook or a non-empty `provides` is required — a plugin that
  implements none of the recognized hooks "will never be called" and is
  rejected by `validateConfig`.
- `onStart(ctx)` / `onStop(ctx)` receive a `ServerEventContext`
  (`@vesk/types`) — the same context as `app/_events.ts`. `ctx.set`/`ctx.get`
  write the process-wide server store; `onStart` runs at boot (once, before
  the server listens — lazily per isolate on edge, where `ctx.server` is
  `null`), `onStop` on graceful shutdown/dev reload. See
  `/docu/cli/commands.md` → "Server events".
- Hook contract details: `/docu/cli/plugin-api.md` (this page) is the
  canonical reference named by the compiler's error message.

## Registering plugins

```js
// vesk.config.js
import { defineConfig, definePlugin } from '@vesk/compiler';
import { tailwindcss } from '@vesk/plugin-tailwind';

export default defineConfig({
  plugins: [
    tailwindcss({ entry: './src/app.css' }),
    definePlugin({
      name: 'my-plugin',
      onBuildEnd: async () => console.log('build done'),
    }),
  ],
});
```

- `config.plugins` must be an array; each entry must be an object with a
  `name` string.
- `definePlugin(plugin)` validates the object shape at definition time.

## Tailwind integration

`@vesk/plugin-tailwind`:

- Scans `.vsk`/`.js`/`.ts`/`.jsx`/`.tsx` files for `class="..."`
  attributes to build a purge content list, then runs the Tailwind CLI to
  generate the final CSS.
- Compiles the single `src/global.css` entry (directives + user rules) into
  one `static/global.css` — served as a single stylesheet like other frameworks.
- Integrates with HMR rebuilds.

## Verified against

- `packages/compiler/src/types.ts` — `VeskPlugin` interface
- `packages/compiler/src/config.ts` — `definePlugin`, `validateConfig`
  plugin checks
- `packages/types/src/index.ts` — `ServerEventContext`
- `packages/plugin-tailwind/src/index.ts` — plugin behavior
- Commit `2a5b19d`