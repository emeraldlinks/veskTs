/**
 * Branded built-in fallback pages.
 *
 * These are the pages a Vesk app gets when it has NOT defined its own
 * `app/not-found.vsk` / `app/error.vsk` (or when rendering one throws). They
 * deliberately mirror the shape of Next.js' built-in 404/500 page — a large
 * status code, a hairline divider, the message — but carry the Vesk design
 * language (light-default monochrome that follows `prefers-color-scheme`, a
 * single rust accent, sharp corners, Space Grotesk / JetBrains Mono with system
 * fallbacks) instead of the generic `<h1>404</h1>` that shipped before.
 *
 * The module is intentionally dependency-free and side-effect-free: the HTML
 * is a plain string, so it can be served by the Node prod server, the dev
 * server, the generated platform (edge) handler, and inlined into generated
 * error bodies — all from this one source of truth.
 *
 * Fonts are NOT fetched here: a fallback page must render instantly and
 * without network access, so the stacks degrade to system fonts gracefully.
 */

export interface DefaultPageOptions {
	/** HTTP status shown and set by the caller (404 / 500). */
	status?: number;
	/** Document `<title>`. */
	title?: string;
	/** Short label rendered next to the big status code. */
	message?: string;
	/** The requested path, shown as a muted detail line when present. */
	url?: string;
	/** Primary action target. Pass `null` to omit the button. */
	homeHref?: string | null;
	/** Primary action label. */
	homeLabel?: string;
	/** Extra markup for `<head>` (baked onHead-plugin snippets). */
	headExtra?: string;
	/** Paint the status code in the rust accent (used for 5xx). */
	accentStatus?: boolean;
}

export function escapeDefaultPageHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Theme tokens lifted from the vesk-doc `app/global.css` design system. Light is
 * the default (matching the general web default); `prefers-color-scheme: dark`
 * swaps to the inverted band so the page follows the visitor's theme. Kept
 * inline so the page is fully self-contained.
 */
const DEFAULT_PAGE_CSS = [
	':root{color-scheme:light;',
	'--vsk-bg:oklch(0.941 0.014 88);',
	'--vsk-fg:oklch(0.185 0.008 62);',
	'--vsk-surface:oklch(0.965 0.012 88);',
	'--vsk-muted:oklch(0.475 0.014 72);',
	'--vsk-accent:oklch(0.560 0.140 42);',
	'--vsk-border:oklch(0.86 0.012 82);',
	'--vsk-border-strong:oklch(0.72 0.014 80);',
	'--vsk-font:"Space Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
	'--vsk-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}',
	'@media (prefers-color-scheme:dark){:root{color-scheme:dark;',
	'--vsk-bg:oklch(0.155 0.006 60);',
	'--vsk-fg:oklch(0.931 0.014 88);',
	'--vsk-surface:oklch(0.196 0.008 70);',
	'--vsk-muted:oklch(0.618 0.016 80);',
	'--vsk-accent:oklch(0.632 0.132 45);',
	'--vsk-border:oklch(0.29 0.009 75);',
	'--vsk-border-strong:oklch(0.40 0.011 75);}}',
	'*{box-sizing:border-box}',
	'html,body{margin:0;min-height:100%}',
	'body{background:var(--vsk-bg);color:var(--vsk-fg);font-family:var(--vsk-font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}',
	'.vsk-page{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}',
	'.vsk-page__card{width:100%;max-width:540px;border:1px solid var(--vsk-border);background:var(--vsk-surface);padding:clamp(28px,6vw,44px);text-align:center}',
	'@supports (background:color-mix(in oklab,red,red)){.vsk-page__card{background:color-mix(in oklab,var(--vsk-surface) 60%,transparent)}}',
	'.vsk-page__brand{margin:0 0 26px;font-family:var(--vsk-mono);font-size:10px;line-height:1;letter-spacing:.24em;text-transform:uppercase;color:var(--vsk-muted)}',
	'.vsk-page__brand b{color:var(--vsk-fg);font-weight:600}',
	'.vsk-page__row{display:flex;align-items:center;justify-content:center;gap:0;flex-wrap:wrap}',
	'.vsk-page__status{font-size:clamp(34px,9vw,46px);font-weight:600;line-height:1;letter-spacing:-.03em;padding-right:22px;margin-right:22px;border-right:1px solid var(--vsk-border-strong)}',
	'.vsk-page--error .vsk-page__status{color:var(--vsk-accent)}',
	'.vsk-page__msg{font-family:var(--vsk-mono);font-size:13px;line-height:1.5;color:var(--vsk-muted);text-align:left;max-width:270px}',
	'@media (max-width:440px){.vsk-page__row{flex-direction:column}.vsk-page__status{padding:0 0 16px;margin:0 0 16px;border-right:0;border-bottom:1px solid var(--vsk-border-strong)}.vsk-page__msg{text-align:center}}',
	'.vsk-page__detail{margin:20px 0 0;font-family:var(--vsk-mono);font-size:11px;line-height:1.6;color:var(--vsk-muted);word-break:break-all}',
	'.vsk-page__actions{margin-top:30px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap}',
	'.vsk-page__btn{display:inline-block;padding:11px 22px;font-size:13px;font-weight:500;line-height:1;text-decoration:none;border:1px solid var(--vsk-fg);background:var(--vsk-fg);color:var(--vsk-bg);transition:opacity .18s cubic-bezier(.2,0,0,1)}',
	'.vsk-page__btn:hover{opacity:.86}',
	'.vsk-page__btn--ghost{background:transparent;color:var(--vsk-fg);border-color:var(--vsk-border-strong)}',
	'.vsk-page__btn--ghost:hover{background:var(--vsk-fg);color:var(--vsk-bg);border-color:var(--vsk-fg);opacity:1}',
].join('');

