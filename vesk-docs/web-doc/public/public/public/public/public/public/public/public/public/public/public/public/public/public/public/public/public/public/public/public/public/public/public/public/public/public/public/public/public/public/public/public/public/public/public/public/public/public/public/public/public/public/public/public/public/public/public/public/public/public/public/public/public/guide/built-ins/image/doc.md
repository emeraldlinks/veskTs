# Image

Images are usually the heaviest thing on a page. `<Image>` takes care of
the busywork: it emits a responsive `srcset` so phones download small
files and desktops get sharp ones, applies sensible lazy-loading by
default, reserves space to avoid layout jumps, and pairs with a build-time
pipeline that generates width variants plus WebP/AVIF versions of your
assets (powered by the optional `sharp` dependency).

## Component

```vsk
import { Image } from '@vesk/runtime';

component Hero() {
	<Image src="/photos/hero.jpg" alt="Sunrise" width={1280} height={720} />
}
```

```ts
/**
 * Responsive <img> wrapped in a sized <span> (placeholder background when
 * placeholder is set and both dimensions given). Emits a srcset entry per
 * configured width: "<base>-<w>w<ext> <w>w".
 *
 * @example
 * <Image src="/a.jpg" alt="" priority widths={[640, 1024]} sizes="(max-width: 768px) 100vw, 50vw" />
 */
function Image(props: {
	src: string;                       // required
	alt?: string;                      // default ''
	width?: number | string;
	height?: number | string;
	priority?: boolean;                // default false — flips the trio below:
	loading?: 'lazy' | 'eager';        //   default lazy (eager with priority)
	decoding?: 'sync' | 'async';       //   default async (sync with priority)
	fetchpriority?: 'high' | 'low' | 'auto'; // default auto (high with priority)
	sizes?: string;                    // default '100vw'
	widths?: number[];                 // default [640, 768, 1024, 1280, 1536]
	placeholder?: string;              // CSS background value on the wrapper
	class?: string;
	style?: string;
	[k: string]: unknown;              // extra <img> attrs pass through
}): Node | string;
```

## Build-time pipeline

During `vesk build`, the adapter scans pages for `<Image src="…">`,
locates each source (searching `app/` → `public/` → `src/` → build static)
and writes variants to `.vesk/static/images/<base>-<w>w.<ext>`:

- Widths: **640, 768, 1024, 1280, 1536** — never larger than the original
  (`withoutEnlargement`)
- Formats: original + **webp** + **avif** at quality 80
- Supported inputs: jpg/jpeg/png/webp/avif/tiff

### sharp

The pipeline uses `sharp` as an **optionalDependency**. Without it,
originals are copied byte-for-byte under every width name and a warning
prints (`install sharp for resizing`). Install explicitly for real
resizing:

```sh
npm install sharp
```

> Note: dynamic `src={expr}` values can't be scanned at build time — use
> literal `src` strings for optimized variants and generate variants for
> those files manually if needed.
