/**
 * A typed metadata API, for the same reason `<Head>` interpolation is a trap.
 *
 * Both bugs I hit writing the head pass were "silent and wrong": an expression
 * the build-time evaluator could not resolve became an empty string, and an
 * already-escaped string became double-escaped in the tab. Metadata goes
 * through a *shape* instead — one place that knows what a title, a description
 * and an OG tag look like, what is required, and how a layout's metadata
 * merges with a page's.
 *
 * The static form is the interesting one:
 *
 *   export const metadata = defineMetadata({ title: 'Pricing', description: '…' })
 *
 * which the compiler extracts at BUILD time, so the head never depends on the
 * component's frame evaluating correctly. `metadataToHtml` is the single
 * serializer both the build and the runtime use, so a title cannot be escaped
 * twice or not at all.
 */

/** `title` is either a literal, or a default plus a template for children. */
export type MetadataTitle =
  | string
  | { default?: string; template?: string; absolute?: string };

export interface OpenGraphMetadata {
  title?: string;
  description?: string;
  url?: string;
  siteName?: string;
  image?: string;
  type?: string;
  [key: string]: unknown;
}

export interface VeskMetadata {
  title?: MetadataTitle;
  description?: string;
  /** `noindex`/`nofollow` etc. */
  robots?: string | Record<string, boolean>;
  openGraph?: OpenGraphMetadata;
  twitter?: OpenGraphMetadata & { card?: string; site?: string };
  /** `hreflang` alternates: `{ 'en': '/en/pricing', 'de': '/de/pricing' }`. */
  alternates?: Record<string, string> | { canonical?: string; languages?: Record<string, string> };
  themeColor?: string;
  [key: string]: unknown;
}

const KNOWN_KEYS = new Set([
  'title', 'description', 'robots', 'openGraph', 'twitter', 'alternates', 'themeColor',
]);

function assertPlainObject(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`defineMetadata: ${where} must be a plain object, got ${Array.isArray(value) ? 'an array' : typeof value}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Declare a route's metadata.
 *
 * Identity at runtime (so it costs nothing), validated at module load. The
 * validation is deliberately loud and early: metadata is the part of a page
 * nobody looks at until it is wrong in a search result, and a typo in a
 * required field should fail the build, not the crawler.
 */
export function defineMetadata(input: VeskMetadata): VeskMetadata {
  const meta = assertPlainObject(input, 'the argument') as VeskMetadata;

  if ('title' in meta && meta.title !== undefined) {
    if (typeof meta.title !== 'string' && typeof meta.title !== 'object') {
      throw new Error('defineMetadata: `title` must be a string or { default, template }');
    }
    if (typeof meta.title === 'object') {
      const t = assertPlainObject(meta.title, '`title`');
      for (const key of Object.keys(t)) {
        if (key !== 'default' && key !== 'template' && key !== 'absolute') {
          throw new Error(`defineMetadata: unknown \`title.${key}\` (expected default, template or absolute)`);
        }
      }
    }
  }
  if ('description' in meta && meta.description !== undefined && typeof meta.description !== 'string') {
    throw new Error('defineMetadata: `description` must be a string');
  }
  for (const key of ['openGraph', 'twitter'] as const) {
    if (key in meta && meta[key] !== undefined) assertPlainObject(meta[key] as unknown, `\`${key}\``);
  }
  if ('alternates' in meta && meta.alternates !== undefined) {
    const alt = assertPlainObject(meta.alternates as unknown, '`alternates`');
    for (const key of Object.keys(alt)) {
      if (key !== 'canonical' && key !== 'languages') {
        throw new Error(`defineMetadata: unknown \`alternates.${key}\` (expected canonical or languages)`);
      }
    }
  }
  // Unknown top-level keys are almost always a typo (`descripton`, `ogTitle`),
  // and they fail silently everywhere downstream — so name them here.
  for (const key of Object.keys(meta)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(
        `defineMetadata: unknown key "${key}". Known keys: ${[...KNOWN_KEYS].join(', ')}. ` +
        '(`openGraph` carries og:* tags, not top-level `ogTitle`.)',
      );
    }
  }
  return meta;
}

/** The document title a metadata object asks for, with template resolution. */
export function resolveTitle(meta: VeskMetadata | null | undefined, child?: VeskMetadata | null): string | null {
  if (!meta || meta.title === undefined || meta.title === null) return null;
  if (typeof meta.title === 'string') return meta.title;
  if (meta.title.absolute) return meta.title.absolute;
  if (meta.title.default) return meta.title.default;
  // A `{ template }`-only parent takes the child's title.
  if (meta.title.template && child) {
    const childTitle = resolveTitle(child);
    return childTitle === null ? null : meta.title.template.replace('%s', childTitle);
  }
  return null;
}

