# Plugin API

Vesk plugins extend the build pipeline and dev server. There is no Vite
adapter — `vesk dev` / `vesk build` are the entry points, and plugins hook
into those pipelines directly.

## Plugin shape

`VeskPlugin` (`packages/compiler/src/types.ts`):

```ts
interface VeskPlugin {
  name: string;
  provides?: Record<string, (() => unknown | Promise<unknown>) | unknown>;
  onRequest?: (ctx: MiddlewareContext) => void | Promise<void>;
  onCSS?: (content: string, filePath: string) => string | null | Promise<string | null>;
  onFileWatch?: (filePath: string) => { handled: boolean } | Promise<{ handled: boolean }>;
  onTransformJS?: (code: string, filePath: string) => string | null | Promise<string | null>;
  onBuildStart?: () => void | Promise<void>;
  onBuildEnd?: () => void | Promise<void>;
}
```

- `name` is required and must be a string.
- At least one hook or a non-empty `provides` is required — a plugin that
  implements none of the recognized hooks "will never be called" and is
  rejected by `validateConfig`.
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
- Handles the dev path (`src/global.css` / `src/app.css` with Tailwind
  directives stripped for dev CSS) and production `_tailwind.css` output.
- Integrates with HMR rebuilds.

## Verified against

- `packages/compiler/src/types.ts` — `VeskPlugin` interface
- `packages/compiler/src/config.ts` — `definePlugin`, `validateConfig`
  plugin checks
- `packages/plugin-tailwind/src/index.ts` — plugin behavior
- Commit `2a5b19d`