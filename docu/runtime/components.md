# Built-in Components

Vesk ships several built-in components, all auto-imported from
`@vesk/runtime`.

## Image

Responsive image with automatic srcset generation and lazy loading.

```vsk
<Image
  src="/hero.jpg"
  alt="Hero image"
  width={1200}
  height={600}
  priority
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | — | Image source URL |
| `alt` | `string` | — | Alt text |
| `width` | `number` | — | Intrinsic width |
| `height` | `number` | — | Intrinsic height |
| `priority` | `boolean` | `false` | Preload (disable lazy loading) |
| `loading` | `'lazy' \| 'eager'` | `'lazy'` | Loading strategy |
| `sizes` | `string` | — | Sizes attribute for srcset |
| `widths` | `number[]` | — | Custom srcset widths |
| `placeholder` | `string` | — | Low-quality placeholder |

SSR renders a `<span>` wrapper with `<img>`. Client creates real DOM
elements. `priority` images get `<link rel="preload">` in `<head>`.

## Portal

Teleports children to a different DOM node.

```vsk
<Portal target="#modal-root">
  <div class="modal">Hello from portal</div>
</Portal>
```

SSR returns empty string. Client-only.

| Prop | Type | Description |
|------|------|-------------|
| `target` | `string \| HTMLElement` | CSS selector or DOM element |
| `children` | content | Content to teleport |

## Experiment

A/B/n testing with sticky assignment.

```vsk
<Experiment name="hero-variant" variants={[
  { name: 'control', weight: 50, content: <OriginalHero /> },
  { name: 'challenger', weight: 50, content: <NewHero /> },
]} />
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Experiment name (unique identifier) |
| `variants` | `Variant[]` | Array of variant objects |
| `sticky` | `boolean` | Use cookie-based sticky assignment (default `true`) |
| `track` | `boolean` | Track assignments to `window.__vsk_experiments` |

### Variant

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Variant identifier |
| `weight` | `number` | Selection weight (relative) |
| `children` / `content` | content | What to render |

## LoadingIndicator

Nuxt-style page navigation progress bar.

```vsk
<LoadingIndicator color="#ff6600" height={3} />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `color` | `string` | gradient | Progress bar color |
| `errorColor` | `string` | red | Error state color |
| `height` | `number` | `3` | Bar height in pixels |
| `position` | `string` | `'fixed'` | CSS position |
| `zIndex` | `number` | `9999` | CSS z-index |

### Programmatic control

```vsk
component PageLoader() {
  const indicator = useLoadingIndicator();

  return (
    <button onClick={() => {
      indicator.start();
      setTimeout(() => indicator.finish(), 2000);
    }}>
      Simulate loading
    </button>
  );
}
```

### Configure globally

```ts
import { configureLoadingIndicator } from '@vesk/runtime';

configureLoadingIndicator({
  duration: 5000,
  throttle: 200,
  hideDelay: 500,
});
```

## Verified against

- `packages/runtime/src/image.ts` — `Image`
- `packages/runtime/src/portal.ts` — `Portal`
- `packages/runtime/src/experiment.ts` — `Experiment`
- `packages/runtime/src/loading-indicator.ts` — `LoadingIndicator`,
  `useLoadingIndicator`, `configureLoadingIndicator`
- `packages/runtime/src/index-client.ts` — component exports
