/**
 * Vesk dev HMR client — modular dev panel + error overlay.
 *
 * Served standalone at `/_vesk/hmr.js` (module) after `stripCodeTypes` — fully
 * self-contained, NO runtime imports. Top-level `export`s are preserved by the
 * reprint; the bottom-of-file `createDevClient()` call boots the client when a
 * real DOM is present. Pure render/html helpers live at module top so they can
 * be unit-tested DOM-free.
 *
 * Terminal aesthetic: black-and-white, sharp 1px borders, `border-radius: 0`,
 * no blur / backdrop / glass shadows, uppercase labels, `>` cursors, monospace.
 */

export interface HmrCodeLine {
	no: number;
	text: string;
	isError: boolean;
}

export interface HmrCodeframe {
	file: string;
	line: number;
	column: number;
	context: number;
	code: HmrCodeLine[];
}

export interface HmrErrorPayload {
	file: string;
	filePath?: string;
	line: number | null;
	column: number | null;
	message: string;
	codeframe?: HmrCodeframe;
	tips?: string[];
	suggestions?: string[];
	nextSteps?: string[];
	stack?: string;
}

export interface DevClientOptions {
	wsUrl?: string;
	stateUrl?: string;
	pluginsUrl?: string;
	diagnosticsUrl?: string;
}

export interface ErrorNodes {
	file: string;
	message: string;
	codeframe: string;
	lists: string;
	stack: string;
}

export interface HmrLogEntry {
	type: string;
	time?: number;
	ms?: number;
	ts: number;
}

export interface PluginInfo {
	name: string;
	installed: boolean;
	active: boolean;
	error?: string;
}

export interface PluginRecord {
	name: string;
	package: string;
	path: string | null;
	active: boolean;
	installed: boolean;
	version: string | null;
	latest: string | null;
	description: string | null;
	author: string | null;
	license: string | null;
	homepage: string | null;
	repository: string | null;
	updatedAt: string | null;
	keywords: string[];
	iconUrl: string | null;
	metaSource: 'vesk.meta.json' | 'package.json' | 'none';
	source: 'config' | 'state';
	error: string | null;
}

