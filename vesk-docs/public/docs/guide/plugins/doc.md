# Plugins

When the framework doesn't do something you need — a CSS post-processor,
an asset step, per-request tenant detection — plugins let you teach Vesk
new tricks. A plugin is a small object with named hooks that run at the
right moments of `vesk dev` and `vesk build`; no build-system expertise
required. There is deliberately no Vite adapter: plugins talk to the
pipeline directly.

## Shape

```ts
interface VeskPlugin {
	/** Required, non-empty. Conventionally namespaced: 'my-org/thing'. */
	name: string;

	/** Lazy or eager values exposed to the pipeline consumers. */
	provides?: Record<string, (() => unknown | Promise<unknown>) | unknown>;

	/** Per-request hook (dev + prod servers). */
	onRequest?(ctx: MiddlewareContext): void | Promise<void>;

	/** Transform CSS content. Return null/undefined to pass through. */
	onCSS?(content: string, filePath: string): string | null | Promise<string | null>;

	/**
	 * Claim a watched file change during dev.
	 * Return { handled: true } to mark the rebuild handled.
	 */
	onFileWatch?(filePath: string): { handled: boolean } | Promise<{ handled: boolean }>;

	/** Transform JS source before bundling (dev + build). */
	onTransformJS?(code: string, filePath: string): string | null | Promise<string | null>;

	onBuildStart?(): void | Promise<void>;
	onBuildEnd?(): void | Promise<void>;

	[k: string]: unknown;   // plugin-private state (e.g. dependency sets)
}
```

## Validation

`definePlugin()` validates at definition; `validateConfig()` re-checks at
load:

- `name` must be a non-empty string;
- the plugin must implement **at least one** recognized hook or provide a
  non-empty `provides` record — otherwise config loading throws with a
  pointer to this page.

## Lifecycle

```
defineConfig load
  └─ validateConfig(plugins)
vesk build                          vesk dev
  ├─ onBuildStart()                  ├─ watch app/ + public/
  ├─ compile pages/api/client        │    on change:
  │    └─ onTransformJS per file     │      onFileWatch(file) → handled?
  ├─ process CSS                     │      else default rebuild
  │    └─ onCSS per css file         ├─ onTransformJS / onCSS per file
  ├─ emit .vesk/                     ├─ per request → onRequest(ctx)
  └─ onBuildEnd()
```

## Registering

```ts
import { defineConfig, definePlugin } from '@vesk/compiler';

const banner = definePlugin({
	name: 'banner',
	onBuildStart() { console.log('build starting…'); },
	onBuildEnd() { console.log('done'); },
});

export default defineConfig({
	plugins: [banner],
});
```

### Request hook

```ts
import { definePlugin } from '@vesk/compiler';

export const tenant = () => definePlugin({
	name: 'tenant',
	onRequest(ctx) {
		const host = ctx.request.headers.get('host') ?? '';
		ctx.set('tenant', host.split('.')[0]);
	},
});
// pages/APIs read it via locals().tenant
```

## Official plugin: Tailwind v4

```ts
import tailwindcss from '@vesk/plugin-tailwind';

export default defineConfig({
	plugins: [tailwindcss({ entry: 'src/global.css', appDir: 'app' })],
});
```

Internals worth knowing as a plugin author:

- **onBuildStart** resets its dependency set.
- **onCSS** processes only the configured entry file (others pass
  through): splits Tailwind directives (`@import 'tailwindcss'`, `@source`,
  `@theme`, `@layer`, `@utility`) from user CSS via brace-counting that
  skips strings/comments, compiles through `@tailwindcss/node`, scans
  class candidates from `.vsk/.js/.ts/.jsx/.tsx` sources (skipping
  node_modules/dist/build output), returns final CSS.
- **onFileWatch** claims changes to any file in its dependency set so CSS
  rebuilds trigger without full reloads.
- Dynamic class bindings (`class={expr}`) are not scanned — keep static
  occurrences of conditionally used classes somewhere in source.

Dev serves `_tailwind.css`; production writes
`.vesk/static/_tailwind.css`.

## Writing your own transformer

Hook return conventions:

| Hook | Return |
| --- | --- |
| `onCSS`, `onTransformJS` | transformed string, or null/undefined to pass through unchanged |
| `onFileWatch` | `{ handled: boolean }` |
| `onRequest` | nothing (mutate ctx; throw `redirect()`/`notFound()` to short-circuit) |

```ts
import { definePlugin } from '@vesk/compiler';
import postcss from 'postcss';

export const autoprefix = () => definePlugin({
	name: 'autoprefix',
	async onCSS(css, filePath) {
		if (!filePath.endsWith('.css')) return null;
		return (await postcss([autoprefixer]).process(css, { from: filePath })).css;
	},
});
```

Keep transforms deterministic and fast — they run per file per rebuild.
