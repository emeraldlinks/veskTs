/**
 * Shared stylesheet resolution for the adapter build, prod server, generated
 * SSR functions, dev server, and action handler. Each environment feeds its
 * facts (`enabled`: a built global stylesheet exists) into `resolveCssUrls`,
 * so the `/_vesk/static/global.css` link list comes from one place instead of
 * several ad-hoc copies.
 *
 * Vesk follows the single-file CSS convention used by other frameworks
 * (Next.js/Remix/SvelteKit): a single `src/global.css` is the stylesheet
 * source. When the Tailwind plugin is active the whole file is compiled into
 * one `/_vesk/static/global.css`; otherwise the user CSS is served as-is from
 * the same URL. There is no separate `_tailwind.css` anymore — user rules and
 * the compiled Tailwind output live in the same file, in one `<link>`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const GLOBAL_CSS_URL = '/_vesk/static/global.css';

/** Resolve the project's user stylesheet source (`src/global.css`, then `src/app.css`). */
export function resolveUserCssPath(appDir: string): string | null {
  const cssSrc = resolve(appDir, '..', 'src', 'global.css');
  if (existsSync(cssSrc)) return cssSrc;
  const altCssSrc = resolve(appDir, '..', 'src', 'app.css');
  if (existsSync(altCssSrc)) return altCssSrc;
  return null;
}

/** True when the project has a user stylesheet source (`src/global.css` or `src/app.css`). */
export function hasUserCss(appDir: string): boolean {
  return resolveUserCssPath(appDir) !== null;
}

/** True when a non-empty `global.css` was produced for the build (prod disk output). */
export function hasBuiltGlobalCss(outDir: string): boolean {
  const p = resolve(outDir, 'static', 'global.css');
  return existsSync(p) && readFileSync(p, 'utf-8').trim().length > 0;
}

/** True when the active plugin pipeline includes the tailwind plugin. */
export function isTailwindPlugin(plugins: Array<{ name?: string }> | undefined | null): boolean {
  return (plugins || []).some((p) => String(p && p.name).toLowerCase().includes('tailwind'));
}

/**
 * Single source of truth for the `/_vesk/static/*.css` link list. Callers
 * supply environment facts — `enabled`: a global stylesheet output is
 * available (built-file present + non-empty in prod, user stylesheet present
 * in dev) — so build, request, dev, and prod paths share one ordering.
 */
export function resolveCssUrls(opts: { enabled?: boolean }): string[] {
  if (opts.enabled) return [GLOBAL_CSS_URL];
  return [];
}