export function escapeHtml(s: string): string {
	if (!s) return '';
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function padNum(n: string | number, len: number): string {
	let str = String(n);
	while (str.length < len) str = ' ' + str;
	return str;
}

/**
 * Render a codeframe's `code` lines directly (gutter numbers + text). The
 * server supplies the ±context window (5 above / 5 below). The exact error
 * line is highlighted with inverse-video styling (via `kf-err`) plus a `>`
 * gutter marker, and a caret is drawn at `frame.column` when present.
 */
export function renderCodeframe(frame: HmrCodeframe | undefined | null): string {
	if (!frame || !Array.isArray(frame.code) || frame.code.length === 0) return '';
	let maxNo = 0;
	for (const l of frame.code) {
		if (l.no > maxNo) maxNo = l.no;
	}
	const gutterW = String(maxNo).length;
	let out = '';
	for (const l of frame.code) {
		const no = padNum(l.no, gutterW);
		const marker = l.isError ? '>' : ' ';
		let caret = '';
		if (l.isError && frame.column != null && frame.column > 0) {
			caret = '<span class="kf-caret">' + '^'.padStart(frame.column, ' ') + '</span>';
		}
		out +=
			'<div' +
			(l.isError ? ' class="kf-err"' : '') +
			'>' +
			marker +
			' <span class="kf-ln">' +
			no +
			'</span> ' +
			escapeHtml(l.text) +
			caret +
			'</div>';
	}
	return out;
}

function section(title: string, items: string[]): string {
	let html = '<div class="kf-sec"><div class="kf-sec-t">&gt; ' + escapeHtml(title) + '</div>';
	for (const item of items.slice(0, 6)) {
		html += '<div class="kf-item">' + escapeHtml(item) + '</div>';
	}
	return html + '</div>';
}

/**
 * Build every markup piece of the error overlay/panel from a payload. Pure —
 * safe to unit test without a DOM.
 */
export function buildErrorNodes(payload: HmrErrorPayload): ErrorNodes {
	const fileRaw = payload.file || payload.filePath || '';
	let file = fileRaw ? escapeHtml(fileRaw) : 'unknown file';
	if (payload.line != null) {
		file += ':' + payload.line;
		if (payload.column != null) file += ':' + payload.column;
	}
	const message = payload.message || 'Unknown error';

	let lists = '';
	if (payload.tips && payload.tips.length) lists += section('TIPS', payload.tips);
	if (payload.suggestions && payload.suggestions.length) lists += section('SUGGESTIONS', payload.suggestions);
	if (payload.nextSteps && payload.nextSteps.length) lists += section('NEXT STEPS', payload.nextSteps);

	return {
		file,
		message: escapeHtml(message),
		codeframe: renderCodeframe(payload.codeframe),
		lists,
		stack: payload.stack || '(no stack trace)',
	};
}

export function renderPluginRow(p: PluginInfo, index: number): string {
	const name = p.name || ('plugin#' + index);
	const installed = p.installed ? 'true' : 'false';
	const active = p.active ? 'true' : 'false';
	let err = '';
	if (p.error) err = '  [error] ' + escapeHtml(String(p.error));
	return (
		'<div class="kp-row">&gt; ' +
		escapeHtml(name) +
		'  [installed ' +
		installed +
		'] [active ' +
		active +
		']' +
		err +
		'</div>'
	);
}

export function renderLogRow(entry: HmrLogEntry): string {
	const type = entry.type || '?';
	const time = entry.ms != null ? String(entry.ms) : entry.time != null ? String(entry.time) : '?';
	const stamp = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '--:--:--';
	return '<div class="kl-row">' + escapeHtml(stamp) + '  ' + escapeHtml(type) + '  ' + time + 'ms' + '</div>';
}

export const DEV_TABS: string[] = ['overview', 'errors', 'diagnostics', 'plugins', 'log', 'settings'];

export const DEV_STATE_KEY = 'veskDevPrefs';

export const PANEL_MIN_W = 320;
export const PANEL_MIN_H = 200;
export const PANEL_MARGIN = 8;
export const PANEL_EDGE = 16;

export interface DevtoolState {
	theme: 'system' | 'light' | 'dark';
	pos: 'left' | 'right';
	activeTab: string;
	open: boolean;
	w: number;
	h: number;
	maxed: boolean;
	pluginsView: 'cards' | 'list';
	sidebarMode: 'expanded' | 'rail';
}

export function defaultDevtoolState(): DevtoolState {
	return {
		theme: 'system',
		pos: 'right',
		activeTab: 'overview',
		open: false,
		w: 520,
		h: 420,
		maxed: false,
		pluginsView: 'cards',
		sidebarMode: 'expanded',
	};
}

export function loadDevtoolState(store: object | null | undefined): DevtoolState {
	const state = defaultDevtoolState();
	if (!store) return state;
	try {
		const raw = (store as Storage).getItem(DEV_STATE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<DevtoolState>;
			if (parsed.theme === 'light' || parsed.theme === 'dark') state.theme = parsed.theme;
			if (parsed.pos === 'left' || parsed.pos === 'right') state.pos = parsed.pos;
			if (typeof parsed.activeTab === 'string' && DEV_TABS.indexOf(parsed.activeTab) !== -1) {
				state.activeTab = parsed.activeTab;
			}
			if (typeof parsed.open === 'boolean') state.open = parsed.open;
			if (typeof parsed.w === 'number') state.w = Math.max(PANEL_MIN_W, parsed.w);
			if (typeof parsed.h === 'number') state.h = Math.max(PANEL_MIN_H, parsed.h);
			if (typeof parsed.maxed === 'boolean') state.maxed = parsed.maxed;
			if (parsed.pluginsView === 'cards' || parsed.pluginsView === 'list') state.pluginsView = parsed.pluginsView;
			if (parsed.sidebarMode === 'expanded' || parsed.sidebarMode === 'rail') state.sidebarMode = parsed.sidebarMode;
		}
	} catch {
		/* devtool state is optional */
	}
	return state;
}

export function saveDevtoolState(store: object | null | undefined, state: DevtoolState): void {
	if (!store) return;
	try {
		(store as Storage).setItem(DEV_STATE_KEY, JSON.stringify(state));
	} catch {
		/* devtool state is optional */
	}
}

const TAB_GLYPHS: Record<string, string> = {
	overview: 'Ov',
	errors: 'Er',
	plugins: 'Pl',
	log: 'Lg',
	diagnostics: 'Dg',
	settings: 'St',
};

export function renderTabBar(active: string, mode: DevtoolState['sidebarMode'] = 'expanded'): string {
	if (mode === 'rail') {
		let out = '<div class="__kp_tabs __kp_tabs_rail" data-sidebar="rail">';
		for (const tab of DEV_TABS) {
			const glyph = TAB_GLYPHS[tab] || tab.slice(0, 2).toUpperCase();
			out +=
				'<button class="__kp_tab' +
				(tab === active ? ' active' : '') +
				'" data-tab="' +
				tab +
				'" data-rail="1">' +
				'<span class="__kp_tab_glyph">' +
				escapeHtml(glyph) +
				'</span>' +
				'<span class="__kp_tab_label">' +
				escapeHtml(tab) +
				'</span>' +
				'</button>';
		}
		return out + '</div>';
	}
	let out = '<div class="__kp_tabs" data-sidebar="expanded">';
	for (const tab of DEV_TABS) {
		out +=
			'<button class="__kp_tab' +
			(tab === active ? ' active' : '') +
			'" data-tab="' +
			tab +
			'">' +
			escapeHtml(tab) +
			'</button>';
	}
	return out + '</div>';
}

export interface DevOverview {
	host: string;
	lastCompileMs: number;
	lastError: HmrErrorPayload | null;
}

export function renderOverviewPanel(overview: DevOverview): string {
	const err = overview.lastError ? escapeHtml(overview.lastError.message || 'error') : 'none';
	return (
		'<div class="__kp_sec">&gt; STATUS</div>' +
		'<div class="__kp_line">DEV SERVER: <b>' +
		escapeHtml(overview.host) +
		'</b></div>' +
		'<div class="__kp_line">LAST COMPILE: <b>' +
		(overview.lastCompileMs > 0 ? overview.lastCompileMs + 'ms' : 'pending') +
		'</b></div>' +
		'<div class="__kp_line">LAST ERROR: <b>' +
		err +
		'</b></div>'
	);
}

export function renderErrorsPanel(err: HmrErrorPayload | null): string {
	if (!err) {
		return '<div class="__kp_sec">&gt; ERRORS</div><div class="__kp_line">no errors</div>';
	}
	const nodes = buildErrorNodes(err);
	return (
		'<div class="__kp_sec">&gt; ERRORS</div>' +
		'<div class="__kp_line"><b>' +
		nodes.file +
		'</b></div>' +
		'<div class="__kp_line">' +
		nodes.message +
		'</div>' +
		(nodes.codeframe ? '<div class="__kp_code">' + nodes.codeframe + '</div>' : '') +
		nodes.lists +
		'<details class="__kp_stack"><summary>Stack trace</summary><pre>' +
		escapeHtml(nodes.stack) +
		'</pre></details>'
	);
}

export function pluginIconHtml(iconUrl: string | null | undefined, name: string): string {
	const initial = escapeHtml((name || '?').charAt(0).toUpperCase());
	let inner = escapeHtml(initial);
	if (iconUrl) inner = '<img src="' + escapeHtml(iconUrl) + '" alt="">';
	return '<span class="__kp_pl_icon">' + inner + '</span>';
}

export function pluginBadge(p: PluginRecord): string {
	if (!p.installed) {
		return '<span class="__kp_pl_badge off">not installed</span>';
	}
	return '<span class="__kp_pl_badge ok">' + (p.active ? 'active' : 'inactive') + '</span>';
}

export function pluginVersions(p: PluginRecord): string {
	let out = p.version ? 'v' + escapeHtml(String(p.version)) : 'no version';
	if (p.installed && p.latest && p.latest !== p.version) {
		out += ' \u2192 ' + escapeHtml(String(p.latest));
	}
	return out;
}

export function renderPluginCard(p: PluginRecord): string {
	let html =
		'<div class="__kp_pl_card" data-plugin="' +
		escapeHtml(p.name) +
		'">' +
		'<div class="__kp_pl_head">' +
		pluginIconHtml(p.iconUrl, p.name) +
		'<div class="__kp_pl_name">' +
		escapeHtml(p.name) +
		'</div>' +
		pluginBadge(p) +
		'</div>' +
		'<div class="__kp_pl_versions">' +
		pluginVersions(p) +
		'</div>';
	if (p.description) html += '<div class="__kp_pl_desc">' + escapeHtml(p.description) + '</div>';
	let meta = '';
	if (p.author) meta += 'author: ' + escapeHtml(p.author) + '  ';
	if (p.license) meta += 'license: ' + escapeHtml(p.license) + '  ';
	if (p.homepage) meta += 'homepage: ' + escapeHtml(p.homepage) + '  ';
	if (p.repository) meta += 'repo: ' + escapeHtml(p.repository) + '  ';
	if (p.updatedAt) meta += 'updated: ' + escapeHtml(String(p.updatedAt)) + '  ';
	if (p.metaSource && p.metaSource !== 'none') meta += 'meta: ' + escapeHtml(p.metaSource) + '  ';
	if (meta) html += '<div class="__kp_pl_meta">' + meta + '</div>';
	if (p.keywords && p.keywords.length) {
		html += '<div class="__kp_pl_keywords">';
		for (const kw of p.keywords) html += '<span class="__kp_pl_kw">' + escapeHtml(String(kw)) + '</span>';
		html += '</div>';
	}
	if (p.error) html += '<div class="__kp_pl_err">' + escapeHtml(p.error) + '</div>';
	return html + '</div>';
}

export function renderPluginListRow(p: PluginRecord): string {
	let sub = pluginVersions(p);
	if (p.description) sub += '  ' + escapeHtml(p.description);
	return (
		'<div class="__kp_pl_row" data-plugin="' +
		escapeHtml(p.name) +
		'">' +
		pluginIconHtml(p.iconUrl, p.name) +
		'<div class="__kp_pl_row_info">' +
		'<div class="__kp_pl_row_name">' +
		escapeHtml(p.name) +
		'</div>' +
		'<div class="__kp_pl_row_sub">' +
		sub +
		'</div>' +
		'</div>' +
		pluginBadge(p) +
		'</div>'
	);
}

export function renderPluginListView(plugins: PluginRecord[]): string {
	return '<div class="__kp_pl_list">' + plugins.map(renderPluginListRow).join('') + '</div>';
}

export function renderPluginCardsView(plugins: PluginRecord[]): string {
	return '<div class="__kp_pl_grid">' + plugins.map(renderPluginCard).join('') + '</div>';
}

export function renderPluginsPanel(
	plugins: PluginRecord[],
	error: string | null,
	view: DevtoolState['pluginsView'] = 'cards'
): string {
	let html = '<div class="__kp_sec">&gt; PLUGINS</div>';
	html += '<div class="__kp_pl_toolbar">';
	html +=
		'<button class="__kp_pl_view' +
		(view === 'cards' ? ' active' : '') +
		'" data-pl-view="cards">cards</button>';
	html +=
		'<button class="__kp_pl_view' +
		(view === 'list' ? ' active' : '') +
		'" data-pl-view="list">list</button>';
	html += '<button class="__kp_pl_btn" data-pl-search="1">install / search</button>';
	html += '</div>';
	if (error) {
		html += '<div class="kp-err">' + escapeHtml(error) + '</div>';
	} else if (plugins.length === 0) {
		html += '<div class="__kp_line">no plugins reported</div>';
	} else {
		html += view === 'list' ? renderPluginListView(plugins) : renderPluginCardsView(plugins);
	}
	return html;
}

export interface PluginExportsData {
	ok: boolean;
	name: string;
	entry: string | null;
	packageJsonExports: Record<string, string> | null;
	dtsPath: string | null;
	dtsExports: string[];
	error?: string | null;
}

export function renderPluginDetail(p: PluginRecord, message: string | null): string {
	let html =
		'<div class="__kp_sec">&gt; PLUGIN</div>' +
		'<button class="__kp_pl_btn" data-pl-back="1">[back]</button>' +
		'<div class="__kp_pl_detail">' +
		'<div class="__kp_pl_head">' +
		pluginIconHtml(p.iconUrl, p.name) +
		'<div class="__kp_pl_name">' +
		escapeHtml(p.name) +
		'</div>' +
		pluginBadge(p) +
		'</div>' +
		'<div class="__kp_pl_versions">' +
		pluginVersions(p) +
		'</div>' +
		'<div class="__kp_pl_pkg">package: ' +
		escapeHtml(p.package || p.name) +
		'</div>';
	if (p.description) html += '<div class="__kp_pl_desc">' + escapeHtml(p.description) + '</div>';
	let meta = '';
	if (p.author) meta += '<div>author: <b>' + escapeHtml(p.author) + '</b></div>';
	if (p.license) meta += '<div>license: <b>' + escapeHtml(p.license) + '</b></div>';
	if (p.homepage) meta += '<div>homepage: <b>' + escapeHtml(p.homepage) + '</b></div>';
	if (p.repository) meta += '<div>repository: <b>' + escapeHtml(p.repository) + '</b></div>';
	if (p.updatedAt) meta += '<div>updated: <b>' + escapeHtml(String(p.updatedAt)) + '</b></div>';
	if (p.path) meta += '<div>path: <b>' + escapeHtml(p.path) + '</b></div>';
	if (p.metaSource && p.metaSource !== 'none') meta += '<div>meta: <b>' + escapeHtml(p.metaSource) + '</b></div>';
	if (p.keywords && p.keywords.length) meta += '<div>keywords: <b>' + escapeHtml(p.keywords.join(', ')) + '</b></div>';
	if (meta) html += '<div class="__kp_pl_meta">' + meta + '</div>';
	if (p.error) html += '<div class="__kp_pl_err">' + escapeHtml(p.error) + '</div>';
	if (message) html += '<div class="__kp_pl_err">' + escapeHtml(message) + '</div>';

	html += '<div class="__kp_pl_actions">';
	const canUpdate = p.installed && p.latest && p.latest !== p.version;
	if (p.installed) {
		html +=
			p.active
				? '<button class="__kp_pl_btn" data-pl-act="deactivate" data-name="' +
					escapeHtml(p.name) +
					'">deactivate</button>'
				: '<button class="__kp_pl_btn" data-pl-act="activate" data-name="' +
					escapeHtml(p.name) +
					'">activate</button>';
		html +=
			'<button class="__kp_pl_btn" data-pl-act="update" data-package="' +
			escapeHtml(p.package || p.name) +
			'"' +
			(canUpdate ? '' : ' disabled') +
			'>update' +
			(canUpdate ? ' \u2192 ' + escapeHtml(String(p.latest)) : '') +
			'</button>';
		html +=
			'<button class="__kp_pl_btn danger" data-pl-act="uninstall" data-package="' +
			escapeHtml(p.package || p.name) +
			'">uninstall</button>';
	}
	html +=
		'<button class="__kp_pl_btn" data-pl-exports="1" data-name="' +
		escapeHtml(p.name) +
		'">view exports &amp; types</button>';
	html += '</div>';
	html += '</div>';
	return html;
}

export function renderPluginExports(data: PluginExportsData, error: string | null): string {
	let html =
		'<div class="__kp_sec">&gt; EXPORTS &amp; TYPES</div>' +
		'<button class="__kp_pl_btn" data-pl-back="1">[back]</button>' +
		'<div class="__kp_pl_detail">';
	if (error) {
		html += '<div class="__kp_pl_err">' + escapeHtml(error) + '</div>';
		html += '</div>';
		return html;
	}
	html += '<div class="__kp_pl_export"><dl>';
	if (data && data.entry) html += '<dt>entry</dt><dd>' + escapeHtml(data.entry) + '</dd>';
	if (data && data.dtsPath) html += '<dt>d.ts path</dt><dd>' + escapeHtml(data.dtsPath) + '</dd>';
	if (data && data.packageJsonExports && Object.keys(data.packageJsonExports).length) {
		html += '<dt>package exports</dt>';
		for (const k of Object.keys(data.packageJsonExports)) {
			html += '<dd>' + escapeHtml(k) + ' \u2192 ' + escapeHtml(String(data.packageJsonExports[k])) + '</dd>';
		}
	}
	if (data && data.dtsExports && data.dtsExports.length) {
		html += '<dt>declared exports</dt>';
		for (const ex of data.dtsExports) {
			html += '<div class="__kp_pl_ex_item">&gt; ' + escapeHtml(String(ex)) + '</div>';
		}
	}
	html += '</dl></div></div>';
	return html;
}

export interface PluginSearchResult {
	name: string;
	version: string;
	description: string;
	author: string;
	date: string;
	keywords: string[];
	links?: Record<string, string>;
}

export const PLUGIN_SEARCH_SUGGESTIONS: string[] = ['@vesk', 'keyword:vesk', '@vesk/plugin-'];

export function renderPluginSearch(
	query: string,
	results: PluginSearchResult[],
	error: string | null,
	loading: boolean,
	installing: string | null = null,
	installed: string[] = []
): string {
	const installedSet = new Set(installed);
	let html =
		'<div class="__kp_sec">&gt; INSTALL / SEARCH</div>' +
		'<button class="__kp_pl_btn" data-pl-back="1">[back]</button>' +
		'<div class="__kp_pl_search">' +
		'<input class="__kp_pl_q" id="__kp_pl_q" placeholder="search npm for plugins" value="' +
		escapeHtml(query) +
		'">' +
		'<button class="__kp_pl_btn" data-pl-search-go="1">search</button>' +
		'</div>' +
		'<div class="__kp_pl_suggest">browse: ';
	for (const s of PLUGIN_SEARCH_SUGGESTIONS) {
		html += '<button class="__kp_pl_btn" data-pl-suggest="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
	}
	html += '</div>';
	if (error) html += '<div class="__kp_pl_err">' + escapeHtml(error) + '</div>';
	if (loading) html += '<div class="__kp_line">searching...</div>';
	if (results.length === 0 && !loading && !error) {
		html += '<div class="__kp_line">no results</div>';
	}
	if (results.length) {
		html += '<div class="__kp_pl_list">';
		for (const r of results) {
			let sub = '';
			if (r.version) sub += 'v' + escapeHtml(r.version);
			if (r.description) sub += '  ' + escapeHtml(r.description);
			if (r.author) sub += '  by ' + escapeHtml(r.author);
			if (r.date) sub += '  ' + escapeHtml(r.date);
			const busy = installing === r.name;
			const isInstalled = installedSet.has(r.name);
			html +=
				'<div class="__kp_pl_row" data-search-pkg="' +
				escapeHtml(r.name) +
				'">' +
				'<div class="__kp_pl_row_info">' +
				'<div class="__kp_pl_row_name">' +
				escapeHtml(r.name) +
				(isInstalled ? '<span class="__kp_pl_badge on">installed</span>' : '') +
				'</div>' +
				'<div class="__kp_pl_row_sub">' +
				sub +
				'</div>' +
				(r.keywords && r.keywords.length
					? '<div class="__kp_pl_keywords">' +
						r.keywords.map((kw) => '<span class="__kp_pl_kw">' + escapeHtml(String(kw)) + '</span>').join('') +
						'</div>'
					: '') +
				'</div>' +
				'<button class="__kp_pl_btn" data-search-pkg-open="' +
				escapeHtml(r.name) +
				'">details</button>' +
				'<button class="__kp_pl_btn" data-pl-install="' +
				escapeHtml(r.name) +
				'"' +
				(busy || isInstalled ? ' disabled' : '') +
				'>' +
				(busy ? 'installing...' : isInstalled ? 'installed' : 'install') +
				'</button>' +
				'</div>';
		}
		html += '</div>';
	}
	if (installing) html += '<div class="__kp_line">installing ' + escapeHtml(installing) + ' \u2014 please wait...</div>';
	return html;
}

export function renderSearchPluginDetail(r: PluginSearchResult, installing: string | null, installed: string[] = []): string {
	const busy = installing === r.name;
	const isInstalled = installed.indexOf(r.name) >= 0;
	let html =
		'<div class="__kp_sec">&gt; PLUGIN (npm)</div>' +
		'<button class="__kp_pl_btn" data-pl-back="1">[back]</button>' +
		'<div class="__kp_pl_detail">' +
		'<div class="__kp_pl_head">' +
		'<div class="__kp_pl_icon">' +
		escapeHtml((r.name[0] || '?').toUpperCase()) +
		'</div>' +
		'<div class="__kp_pl_name">' +
		escapeHtml(r.name) +
		'</div>' +
		'<span class="__kp_pl_badge ' +
		(isInstalled ? 'on' : 'off') +
		'">' +
		(isInstalled ? 'installed' : 'not installed') +
		'</span>' +
		'</div>' +
		(r.version ? '<div class="__kp_pl_versions">v' + escapeHtml(r.version) + '</div>' : '') +
		(r.description ? '<div class="__kp_pl_desc">' + escapeHtml(r.description) + '</div>' : '') +
		'<div class="__kp_pl_meta">' +
		(r.author ? '<div>author: <b>' + escapeHtml(r.author) + '</b></div>' : '') +
		(r.date ? '<div>published: <b>' + escapeHtml(r.date) + '</b></div>' : '') +
		'</div>' +
		(r.keywords && r.keywords.length
			? '<div class="__kp_pl_keywords">' +
				r.keywords.map((k) => '<span class="__kp_pl_kw">' + escapeHtml(String(k)) + '</span>').join('') +
				'</div>'
			: '') +
		'<div class="__kp_pl_actions">' +
		'<button class="__kp_pl_btn" data-pl-install="' +
		escapeHtml(r.name) +
		'"' +
		(busy || isInstalled ? ' disabled' : '') +
		'>' +
		(busy ? 'installing...' : isInstalled ? 'installed' : 'install') +
		'</button>' +
		'</div>' +
		'</div>';
	if (busy) html += '<div class="__kp_line">installing ' + escapeHtml(r.name) + ' \u2014 please wait...</div>';
	return html;
}

export function renderLogPanel(log: HmrLogEntry[]): string {
	let html = '<div class="__kp_sec">&gt; LOG</div>';
	if (log.length === 0) {
		html += '<div class="__kp_line">no events yet</div>';
	} else {
		html += log.map(renderLogRow).join('');
	}
	return html;
}

export interface DevDiagnostic {
	severity: 'error' | 'warning' | 'info';
	code: string;
	file?: string | null;
	line?: number | null;
	column?: number | null;
	message: string;
	hint?: string | null;
}

export function renderDiagnosticsPanel(findings: DevDiagnostic[]): string {
	let html = '<div class="__kp_sec">&gt; DIAGNOSTICS</div>';
	if (findings.length === 0) {
		html += '<div class="__kp_line">no findings — all clear</div>';
		return html;
	}
	const order: DevDiagnostic['severity'][] = ['error', 'warning', 'info'];
	const grouped = order.map((sev) => ({ sev, list: findings.filter((f) => f.severity === sev) }));
	let count = 0;
	for (const { sev, list } of grouped) {
		if (list.length === 0) continue;
		html += '<div class="__kp_sec">&gt; ' + sev.toUpperCase() + ' (' + list.length + ')</div>';
		for (const f of list) {
			count++;
			html +=
				'<div class="__kp_diag" data-severity="' +
				sev +
				'">' +
				'<div class="__kp_diag_head">' +
				'<span class="__kp_diag_badge ' +
				sev +
				'">' +
				sev.toUpperCase() +
				'</span>' +
				'<span class="__kp_diag_code">' +
				escapeHtml(f.code) +
				'</span>' +
				'<span class="__kp_diag_msg">' +
				escapeHtml(f.message) +
				'</span>' +
				'</div>' +
				(f.file
					? '<div class="__kp_diag_loc">' +
						escapeHtml(f.file) +
						(f.line != null ? ':' + f.line + (f.column != null ? ':' + f.column : '') : '') +
						'</div>'
					: '') +
				(f.hint ? '<div class="__kp_diag_hint">' + escapeHtml(f.hint) + '</div>' : '') +
				'</div>';
		}
	}
	void count;
	return html;
}

export interface DevPrefs {
	theme: DevtoolState['theme'];
	pos: DevtoolState['pos'];
	pluginsView: DevtoolState['pluginsView'];
	sidebarMode: DevtoolState['sidebarMode'];
}

function settingsOptRow(
	label: string,
	key: string,
	options: { val: string; label: string }[],
	current: string
): string {
	let html = '<div class="__kp_setlabel">' + label + '</div><div class="__kp_optrow">';
	for (const opt of options) {
		html +=
			'<button class="__kp_opt' +
			(opt.val === current ? ' active' : '') +
			'" data-key="' +
			key +
			'" data-val="' +
			opt.val +
			'">' +
			escapeHtml(opt.label) +
			'</button>';
	}
	return html + '</div>';
}

export function renderSettingsPanel(prefs: DevPrefs): string {
	const themes: ('system' | 'light' | 'dark')[] = ['system', 'light', 'dark'];
	const positions: ('left' | 'right')[] = ['left', 'right'];
	const pluginViews: DevtoolState['pluginsView'][] = ['cards', 'list'];
	let html = '<div class="__kp_sec">&gt; SETTINGS</div>';
	html += settingsOptRow('THEME', 'theme', themes.map((t) => ({ val: t, label: t })), prefs.theme);
	html += settingsOptRow('PANEL POSITION', 'pos', positions.map((p) => ({ val: p, label: p })), prefs.pos);
	html += settingsOptRow(
		'PLUGIN VIEW',
		'pluginsView',
		pluginViews.map((v) => ({ val: v, label: v })),
		prefs.pluginsView
	);
	html += settingsOptRow(
		'SIDEBAR MODE',
		'sidebarMode',
		[
			{ val: 'expanded', label: 'top' },
			{ val: 'rail', label: 'sidebar' },
		],
		prefs.sidebarMode
	);
	return html;
}

export function resolveUrls(opts?: DevClientOptions): { wsUrl: string; stateUrl: string; pluginsUrl: string; diagnosticsUrl: string } {
	return {
		wsUrl: (opts && opts.wsUrl) || '',
		stateUrl: (opts && opts.stateUrl) || '/__vesk/hmr/state',
		pluginsUrl: (opts && opts.pluginsUrl) || '/__vesk/plugins',
		diagnosticsUrl: (opts && opts.diagnosticsUrl) || '/__vesk/diagnostics',
	};
}

export interface GlobalHmrApi {
	show(payload: HmrErrorPayload): void;
	dismiss(): void;
}

export function registerGlobalHmr(api: GlobalHmrApi): void {
	const g = globalThis as Record<string, unknown>;
	g.__vesk_hmr_show = api.show;
	g.__vesk_hmr_dismiss = api.dismiss;
}

const CSS =
	'@keyframes __v_pulse{0%,100%{opacity:1}50%{opacity:.3}}' +
	'@keyframes __v_in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}' +
	'@keyframes __v_tab{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}' +
	'@keyframes __v_vo{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}' +
	'#__vesk_dev,#__vesk_overlay{--vk-bg:#000;--vk-fg:#fff;--vk-border:#fff;--vk-line:#444;--vk-line-soft:#333;--vk-soft:#111;--vk-soft-hi:#222;--vk-muted:#bbb;--vk-dim:#666;--vk-codebg:#0a0a0a;--vk-inv-bg:#fff;--vk-inv-fg:#000;--vk-dot:#555;}' +
	'#__vesk_dev[data-theme="light"],#__vesk_overlay[data-theme="light"]{--vk-bg:#fff;--vk-fg:#111;--vk-border:#111;--vk-line:#ccc;--vk-line-soft:#ddd;--vk-soft:#f5f5f5;--vk-soft-hi:#ececec;--vk-muted:#444;--vk-dim:#888;--vk-codebg:#fafafa;--vk-inv-bg:#111;--vk-inv-fg:#fff;--vk-dot:#999;}' +
	'#__vesk_dev *,#__vesk_overlay *{transition:background .18s ease,color .18s ease,border-color .18s ease;}' +
	'#__vesk_dev,#__vesk_dev *,#__vesk_overlay,#__vesk_overlay *{scrollbar-width:none;}' +
	'#__vesk_dev *::-webkit-scrollbar,#__vesk_overlay *::-webkit-scrollbar{display:none;}' +
	'#__vesk_dev{all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;color:var(--vk-fg);}' +
	'#__vesk_dev[data-pos="left"]{left:16px;right:auto;}' +
	'#__vesk_dev .__v_bar{display:flex;align-items:center;gap:8px;background:var(--vk-bg);border:1px solid var(--vk-border);border-radius:0;padding:6px 12px;cursor:pointer;animation:__v_in .3s cubic-bezier(.22,.61,.36,1);transition:background .15s ease,transform .15s ease,border-color .15s ease;}' +
	'#__vesk_dev .__v_bar:hover{background:var(--vk-soft);transform:translateY(-1px);border-color:var(--vk-dim);}' +
	'#__vesk_dev .__v_dot{width:8px;height:8px;flex-shrink:0;background:var(--vk-dot);transition:background .12s ease;}' +
	'#__vesk_dev .__v_dot.compiling{background:var(--vk-fg);animation:__v_pulse .8s infinite;}' +
	'#__vesk_dev .__v_dot.error{background:var(--vk-fg);animation:__v_pulse .4s infinite;}' +
	'#__vesk_overlay{all:initial;position:fixed;inset:0;z-index:2147483646;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;color:var(--vk-fg);display:flex;visibility:hidden;opacity:0;pointer-events:none;transition:opacity .16s ease,visibility 0s linear .16s;}' +
	'#__vesk_overlay.open{visibility:visible;opacity:1;pointer-events:auto;transition:opacity .16s ease;}' +
	'#__vesk_overlay .__vo_backdrop{position:absolute;inset:0;background:var(--vk-bg);opacity:.85;}' +
	'#__vesk_overlay .__vo_panel{position:relative;margin:32px auto;max-width:820px;width:90%;max-height:calc(100vh - 64px);background:var(--vk-bg);border:1px solid var(--vk-border);border-radius:0;display:flex;flex-direction:column;overflow:hidden;animation:__v_vo .22s cubic-bezier(.22,.61,.36,1);}' +
	'#__vesk_overlay .__vo_header{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--vk-line);flex-shrink:0;}' +
	'#__vesk_overlay .__vo_title{font-size:13px;font-weight:700;color:var(--vk-fg);flex:1;text-transform:uppercase;letter-spacing:.08em;}' +
	'#__vesk_overlay .__vo_close{all:unset;cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--vk-muted);font-size:16px;}' +
	'#__vesk_overlay .__vo_close:hover{color:var(--vk-fg);background:var(--vk-soft-hi);}' +
	'#__vesk_overlay .__vo_body{overflow-y:auto;padding:16px;flex:1;}' +
	'#__vesk_overlay .__vo_file{font-size:12px;color:var(--vk-muted);margin-bottom:8px;white-space:pre-wrap;word-break:break-all;}' +
	'#__vesk_overlay .__vo_file strong{color:var(--vk-fg);}' +
	'#__vesk_overlay .__vo_message{font-size:13px;color:var(--vk-inv-fg);background:var(--vk-inv-bg);padding:8px 12px;margin-bottom:12px;white-space:pre-wrap;word-break:break-all;font-weight:700;}' +
	'#__vesk_overlay .__vo_code{background:var(--vk-codebg);border:1px solid var(--vk-line-soft);border-radius:0;padding:12px;margin-bottom:12px;overflow-x:auto;font-size:12px;line-height:1.6;}' +
	'#__vesk_overlay .__vo_code .kf-ln{color:var(--vk-dim);user-select:none;margin-right:8px;}' +
	'#__vesk_overlay .__vo_code .kf-err{background:var(--vk-inv-bg);color:var(--vk-inv-fg);width:100%;}' +
	'#__vesk_overlay .__vo_code .kf-err .kf-ln{color:var(--vk-inv-fg);}' +
	'#__vesk_overlay .__vo_code .kf-caret{color:var(--vk-inv-fg);font-weight:700;}' +
	'#__vesk_overlay .__vo_tips{margin-top:8px;}' +
	'#__vesk_overlay .kf-sec{margin-top:10px;}' +
	'#__vesk_overlay .kf-sec-t{font-size:11px;font-weight:700;color:var(--vk-fg);margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em;}' +
	'#__vesk_overlay .kf-item{padding:2px 0 2px 16px;font-size:12px;color:var(--vk-muted);position:relative;}' +
	'#__vesk_overlay .kf-item::before{content:"\\2192";position:absolute;left:0;color:var(--vk-fg);}' +
	'#__vesk_overlay .__vo_stack{border:1px solid var(--vk-line-soft);margin-top:12px;}' +
	'#__vesk_overlay .__vo_stack summary{cursor:pointer;font-size:11px;color:var(--vk-muted);padding:6px 10px;text-transform:uppercase;letter-spacing:.08em;}' +
	'#__vesk_overlay .__vo_stack pre{background:var(--vk-codebg);padding:8px 10px;margin:0;font-size:11px;color:var(--vk-muted);max-height:200px;overflow:auto;white-space:pre;border-top:1px solid var(--vk-line-soft);}' +
	'#__vesk_overlay .__vo_footer{padding:8px 16px;border-top:1px solid var(--vk-line);font-size:11px;color:var(--vk-dim);text-align:center;flex-shrink:0;}' +
	'#__vesk_dev .__kp{all:initial;position:fixed;inset:auto 16px 60px auto;width:520px;max-width:calc(100vw - 32px);max-height:calc(100vh - 24px);min-width:320px;min-height:200px;background:var(--vk-bg);border:1px solid var(--vk-border);border-radius:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;color:var(--vk-fg);display:flex;flex-direction:column;overflow:hidden;z-index:2147483647;visibility:visible;opacity:1;transform:translateY(0) scale(1);transition:opacity .18s ease,transform .18s cubic-bezier(.22,.61,.36,1),width .24s cubic-bezier(.22,.61,.36,1),height .24s cubic-bezier(.22,.61,.36,1),background .18s ease,color .18s ease,border-color .18s ease;}' +
	'#__vesk_dev[data-pos="left"] .__kp{left:16px;right:auto;}' +
	'#__vesk_dev .__kp.hidden{visibility:hidden;opacity:0;transform:translateY(10px) scale(.98);pointer-events:none;}' +
	'#__vesk_dev .__kp.resizing{transition:none;}' +
	'#__vesk_dev .__kp.maxed{width:min(560px,50vw);height:min(480px,50vh);max-width:none;max-height:none;}' +
	'#__vesk_dev .__kp_handle{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;touch-action:none;z-index:2;}' +
	'#__vesk_dev .__kp_handle::before{content:"";position:absolute;right:4px;bottom:4px;width:10px;height:10px;border-right:2px solid var(--vk-dim);border-bottom:2px solid var(--vk-dim);}' +
	'#__vesk_dev .__kp_handle:hover::before,#__vesk_dev .__kp_handle.resizing::before{border-color:var(--vk-fg);}' +
	'#__vesk_dev .__kp.maxed .__kp_handle{display:none;}' +
	'#__vesk_dev .__kp_head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--vk-line);flex-shrink:0;}' +
	'#__vesk_dev .__kp_title{font-weight:700;text-transform:uppercase;letter-spacing:.1em;flex:1;}' +
	'#__vesk_dev .__kp_tabs{display:flex;border-bottom:1px solid var(--vk-line);flex-shrink:0;padding:0 4px;overflow-x:auto;}' +
	'#__vesk_dev .__kp_tab{all:unset;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;color:var(--vk-muted);text-transform:uppercase;letter-spacing:.1em;padding:8px 12px;border-right:1px solid var(--vk-line-soft);white-space:nowrap;transition:color .12s ease,background .12s ease;}' +
	'#__vesk_dev .__kp_tab:hover{color:var(--vk-fg);background:var(--vk-soft);}' +
	'#__vesk_dev .__kp_tab.active{color:var(--vk-inv-fg);background:var(--vk-inv-bg);}' +
	'#__vesk_dev .__kp_body{overflow:hidden;flex:1;display:flex;flex-direction:column;min-height:0;}' +
	'#__vesk_dev .__kp_body #__kp_content{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0;}' +
	'#__vesk_dev .__kp_pane{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;scroll-behavior:smooth;padding:12px;animation:__v_tab .18s cubic-bezier(.22,.61,.36,1);min-height:0;}' +
	'#__vesk_dev .__kp_pane::-webkit-scrollbar{display:none;}' +
	'#__vesk_dev .__kp_max{all:unset;cursor:pointer;color:var(--vk-muted);font-size:14px;padding:0 4px;transition:color .12s ease,background .12s ease;}' +
	'#__vesk_dev .__kp_max:hover{color:var(--vk-fg);background:var(--vk-soft-hi);}' +
	'#__vesk_dev .__kp_close{all:unset;cursor:pointer;color:var(--vk-muted);font-size:14px;transition:color .12s ease,background .12s ease;}' +
	'#__vesk_dev .__kp_close:hover{color:var(--vk-fg);background:var(--vk-soft-hi);}' +
	'#__vesk_dev .__kp_sec{font-size:11px;font-weight:700;color:var(--vk-fg);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--vk-line-soft);padding-bottom:4px;margin:14px 0 8px;}' +
	'#__vesk_dev .__kp_sec:first-child{margin-top:0;}' +
	'#__vesk_dev .__kp_setlabel{font-size:11px;font-weight:700;color:var(--vk-muted);text-transform:uppercase;letter-spacing:.1em;margin-top:6px;}' +
	'#__vesk_dev .__kp_optrow{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 14px;}' +
	'#__vesk_dev .__kp_opt{all:unset;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--vk-muted);border:1px solid var(--vk-line-soft);padding:4px 10px;transition:color .12s ease,background .12s ease,border-color .12s ease;}' +
	'#__vesk_dev .__kp_opt:hover{color:var(--vk-fg);border-color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_opt.active{color:var(--vk-inv-fg);background:var(--vk-inv-bg);border-color:var(--vk-border);}' +
	'#__vesk_dev .__kp_line{font-size:12px;color:var(--vk-muted);}' +
	'#__vesk_dev .__kp_line b{color:var(--vk-fg);}' +
	'#__vesk_dev .__kp_code{background:var(--vk-codebg);border:1px solid var(--vk-line-soft);padding:10px;font-size:12px;line-height:1.6;}' +
	'#__vesk_dev .__kp_code .kf-ln{color:var(--vk-dim);user-select:none;margin-right:8px;}' +
	'#__vesk_dev .__kp_code .kf-err{background:var(--vk-inv-bg);color:var(--vk-inv-fg);width:100%;}' +
	'#__vesk_dev .__kp_code .kf-err .kf-ln{color:var(--vk-inv-fg);}' +
	'#__vesk_dev .__kp_code .kf-caret{color:var(--vk-inv-fg);font-weight:700;}' +
	'#__vesk_dev .__kp_diag{border:1px solid var(--vk-line-soft);padding:8px 10px;margin:6px 0;}' +
	'#__vesk_dev .__kp_diag[data-severity="error"]{border-left:3px solid var(--vk-inv-bg);}' +
	'#__vesk_dev .__kp_diag[data-severity="warning"]{border-left:3px solid var(--vk-dim);}' +
	'#__vesk_dev .__kp_diag[data-severity="info"]{border-left:3px solid var(--vk-dot);}' +
	'#__vesk_dev .__kp_diag_head{display:flex;gap:8px;align-items:baseline;}' +
	'#__vesk_dev .__kp_diag_badge{font-size:10px;font-weight:700;letter-spacing:.05em;flex-shrink:0;}' +
	'#__vesk_dev .__kp_diag_badge.error{color:var(--vk-inv-fg);background:var(--vk-inv-bg);padding:0 5px;}' +
	'#__vesk_dev .__kp_diag_badge.warning{color:var(--vk-fg);background:var(--vk-soft-hi);padding:0 5px;}' +
	'#__vesk_dev .__kp_diag_badge.info{color:var(--vk-muted);padding:0 5px;}' +
	'#__vesk_dev .__kp_diag_code{font-size:10px;color:var(--vk-dim);font-weight:700;flex-shrink:0;}' +
	'#__vesk_dev .__kp_diag_msg{font-size:12px;color:var(--vk-fg);}' +
	'#__vesk_dev .__kp_diag_loc{font-size:11px;color:var(--vk-dim);margin-top:4px;word-break:break-all;}' +
	'#__vesk_dev .__kp_diag_hint{font-size:11px;color:var(--vk-muted);margin-top:4px;}' +
	'#__vesk_dev .__kp_item{padding:2px 0 2px 16px;color:var(--vk-muted);position:relative;font-size:12px;}' +
	'#__vesk_dev .__kp_item::before{content:"\\2192";position:absolute;left:0;color:var(--vk-fg);}' +
	'#__vesk_dev .__kp_stack summary{cursor:pointer;font-size:11px;color:var(--vk-muted);padding:4px 8px;border:1px solid var(--vk-line-soft);text-transform:uppercase;}' +
	'#__vesk_dev .__kp_stack pre{background:var(--vk-codebg);border:1px solid var(--vk-line-soft);border-top:none;padding:8px;margin:0;font-size:11px;color:var(--vk-muted);max-height:160px;overflow:auto;white-space:pre;}' +
	'#__vesk_dev .kp-row{font-size:12px;color:var(--vk-muted);}' +
	'#__vesk_dev .kp-err{font-size:12px;color:var(--vk-inv-fg);background:var(--vk-inv-bg);padding:6px 10px;font-weight:700;}' +
	'#__vesk_dev .kl-row{font-size:11px;color:var(--vk-muted);}' +
	'#__vesk_dev .__kp_tab .__kp_tab_label{display:none;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);grid-template-areas:"head head" "tabs body";gap:0;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_head{grid-area:head;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_tabs{grid-area:tabs;flex-direction:column;border-bottom:none;border-right:1px solid var(--vk-line);width:52px;flex-shrink:0;align-items:stretch;overflow-y:auto;overflow-x:hidden;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_tabs:hover{width:104px;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_tab{align-items:center;gap:10px;padding:10px 12px;border-right:none;border-bottom:1px solid var(--vk-line-soft);display:flex;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_tab .__kp_tab_glyph{width:22px;height:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid var(--vk-line-soft);}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_tab .__kp_tab_label{display:none;white-space:nowrap;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_tabs:hover .__kp_tab .__kp_tab_label{display:inline;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_body{grid-area:body;flex-direction:column;gap:0;min-height:0;}' +
	'#__vesk_dev[data-sidebar="rail"] .__kp_pane{flex:1;min-width:0;min-height:0;}' +
	'.__kp_pl_actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;}' +
	'#__vesk_dev .__kp_pl_view{all:unset;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--vk-muted);border:1px solid var(--vk-line-soft);padding:4px 10px;transition:color .12s ease,background .12s ease,border-color .12s ease;}' +
	'#__vesk_dev .__kp_pl_view:hover{color:var(--vk-fg);border-color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_pl_view.active{color:var(--vk-inv-fg);background:var(--vk-inv-bg);border-color:var(--vk-border);}' +
	'#__vesk_dev .__kp_pl_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:8px;}' +
	'#__vesk_dev .__kp_pl_card{background:var(--vk-soft);border:1px solid var(--vk-line-soft);padding:10px;cursor:pointer;transition:border-color .12s ease,background .12s ease;}' +
	'#__vesk_dev .__kp_pl_card:hover{border-color:var(--vk-dim);background:var(--vk-soft-hi);}' +
	'#__vesk_dev .__kp_pl_head{display:flex;align-items:flex-start;gap:8px;}' +
	'#__vesk_dev .__kp_pl_icon{width:28px;height:28px;flex-shrink:0;border:1px solid var(--vk-line-soft);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:var(--vk-fg);background:var(--vk-codebg);}' +
	'#__vesk_dev .__kp_pl_icon img{width:100%;height:100%;object-fit:contain;}' +
	'#__vesk_dev .__kp_pl_name{font-weight:700;color:var(--vk-fg);flex:1;overflow-wrap:anywhere;}' +
	'#__vesk_dev .__kp_pl_versions{font-size:11px;color:var(--vk-muted);}' +
	'#__vesk_dev .__kp_pl_desc{font-size:11px;color:var(--vk-muted);margin-top:6px;}' +
	'#__vesk_dev .__kp_pl_meta{font-size:11px;color:var(--vk-dim);margin-top:6px;word-break:break-all;}' +
	'#__vesk_dev .__kp_pl_keywords{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;}' +
	'#__vesk_dev .__kp_pl_kw{font-size:10px;color:var(--vk-muted);border:1px solid var(--vk-line-soft);padding:1px 6px;}' +
	'#__vesk_dev .__kp_pl_badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 6px;border:1px solid currentColor;flex-shrink:0;}' +
	'#__vesk_dev .__kp_pl_badge.ok{color:var(--vk-inv-fg);background:var(--vk-inv-bg);}' +
	'#__vesk_dev .__kp_pl_badge.off{color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_pl_badge.on{color:#3fb950;}' +
	'#__vesk_dev .__kp_pl_err{font-size:11px;color:var(--vk-inv-fg);background:var(--vk-inv-bg);padding:4px 8px;margin-top:6px;font-weight:700;}' +
	'#__vesk_dev .__kp_pl_list{margin-top:8px;}' +
	'#__vesk_dev .__kp_pl_row{display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid var(--vk-line-soft);cursor:pointer;}' +
	'#__vesk_dev .__kp_pl_row:hover{background:var(--vk-soft);}' +
	'#__vesk_dev .__kp_pl_row_info{flex:1;min-width:0;}' +
	'#__vesk_dev .__kp_pl_row_name{font-weight:700;color:var(--vk-fg);}' +
	'#__vesk_dev .__kp_pl_row_sub{font-size:11px;color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_pl_detail{font-size:12px;color:var(--vk-muted);}' +
	'#__vesk_dev .__kp_pl_detail b{color:var(--vk-fg);}' +
	'#__vesk_dev .__kp_pl_btn{all:unset;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--vk-fg);border:1px solid var(--vk-line-soft);padding:4px 8px;transition:color .12s ease,background .12s ease,border-color .12s ease;}' +
	'#__vesk_dev .__kp_pl_btn:hover{background:var(--vk-soft-hi);border-color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_pl_btn[disabled]{opacity:.4;cursor:not-allowed;}' +
	'#__vesk_dev .__kp_pl_btn.danger{color:var(--vk-inv-fg);background:var(--vk-inv-bg);}' +
	'#__vesk_dev .__kp_pl_pkg{font-size:11px;color:var(--vk-dim);word-break:break-all;margin:2px 0 8px;}' +
	'#__vesk_dev .__kp_pl_search{display:flex;gap:6px;margin:10px 0;}' +
	'#__vesk_dev .__kp_pl_q{flex:1;background:var(--vk-codebg);border:1px solid var(--vk-line-soft);color:var(--vk-fg);font-family:inherit;font-size:12px;padding:6px 8px;}' +
	'#__vesk_dev .__kp_pl_q::placeholder{color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_pl_suggest{margin:4px 0 10px;}' +
	'#__vesk_dev .__kp_pl_export{background:var(--vk-codebg);border:1px solid var(--vk-line-soft);padding:10px;margin-top:4px;}' +
	'#__vesk_dev .__kp_pl_export dt{font-weight:700;color:var(--vk-fg);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-top:8px;}' +
	'#__vesk_dev .__kp_pl_export dd{font-size:11px;color:var(--vk-muted);margin:2px 0 0;word-break:break-all;}' +
	'#__vesk_dev .__kp_pl_export .__kp_pl_ex_item{font-size:11px;color:var(--vk-muted);padding:1px 0;}' +
	'#__vesk_dev .__kp_pl_toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;}';


export function createDevClient(opts?: DevClientOptions): { dispose(): void } {
	if (typeof document === 'undefined') return { dispose(): void {} };

	const urls = resolveUrls(opts);
	const global = globalThis as Record<string, unknown>;
	const win = globalThis as unknown as Window;
	const doc = document;

	let host = urls.wsUrl || '';
	if (!host) {
		const proto = win.location.protocol === 'https:' ? 'wss:' : 'ws:';
		host = proto + '//' + win.location.host + '/_vesk/hmr';
	}

	let ws: WebSocket | null = null;
	let status: string = 'idle';
	let lastError: HmrErrorPayload | null = null;
	let lastCompileMs = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const plugins: PluginRecord[] = [];
	let pluginsError: string | null = null;
	let diagnostics: DevDiagnostic[] = [];
	let diagnosticsError: string | null = null;
	const log: HmrLogEntry[] = [];

	let pluginDetail: string | null = null;
	let pluginDetailMsg: string | null = null;
	let pluginView: 'list' | 'search' = 'list';
	let pluginSearchResults: PluginSearchResult[] = [];
	let pluginSearchQuery = '';
	let pluginSearchError: string | null = null;
	let pluginSearchLoading = false;
	let pluginExports: PluginExportsData | null = null;
	let pluginExportsError: string | null = null;
	let pluginDetailSearch: PluginSearchResult | null = null;
	let pluginInstalling: string | null = null;

	let dotEl: HTMLElement | null = null;
	let panelEl: HTMLElement | null = null;
	let panelOpen = false;
	let activeTab: string = 'overview';
	let overlayEl: HTMLElement | null = null;

	let ui: DevtoolState = loadDevtoolState(getStorage());

	let panelW = ui.w;
	let panelH = ui.h;

	function logEvent(type: string, ms: number | undefined): void {
		log.push({ type, ms, time: ms, ts: Date.now() });
		if (log.length > 30) log.shift();
	}

	function setStatus(next: string): void {
		status = next;
		updateDot();
		renderPanel();
	}

	function updateDot(): void {
		if (!doc.getElementById('__vesk_dev')) createDot();
		const d = doc.querySelector('#__vesk_dev .__v_dot');
		if (d) d.className = '__v_dot ' + status;
	}

	function effectiveTheme(): 'light' | 'dark' {
		if (ui.theme !== 'system') return ui.theme;
		if (typeof matchMedia === 'function') {
			return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
		}
		return 'dark';
	}

	function applyPrefs(): void {
		const theme = effectiveTheme();
		if (dotEl) dotEl.setAttribute('data-theme', theme);
		if (overlayEl) overlayEl.setAttribute('data-theme', theme);
		if (dotEl) dotEl.setAttribute('data-pos', ui.pos);
		if (dotEl) dotEl.setAttribute('data-sidebar', ui.sidebarMode);
		if (typeof matchMedia === 'function') {
			const mq = matchMedia('(prefers-color-scheme: light)');
			if (ui.theme === 'system') {
				mq.addEventListener?.('change', applyPrefs);
			}
		}
		renderPanel();
	}

	function changePref(key: string, val: string): void {
		if (key === 'theme' && (val === 'system' || val === 'light' || val === 'dark')) {
			ui.theme = val;
		} else if (key === 'pos' && (val === 'left' || val === 'right')) {
			ui.pos = val;
		} else if (key === 'pluginsView' && (val === 'cards' || val === 'list')) {
			ui.pluginsView = val;
		} else if (key === 'sidebarMode' && (val === 'expanded' || val === 'rail')) {
			ui.sidebarMode = val;
		} else {
			return;
		}
		persistUi();
		applyPrefs();
	}

	function persistUi(): void {
		saveDevtoolState(getStorage(), ui);
	}

	function getStorage(): Storage | null {
		try {
			return win.localStorage;
		} catch {
			return null;
		}
	}

	function connect(): void {
		try {
			ws = new WebSocket(host);
			ws.onopen = function () {
				if (disposed) return;
				clearError();
				setStatus('idle');
			};
			ws.onmessage = function (e: MessageEvent) {
				if (disposed) return;
				try {
					const msg = JSON.parse(e.data as string) as Record<string, unknown>;
					if (msg.nonce && !global.__vesk_hmr_nonce) {
						global.__vesk_hmr_nonce = msg.nonce;
					}
					const type = msg.type as string;
					switch (type) {
						case 'update':
							handleUpdate(msg);
							break;
						case 'reload':
							win.location.reload();
							break;
						case 'error':
							handleError(msg as unknown as HmrErrorPayload);
							break;
						case 'css-update':
							handleCssUpdate();
							break;
						case 'compiling':
							clearError();
							setStatus('compiling');
							break;
					}
				} catch {
					/* ignore bad messages */
				}
			};
			ws.onclose = function () {
				if (disposed) return;
				if (status !== 'error') setStatus('idle');
				scheduleReconnect();
			};
			ws.onerror = function () {
				if (disposed) return;
				if (status !== 'error') setStatus('idle');
				scheduleReconnect();
			};
		} catch {
			/* WebSocket unavailable */
		}
	}

	function scheduleReconnect(): void {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = setTimeout(connect, 3000);
	}

	function handleUpdate(msg: Record<string, unknown>): void {
		if (msg.fnSources && typeof msg.fnSources === 'object') {
			const evaler =
				(global.__vesk_hmr_eval as ((c: string, n?: string) => unknown) | undefined) ||
				function (c: string) {
					try {
						return eval(c);
					} catch (ex) {
						console.error('HMR eval error:', ex);
					}
				};
			Object.values(msg.fnSources as Record<string, string>).forEach(function (fn: string) {
				evaler(fn, msg.nonce as string | undefined);
			});
		}
		global.__updatedComponents = new Set(Object.keys((msg.components || {}) as Record<string, unknown>));
		const router = global.__vesk_router as { hmrUpdate?: () => void } | undefined;
		if (router && typeof router.hmrUpdate === 'function') {
			router.hmrUpdate();
		}
		lastCompileMs = (msg.time as number) || 0;
		status = 'connected';
		clearError();
		renderPanel();
		logEvent('update', lastCompileMs);
	}

	function handleCssUpdate(): void {
		doc.querySelectorAll('link[rel="stylesheet"]').forEach(function (el) {
			const parent = el.parentNode;
			if (!parent) return;
			const fresh = doc.createElement('link');
			fresh.rel = 'stylesheet';
			fresh.href = (el as HTMLLinkElement).href.split('?')[0] + '?t=' + Date.now();
			fresh.onload = function () {
				el.remove();
			};
			fresh.onerror = function () {
				fresh.remove();
			};
			parent.insertBefore(fresh, el.nextSibling);
		});
		status = 'connected';
		renderPanel();
		logEvent('css-update', undefined);
	}

	function handleError(payload: HmrErrorPayload): void {
		status = 'error';
		lastError = payload;
		showOverlay(payload);
		logEvent('error', undefined);
		renderPanel();
	}

	function clearError(): void {
		lastError = null;
		dismissOverlay();
	}

	function createOverlay(): void {
		if (doc.getElementById('__vesk_overlay')) return;
		overlayEl = doc.createElement('div');
		overlayEl.id = '__vesk_overlay';
		overlayEl.setAttribute('data-theme', effectiveTheme());
		overlayEl.innerHTML =
			'<style>' +
			CSS +
			'</style>' +
			'<div class="__vo_backdrop"></div>' +
			'<div class="__vo_panel">' +
			'  <div class="__vo_header">' +
			'    <div class="__vo_title">&gt; COMPILATION ERROR</div>' +
			'    <button class="__vo_close" id="__vo_close">&times;</button>' +
			'  </div>' +
			'  <div class="__vo_body">' +
			'    <div class="__vo_file" id="__vo_file"></div>' +
			'    <div class="__vo_message" id="__vo_message"></div>' +
			'    <div class="__vo_code" id="__vo_code"></div>' +
			'    <div class="__vo_tips" id="__vo_tips"></div>' +
			'    <details class="__vo_stack">' +
			'      <summary>Stack trace</summary>' +
			'      <pre id="__vo_stack"></pre>' +
			'    </details>' +
			'  </div>' +
			'  <div class="__vo_footer">VESK DEV - CLICK X TO DISMISS</div>' +
			'</div>';
		doc.body.appendChild(overlayEl);
		(doc.getElementById('__vo_close') as HTMLElement).onclick = dismissOverlay;
		overlayEl.querySelector('.__vo_backdrop')!.addEventListener('click', dismissOverlay);
		doc.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('open')) dismissOverlay();
		});
	}

	function showOverlay(payload: HmrErrorPayload): void {
		if (!overlayEl) createOverlay();
		overlayEl = doc.getElementById('__vesk_overlay') as HTMLElement | null;
		if (!overlayEl) return;
		const nodes = buildErrorNodes(payload);
		(doc.getElementById('__vo_file') as HTMLElement).innerHTML = nodes.file;
		(doc.getElementById('__vo_message') as HTMLElement).textContent = payload.message || 'Unknown error';
		(doc.getElementById('__vo_code') as HTMLElement).innerHTML = nodes.codeframe;
		(doc.getElementById('__vo_tips') as HTMLElement).innerHTML = nodes.lists;
		(doc.getElementById('__vo_stack') as HTMLElement).textContent = nodes.stack;
		overlayEl.classList.add('open');
	}

	function dismissOverlay(): void {
		if (overlayEl) overlayEl.classList.remove('open');
	}

	function createDot(): void {
		if (doc.getElementById('__vesk_dev')) return;
		dotEl = doc.createElement('div');
		dotEl.id = '__vesk_dev';
		dotEl.setAttribute('data-pos', ui.pos);
		dotEl.setAttribute('data-theme', effectiveTheme());
		dotEl.innerHTML =
			'<style>' +
			CSS +
			'</style>' +
			'<div class="__v_bar">' +
			'  <span class="__v_dot idle"></span>' +
			'  <span class="__v_label">Vesk</span>' +
			'  <span class="__v_version">dev</span>' +
			'</div>';
		(dotEl.querySelector('.__v_bar') as HTMLElement).addEventListener('click', togglePanel);
		doc.body.appendChild(dotEl);
		createPanel();
	}

	function createPanel(): void {
		if (!dotEl) return;
		panelEl = doc.createElement('div');
		panelEl.className = '__kp hidden';
		panelEl.style.width = panelW + 'px';
		panelEl.style.height = panelH + 'px';
		panelEl.innerHTML =
			'<div class="__kp_head">' +
			'  <div class="__kp_title">&gt; VESK DEV</div>' +
			'  <button class="__kp_max" id="__kp_max" title="expand/collapse">[+]</button>' +
			'  <button class="__kp_close" id="__kp_close">[x]</button>' +
			'</div>' +
			renderTabBar(activeTab, ui.sidebarMode) +
			'<div class="__kp_body">' +
			'  <div id="__kp_content"></div>' +
			'</div>' +
			'<div class="__kp_handle" id="__kp_handle" title="resize"></div>';
		dotEl.appendChild(panelEl);
		(doc.getElementById('__kp_close') as HTMLElement).onclick = function () {
			panelOpen = false;
			ui.open = false;
			persistUi();
			if (panelEl) panelEl.classList.add('hidden');
		};
		(doc.getElementById('__kp_max') as HTMLElement).onclick = function () {
			if (!panelEl) return;
			const maxed = panelEl.classList.toggle('maxed');
			ui.maxed = maxed;
			if (maxed) {
				panelEl.style.width = '';
				panelEl.style.height = '';
			} else {
				clampPanelSize();
				panelEl.style.width = panelW + 'px';
				panelEl.style.height = panelH + 'px';
			}
			persistUi();
			const mb = doc.getElementById('__kp_max');
			if (mb) mb.textContent = maxed ? '[-]' : '[+]';
		};
		const tabsEl = panelEl.querySelector('.__kp_tabs');
		if (tabsEl) {
			tabsEl.addEventListener('click', function (e) {
				const btn = (e.target as HTMLElement).closest('.__kp_tab') as HTMLElement | null;
				if (!btn) return;
				const tab = btn.getAttribute('data-tab') || 'overview';
				if (tab === 'plugins') refreshPlugins();
				if (tab === 'diagnostics') refreshDiagnostics();
				setTab(tab);
			});
		}
		(doc.getElementById('__kp_content') as HTMLElement).addEventListener('click', function (e) {
			gpClickHandler(e);
		});
		initResize();
		refreshPlugins();
		refreshDiagnostics();
	}

	function clampPanelSize(): void {
		const maxW = win.innerWidth - PANEL_EDGE - PANEL_MARGIN;
		const maxH = win.innerHeight - PANEL_EDGE - PANEL_MARGIN;
		panelW = Math.max(PANEL_MIN_W, Math.min(panelW, maxW));
		panelH = Math.max(PANEL_MIN_H, Math.min(panelH, maxH));
	}

	function initResize(): void {
		const handle = doc.getElementById('__kp_handle');
		if (!handle || !panelEl) return;
		handle.addEventListener('pointerdown', function (e: PointerEvent) {
			if (!panelEl || panelEl.classList.contains('maxed')) return;
			e.preventDefault();
			const startX = e.clientX;
			const startY = e.clientY;
			const startW = panelEl.offsetWidth;
			const startH = panelEl.offsetHeight;
			const maxW = win.innerWidth - PANEL_EDGE - PANEL_MARGIN;
			const maxH = win.innerHeight - PANEL_EDGE - PANEL_MARGIN;
			panelEl.classList.add('resizing');
			handle.classList.add('resizing');
			function onMove(ev: PointerEvent) {
				if (!panelEl) return;
				let w = startW + (ev.clientX - startX);
				let h = startH + (ev.clientY - startY);
				if (w >= maxW - 10) w = maxW;
				w = Math.max(PANEL_MIN_W, Math.min(w, maxW));
				h = Math.max(PANEL_MIN_H, Math.min(h, maxH));
				panelW = w;
				panelH = h;
				panelEl.style.width = w + 'px';
				panelEl.style.height = h + 'px';
			}
			function onUp() {
				if (panelEl) panelEl.classList.remove('resizing');
				handle?.classList.remove('resizing');
				doc.removeEventListener('pointermove', onMove);
				doc.removeEventListener('pointerup', onUp);
				doc.removeEventListener('pointercancel', onUp);
				ui.w = panelW;
				ui.h = panelH;
				persistUi();
			}
			doc.addEventListener('pointermove', onMove);
			doc.addEventListener('pointerup', onUp);
			doc.addEventListener('pointercancel', onUp);
		});
		win.addEventListener('resize', function () {
			if (!panelEl) return;
			if (!panelEl.classList.contains('maxed')) {
				clampPanelSize();
				panelEl.style.width = panelW + 'px';
				panelEl.style.height = panelH + 'px';
			}
			clampPanelSize();
		});
	}

	function setTab(tab: string): void {
		activeTab = tab;
		ui.activeTab = tab;
		persistUi();
		const tabs = panelEl && panelEl.querySelectorAll('.__kp_tab');
		if (tabs) {
			Array.prototype.forEach.call(tabs, function (t: HTMLElement) {
				t.classList.toggle('active', t.getAttribute('data-tab') === tab);
			});
		}
		renderPanel();
	}

	function togglePanel(): void {
		panelOpen = !panelOpen;
		ui.open = panelOpen;
		persistUi();
		if (!panelEl) createPanel();
		if (panelOpen) {
			if (panelEl) panelEl.classList.remove('hidden');
			renderPanel();
		} else {
			if (panelEl) panelEl.classList.add('hidden');
		}
	}

	function renderPanel(): void {
		if (!doc.getElementById('__vesk_dev')) createDot();
		if (!panelEl) return;
		if (!panelOpen) return;

		const content = doc.getElementById('__kp_content');
		if (!content) return;

		const renderers: Record<string, () => string> = {
			overview: () =>
				renderOverviewPanel({
					host: win.location.host,
					lastCompileMs,
					lastError,
				}),
			errors: () => renderErrorsPanel(lastError),
			diagnostics: () =>
				diagnosticsError
					? '<div class="__kp_line">' + escapeHtml(diagnosticsError) + '</div>'
					: renderDiagnosticsPanel(diagnostics),
			plugins: () => renderPluginsTab(),
			log: () => renderLogPanel(log),
			settings: () => renderSettingsPanel(ui),
		};
		const renderTab: (() => string) | undefined = renderers[activeTab];
		const html = renderTab ? renderTab() : '<div class="__kp_line">unknown tab: ' + escapeHtml(activeTab) + '</div>';
		content.innerHTML = '<div class="__kp_pane" data-tab="' + escapeHtml(activeTab) + '">' + html + '</div>';
		const pane = content.firstElementChild as HTMLElement | null;
		if (pane) {
			pane.scrollTop = 0;
			void pane.offsetWidth;
		}
	}

	function renderPluginsTab(): string {
		const installedPackages: string[] = [];
		for (const p of plugins) {
			const nm = p.package || p.name;
			if (nm && installedPackages.indexOf(nm) < 0) installedPackages.push(nm);
		}
		if (pluginDetailSearch) {
			return renderSearchPluginDetail(pluginDetailSearch, pluginInstalling, installedPackages);
		}
		if (pluginDetail != null) {
			const p = plugins.find((x) => x.name === pluginDetail);
			if (pluginExports) {
				const ex = pluginExports;
				return renderPluginExports(ex, pluginExportsError);
			}
			if (p) {
				return renderPluginDetail(p, pluginDetailMsg);
			}
			return '<div class="__kp_line">plugin not found</div>';
		}
		if (pluginView === 'search') {
			return renderPluginSearch(
				pluginSearchQuery,
				pluginSearchResults,
				pluginSearchError,
				pluginSearchLoading,
				pluginInstalling,
				installedPackages
			);
		}
		return renderPluginsPanel(plugins, pluginsError, ui.pluginsView);
	}

	function refreshPlugins(): void {
		if (typeof fetch === 'undefined') return;
		fetch(urls.pluginsUrl)
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.then(function (data: unknown) {
				const arr = Array.isArray(data) ? data : (data as { plugins?: unknown[] }).plugins;
				plugins.length = 0;
				if (Array.isArray(arr)) {
					for (const raw of arr) {
						plugins.push(mapPluginRecord(raw));
					}
				}
				pluginsError = null;
				renderPanel();
			})
			.catch(function (e: unknown) {
				pluginsError = 'plugins unavailable: ' + (e instanceof Error ? e.message : String(e));
				renderPanel();
			});
	}

	function refreshDiagnostics(): void {
		if (typeof fetch === 'undefined') return;
		fetch(urls.diagnosticsUrl)
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.then(function (data: unknown) {
				const list = (data as { diagnostics?: unknown[] }).diagnostics;
				diagnostics.length = 0;
				if (Array.isArray(list)) {
					for (const raw of list) {
						diagnostics.push(mapDiagnostic(raw));
					}
				}
				diagnosticsError = null;
				renderPanel();
			})
			.catch(function (e: unknown) {
				diagnosticsError = 'diagnostics unavailable: ' + (e instanceof Error ? e.message : String(e));
				renderPanel();
			});
	}

	function mapDiagnostic(raw: unknown): DevDiagnostic {
		const d = (raw || {}) as Partial<DevDiagnostic>;
		const sev: DevDiagnostic['severity'] =
			d.severity === 'error' || d.severity === 'warning' || d.severity === 'info' ? d.severity : 'info';
		return {
			severity: sev,
			code: String(d.code || ''),
			file: d.file != null ? String(d.file) : null,
			line: typeof d.line === 'number' ? d.line : null,
			column: typeof d.column === 'number' ? d.column : null,
			message: String(d.message || ''),
			hint: d.hint != null ? String(d.hint) : null,
		};
	}

	function mapPluginRecord(raw: unknown): PluginRecord {
		const p = (raw || {}) as Partial<PluginRecord>;
		return {
			name: String(p.name || ''),
			package: String(p.package || p.name || ''),
			path: p.path != null ? String(p.path) : null,
			active: !!p.active,
			installed: !!p.installed,
			version: p.version != null && p.version !== '' ? String(p.version) : null,
			latest: p.latest != null && p.latest !== '' ? String(p.latest) : null,
			description: p.description != null ? String(p.description) : null,
			author: p.author != null ? String(p.author) : null,
			license: p.license != null ? String(p.license) : null,
			homepage: p.homepage != null ? String(p.homepage) : null,
			repository: p.repository != null ? String(p.repository) : null,
			updatedAt: p.updatedAt != null ? String(p.updatedAt) : null,
			keywords: Array.isArray(p.keywords) ? p.keywords.map((k) => String(k)) : [],
			iconUrl: p.iconUrl != null ? String(p.iconUrl) : null,
			metaSource: p.metaSource === 'vesk.meta.json' || p.metaSource === 'package.json' ? p.metaSource : 'none',
			source: p.source === 'config' ? 'config' : 'state',
			error: p.error != null ? String(p.error) : null,
		};
	}

	function openPlugin(name: string): void {
		pluginDetail = name;
		pluginDetailMsg = null;
		pluginDetailSearch = null;
		pluginExports = null;
		pluginExportsError = null;
		pluginInstalling = null;
		renderPanel();
	}

	function openSearchResult(r: PluginSearchResult): void {
		pluginDetailSearch = r;
		pluginDetail = null;
		pluginExports = null;
		pluginExportsError = null;
		pluginDetailMsg = null;
		pluginView = 'search';
		renderPanel();
	}

	function backFromPlugin(): void {
		pluginDetail = null;
		pluginDetailSearch = null;
		pluginExports = null;
		pluginExportsError = null;
		pluginDetailMsg = null;
		if (pluginView === 'search') {
			pluginView = 'list';
			pluginSearchResults = [];
			pluginSearchError = null;
		}
		refreshPlugins();
		renderPanel();
	}

	function pluginMutation(
		path: string,
		body: Record<string, string>
	): void {
		if (typeof fetch === 'undefined') {
			pluginDetailMsg = 'fetch unavailable';
			renderPanel();
			return;
		}
		pluginDetailMsg = 'applying...';
		renderPanel();
		fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
			.then(function (r) {
				if (!r.ok) return r.json().catch(function () {
					return { error: 'HTTP ' + r.status };
				}).then(function (body2: { error?: string }) {
					throw new Error(body2.error || 'HTTP ' + r.status);
				});
				return r.json();
			})
			.then(function () {
				runPluginAction(path, body);
			})
			.catch(function (e: unknown) {
				pluginDetailMsg = (e instanceof Error ? e.message : String(e));
				refreshPlugins();
				renderPanel();
			});
	}

	function runPluginAction(path: string, body: Record<string, string>): void {
		pluginDetailMsg = 'done \u2014 reloading';
		renderPanel();
	}

	function loadPluginExports(name: string): void {
		if (typeof fetch === 'undefined') {
			pluginExportsError = 'fetch unavailable';
			renderPanel();
			return;
		}
		pluginExports = null as unknown as PluginExportsData;
		pluginExportsError = null;
		renderPanel();
		fetch(urls.pluginsUrl + '/' + encodeURIComponent(name) + '/exports')
			.then(function (r) {
				return r.json().then(function (body: PluginExportsData) {
					if (!r.ok) throw new Error((body && body.error) || 'HTTP ' + r.status);
					return body;
				});
			})
			.then(function (body: PluginExportsData) {
				pluginExports = body;
				renderPanel();
			})
			.catch(function (e: unknown) {
				pluginExports = null;
				pluginExportsError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
	}

	function searchPlugins(q: string): void {
		if (typeof fetch === 'undefined') {
			pluginSearchError = 'fetch unavailable';
			renderPanel();
			return;
		}
		pluginSearchQuery = q;
		pluginSearchLoading = true;
		pluginSearchError = null;
		renderPanel();
		fetch(urls.pluginsUrl + '/search?q=' + encodeURIComponent(q))
			.then(function (r) {
				return r.json().then(function (body: { error?: string; results?: unknown[] }) {
					if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
					return body;
				});
			})
			.then(function (body: { results?: unknown[] }) {
				pluginSearchLoading = false;
				pluginSearchResults = (Array.isArray(body.results) ? body.results : []).map(function (rr) {
					const r = (rr || {}) as Partial<PluginSearchResult>;
					return {
						name: String(r.name || ''),
						version: r.version != null ? String(r.version) : '',
						description: r.description != null ? String(r.description) : '',
						author: r.author != null ? String(r.author) : '',
						date: r.date != null ? String(r.date) : '',
						keywords: Array.isArray(r.keywords) ? r.keywords.map((k) => String(k)) : [],
					};
				});
				renderPanel();
			})
			.catch(function (e: unknown) {
				pluginSearchLoading = false;
				pluginSearchResults = [];
				pluginSearchError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
	}

	function gpClickHandler(e: Event): void {
		const target = e.target as HTMLElement;
		const opt = target.closest('.__kp_opt') as HTMLElement | null;
		if (opt) {
			const key = opt.getAttribute('data-key');
			const val = opt.getAttribute('data-val');
			if (key && val) {
				changePref(key, val);
				return;
			}
		}
		const viewBtn = target.closest('[data-pl-view]') as HTMLElement | null;
		if (viewBtn) {
			const v = viewBtn.getAttribute('data-pl-view');
			if (v === 'cards' || v === 'list') {
				ui.pluginsView = v;
				persistUi();
				renderPanel();
				return;
			}
		}
		const searchEntry = target.closest('[data-pl-search]') as HTMLElement | null;
		if (searchEntry) {
			pluginView = 'search';
			pluginSearchResults = [];
			pluginSearchError = null;
			renderPanel();
			return;
		}
		if (target.closest('[data-pl-back]')) {
			backFromPlugin();
			return;
		}
		const suggest = target.closest('[data-pl-suggest]') as HTMLElement | null;
		if (suggest) {
			const q = suggest.getAttribute('data-pl-suggest') || '';
			searchPlugins(q);
			return;
		}
		if (target.closest('[data-pl-search-go]')) {
			const q = (doc.getElementById('__kp_pl_q') as HTMLInputElement | null)?.value || '';
			searchPlugins(q);
			return;
		}
		const installBtn = target.closest('[data-pl-install]') as HTMLElement | null;
		if (installBtn) {
			const pkg = installBtn.getAttribute('data-pl-install') || '';
			pluginInstall(pkg);
			return;
		}
		const detailOpen = target.closest('[data-search-pkg-open]') as HTMLElement | null;
		if (detailOpen) {
			const name = detailOpen.getAttribute('data-search-pkg-open') || '';
			const hit = pluginSearchResults.find((rr) => rr.name === name);
			if (hit) openSearchResult(hit);
			return;
		}
		const searchRow = target.closest('[data-search-pkg]') as HTMLElement | null;
		if (searchRow && !target.closest('[data-pl-install],[data-search-pkg-open]')) {
			const name = searchRow.getAttribute('data-search-pkg') || '';
			const hit = pluginSearchResults.find((rr) => rr.name === name);
			if (hit) openSearchResult(hit);
			return;
		}
		const exportsBtn = target.closest('[data-pl-exports]') as HTMLElement | null;
		if (exportsBtn) {
			const name = exportsBtn.getAttribute('data-name') || '';
			loadPluginExports(name);
			return;
		}
		const actBtn = target.closest('[data-pl-act]') as HTMLElement | null;
		if (actBtn) {
			const act = actBtn.getAttribute('data-pl-act');
			const name = actBtn.getAttribute('data-name');
			const pkg = actBtn.getAttribute('data-package');
			if (act === 'activate' && name) pluginMutation('/__vesk/plugins/activate', { name });
			else if (act === 'deactivate' && name) pluginMutation('/__vesk/plugins/deactivate', { name });
			else if (act === 'update' && pkg) pluginMutation('/__vesk/plugins/update', { package: pkg });
			else if (act === 'uninstall' && pkg) confirmUninstall(pkg);
			return;
		}
		const card = target.closest('[data-plugin]') as HTMLElement | null;
		if (card) {
			const name = card.getAttribute('data-plugin') || '';
			openPlugin(name);
			return;
		}
	}

	function pluginInstall(pkg: string): void {
		if (typeof fetch === 'undefined') {
			pluginSearchError = 'fetch unavailable';
			renderPanel();
			return;
		}
		if (pluginInstalling === pkg) return;
		pluginInstalling = pkg;
		pluginSearchError = null;
		renderPanel();
		fetch('/__vesk/plugins/install', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ package: pkg }),
		})
			.then(function (r) {
				return r.json().catch(function () {
					return {};
				}).then(function (body: { error?: string }) {
					if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
				});
			})
			.then(function () {
				pluginInstalling = null;
				pluginSearchError = 'installed \u2014 reloading';
				renderPanel();
			})
			.catch(function (e: unknown) {
				pluginInstalling = null;
				pluginSearchError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
	}

	function confirmUninstall(pkg: string): void {
		if (pluginDetailMsg === 'confirm uninstall?') {
			pluginDetailMsg = null;
			pluginMutation('/__vesk/plugins/uninstall', { package: pkg });
			return;
		}
		pluginDetailMsg = 'confirm uninstall?';
		renderPanel();
	}

	function loadPersistedState(): void {
		if (typeof fetch === 'undefined') return;
		fetch(urls.stateUrl)
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.then(function (data: unknown) {
				const payload = data as { error?: HmrErrorPayload };
				if (payload && payload.error) {
					lastError = payload.error;
					status = 'error';
					showOverlay(payload.error);
					renderPanel();
				}
			})
			.catch(function () {
				/* state endpoint optional */
			});
	}

	registerGlobalHmr({
		show: handleError,
		dismiss: dismissOverlay,
	});

	connect();
	loadPersistedState();

	function boot(): void {
		if (disposed) return;
		createDot();
		applyPrefs();
		if (panelEl) {
			clampPanelSize();
			ui.w = panelW;
			ui.h = panelH;
			persistUi();
			if (ui.maxed) {
				panelEl.classList.add('maxed');
				panelEl.style.width = '';
				panelEl.style.height = '';
			} else {
				panelEl.style.width = panelW + 'px';
				panelEl.style.height = panelH + 'px';
			}
			if (ui.open) {
				panelOpen = true;
				panelEl.classList.remove('hidden');
			}
		}
		setTab(ui.activeTab);
	}

	if (doc.body) {
		boot();
	} else {
		doc.addEventListener('DOMContentLoaded', function () {
			boot();
		});
	}

	return {
		dispose(): void {
			disposed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			if (ws) {
				try {
					ws.close();
				} catch {
					/* ignore */
				}
			}
			if (dotEl && dotEl.parentNode) dotEl.parentNode.removeChild(dotEl);
			if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
		},
	};
}

if (typeof document !== 'undefined') {
	createDevClient();
}
