# @vesk/plugin-pwa

Progressive Web App plugin for Vesk — generates a `manifest.webmanifest`, a
service worker, and CSP-safe PWA head tags with zero image dependencies.

## Install

```bash
npm install @vesk/plugin-pwa
```

## Usage

```ts
import { defineConfig } from '@vesk/compiler'
import pwaPlugin from '@vesk/plugin-pwa'

export default defineConfig({
  plugins: [pwaPlugin({ name: 'My App', shortName: 'MyApp', themeColor: '#4f46e5' })],
})
```

## What it does

- **Manifest** — writes `manifest.webmanifest` plus real `icon-192.png` /
  `icon-512.png` (inline-generated, no asset pipeline needed) into your
  `publicDir`, satisfying Chrome's installability audit.
- **Service worker** — writes `sw.js` (precache of the app shell) and an
  external `pwa-init.js` that registers it. Default strategy is
  stale-while-revalidate; `cache-first` and `network-first` are available.
- **Head injection** — via the `onHead` hook, injects the manifest link,
  `theme-color`, apple meta tags, and the SW-registration script. Everything
  is a static file URL — no inline scripts, so CSP remains strict.
- `{#client}` islands and `on*` handlers keep working unchanged.

## Options

`name`, `shortName`, `description`, `scope`, `lang`, `display`, `orientation`,
`themeColor`, `backgroundColor`, `icons`, `publicDir`, `noServiceWorker`,
`swStrategy`. See the `PwaOptions` type for details.

## License

MIT