/**
 * Merge metadata from the outside in: a layout, then a page, then a nested
 * route. Later sources win per field, and the two nested groups (`openGraph`,
 * `twitter`) merge field-wise so a page can set one OG key without restating
 * the rest. Title template resolution happens on the way out.
 */
export function mergeMetadata(...sources: Array<VeskMetadata | null | undefined>): VeskMetadata {
  const out: VeskMetadata = {};
  let template: string | undefined;
  let sawTemplate = false;
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      if (key === 'openGraph' || key === 'twitter') {
        out[key] = { ...((out[key] as Record<string, unknown>) || {}), ...(value as Record<string, unknown>) };
        continue;
      }
      if (key === 'title') {
        // A parent's `{ template }` is kept so a child's title can be wrapped,
        // but the child's own title wins for the document.
        if (value && typeof value === 'object' && (value as { template?: string }).template) {
          sawTemplate = true;
          template = (value as { template?: string }).template || template;
        }
        out.title = value as MetadataTitle;
        continue;
      }
      out[key] = value;
    }
  }
  if (sawTemplate && out.title !== undefined) {
    const own = out.title;
    if (typeof own === 'string') out.title = { absolute: own };
    else if (own && typeof own === 'object' && (own as { template?: string }).template) {
      out.title = { default: (own as { default?: string }).default, template: (own as { template?: string }).template || template };
    } else if (own && typeof own === 'object') {
      out.title = { ...(own as Record<string, unknown>), template: template } as MetadataTitle;
    }
  }
  return out;
}

function escapeAttr(value: unknown): string {
  return String(value)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

function escapeText(value: unknown): string {
  return String(value).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}

/**
 * Serialize metadata to head tags.
 *
 * The ONE serializer, used by the build-time path and the runtime path, so a
 * title cannot be escaped twice (the bug where `&amp;` reached the tab) or not
 * at all. Text and attributes are escaped separately because they have
 * different rules — escaping a `content` attribute as text is how you get
 * `&amp;amp;` in a meta description.
 */
export function metadataToHtml(meta: VeskMetadata | null | undefined, opts: { child?: VeskMetadata | null } = {}): string {
  if (!meta) return '';
  const lines: string[] = [];
  const title = resolveTitle(meta, opts.child);
  if (title !== null) lines.push(`<title data-vesk-head>${escapeText(title)}</title>`);
  if (typeof meta.description === 'string' && meta.description.length > 0) {
    lines.push(`<meta name="description" content="${escapeAttr(meta.description)}" data-vesk-head />`);
  }
  if (meta.robots) {
    const content = typeof meta.robots === 'string'
      ? meta.robots
      : Object.entries(meta.robots).filter(([, on]) => on).map(([k]) => k).join(', ');
    if (content) lines.push(`<meta name="robots" content="${escapeAttr(content)}" data-vesk-head />`);
  }
  if (meta.themeColor) {
    lines.push(`<meta name="theme-color" content="${escapeAttr(meta.themeColor)}" data-vesk-head />`);
  }
  const og = meta.openGraph;
  if (og) {
    const ogTitle = resolveTitle(og as VeskMetadata) ?? title;
    const ogFields: Array<[string, unknown]> = [
      ['og:title', ogTitle],
      ['og:description', og.description ?? meta.description],
      ['og:url', og.url],
      ['og:site_name', og.siteName],
      ['og:image', og.image],
      ['og:type', og.type],
    ];
    for (const [prop, value] of ogFields) {
      if (value === undefined || value === null || value === '') continue;
      lines.push(`<meta property="${prop}" content="${escapeAttr(value)}" data-vesk-head />`);
    }
  }
  const tw = meta.twitter;
  if (tw) {
    const twFields: Array<[string, unknown]> = [
      ['twitter:card', tw.card],
      ['twitter:site', tw.site],
      ['twitter:title', resolveTitle(tw as VeskMetadata) ?? title],
      ['twitter:description', tw.description ?? meta.description],
      ['twitter:image', tw.image],
    ];
    for (const [name, value] of twFields) {
      if (value === undefined || value === null || value === '') continue;
      lines.push(`<meta name="${name}" content="${escapeAttr(value)}" data-vesk-head />`);
    }
  }
  const alt = meta.alternates;
  if (alt) {
    if (typeof alt === 'object' && typeof alt.canonical === 'string') {
      lines.push(`<link rel="canonical" href="${escapeAttr(alt.canonical)}" data-vesk-head />`);
    }
    const languages = (alt as { languages?: Record<string, string> }).languages;
    if (languages && typeof languages === 'object') {
      for (const [lang, href] of Object.entries(languages)) {
        lines.push(`<link rel="alternate" hreflang="${escapeAttr(lang)}" href="${escapeAttr(href)}" data-vesk-head />`);
      }
    }
  }
  return lines.join('\n');
}