/**
 * Render a complete, self-contained HTML document for a built-in fallback page.
 */
export function renderDefaultPage(opts: DefaultPageOptions = {}): string {
	const status = opts.status ?? 404;
	const title = escapeDefaultPageHtml(opts.title ?? `${status} — Vesk`);
	const message = escapeDefaultPageHtml(opts.message ?? 'This page could not be found.');
	const url = opts.url ? escapeDefaultPageHtml(opts.url) : '';
	const headExtra = opts.headExtra || '';
	const homeHref = opts.homeHref === undefined ? '/' : opts.homeHref;
	const homeLabel = escapeDefaultPageHtml(opts.homeLabel ?? 'Back to home');
	const variant = `vsk-page${opts.accentStatus ? ' vsk-page--error' : ''}`;

	const action = homeHref === null
		? ''
		: `<a class="vsk-page__btn" href="${escapeDefaultPageHtml(homeHref)}">${homeLabel}</a>`;

	return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
		'<meta name="viewport" content="width=device-width, initial-scale=1">' +
		'<meta name="robots" content="noindex">' +
		`<title>${title}</title>` +
		`<style>${DEFAULT_PAGE_CSS}</style>` +
		headExtra +
		'</head><body>' +
		`<main class="${variant}" data-vesk-default-page="${status}">` +
		'<div class="vsk-page__card">' +
		'<p class="vsk-page__brand"><b>Vesk</b> · built-in error page</p>' +
		'<div class="vsk-page__row">' +
		`<span class="vsk-page__status">${status}</span>` +
		`<span class="vsk-page__msg">${message}</span>` +
		'</div>' +
		(url ? `<p class="vsk-page__detail">${url}</p>` : '') +
		(action ? `<div class="vsk-page__actions">${action}</div>` : '') +
		'</div></main>' +
		'</body></html>';
}

/** The built-in 404: matches Next.js' "This page could not be found." shape. */
export function renderDefaultNotFoundPage(opts: { url?: string; headExtra?: string } = {}): string {
	return renderDefaultPage({
		status: 404,
		title: '404 — Not Found',
		message: 'This page could not be found.',
		url: opts.url,
		headExtra: opts.headExtra,
	});
}

/** The built-in 500: never leaks a stack trace; message is opt-in (dev). */
export function renderDefaultErrorPage(opts: { status?: number; message?: string; url?: string; headExtra?: string } = {}): string {
	const status = opts.status ?? 500;
	return renderDefaultPage({
		status,
		title: `${status} — Internal Server Error`,
		message: opts.message || 'Internal Server Error',
		url: opts.url,
		headExtra: opts.headExtra,
		accentStatus: true,
		homeHref: null,
	});
}

/**
 * Compact, self-contained error panel for contexts where a full document is
 * wrong — chiefly the generated `__renderErrorBody` fallback, which is injected
 * as the page body *inside* the app's layout chain when `error.vsk` exists but
 * throws mid-render. Inline styles only (no external class dependency) so it
 * survives inside any user layout.
 */
export function renderDefaultErrorFragment(opts: { status?: number; message?: string } = {}): string {
	const status = opts.status ?? 500;
	const message = escapeDefaultPageHtml(opts.message || 'Internal Server Error');
	return '<div data-vesk-default-error-fragment="' + status + '" style="display:flex;align-items:center;justify-content:center;min-height:60vh;padding:32px">' +
		'<div style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">' +
		'<div style="display:flex;align-items:center">' +
		'<span style="font-size:24px;font-weight:500;line-height:49px;padding-right:23px;margin-right:20px;border-right:1px solid currentColor;opacity:.85">' + status + '</span>' +
		'<span style="font-size:14px;line-height:49px;opacity:.7">' + message + '</span>' +
		'</div></div></div>';
}
