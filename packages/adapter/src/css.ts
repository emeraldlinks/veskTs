/**
 * Shared stylesheet resolution for the adapter build, prod server, generated
 * SSR functions, dev server, and action handler. Each environment feeds its
 * facts (`tailwind` output available, user stylesheet present) into
 * `resolveCssUrls`, so the `/_vesk/static/*.css` link list and its ordering
 * come from one place instead of six ad-hoc copies.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cssBlockEnd } from '@vesk/compiler/src/scan';

export const TAILWIND_CSS_URL = '/_vesk/static/_tailwind.css';
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

/** True when a non-empty `_tailwind.css` was produced for the build (prod disk output). */
export function hasBuiltTailwindCss(outDir: string): boolean {
  const p = resolve(outDir, 'static', '_tailwind.css');
  return existsSync(p) && readFileSync(p, 'utf-8').trim().length > 0;
}

/** True when the active plugin pipeline includes the tailwind plugin. */
export function isTailwindPlugin(plugins: Array<{ name?: string }> | undefined | null): boolean {
  return (plugins || []).some((p) => String(p && p.name).toLowerCase().includes('tailwind'));
}

/**
 * Single source of truth for the `/_vesk/static/*.css` link list. Callers
 * supply environment facts — `tailwind`: tailwind output is available
 * (built-file present + non-empty in prod, active plugin in dev);
 * `userCss`: a user stylesheet exists — so build, request, dev, and prod
 * paths share one ordering.
 */
export function resolveCssUrls(opts: { tailwind?: boolean; userCss?: boolean }): string[] {
  const urls: string[] = [];
  if (opts.tailwind) urls.push(TAILWIND_CSS_URL);
  if (opts.userCss) urls.push(GLOBAL_CSS_URL);
  return urls;
}

/** Drop tailwind framework directives from user CSS, keeping hand-written rules. */
export function stripTailwindDirectives(css: string): string {
  const blockStart = /^\s*@(theme\s*\{|layer\s+(components|utilities)\s*\{|utility\s+[\w-]+\s*\{)/;
  let result = css.replace(/^\s*@import\s+['"]tailwindcss['"]\s*;?\s*$/gm, '');
  result = result.replace(/^\s*@source\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  const output: string[] = [];
  let pos = 0;
  while (pos < result.length) {
    const lineEnd = result.indexOf('\n', pos) === -1 ? result.length : result.indexOf('\n', pos) + 1;
    const line = result.slice(pos, lineEnd);
    if (blockStart.test(line.trim())) {
      const end = cssBlockEnd(result, pos);
      pos = end;
      continue;
    }
    output.push(line);
    pos = lineEnd;
  }
  return output.join('').trim();
}