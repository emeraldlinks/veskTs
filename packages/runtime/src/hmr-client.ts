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

export const DEV_TABS: string[] = ['overview', 'agentic', 'errors', 'diagnostics', 'plugins', 'log', 'settings'];

export const DEV_STATE_KEY = 'veskDevPrefs';

export const PANEL_MIN_W = 320;
export const PANEL_MIN_H = 200;
export const PANEL_MARGIN = 8;
export const PANEL_EDGE = 16;

export const AGENTIC_PROVIDERS: string[] = ['openai', 'anthropic', 'google', 'ollama', 'opencode', 'opencode-go', 'openrouter', 'loopers', 'custom'];

export const AGENTIC_MODES = ['explore', 'debug', 'agent'] as const;
export type AgenticMode = (typeof AGENTIC_MODES)[number];

export const AGENTIC_SLASH_COMMANDS: string[] = ['/help', '/clear', '/checkpoint', '/rollback', '/provider', '/model', '/models', '/tools', '/commands', '/mode', '/config', '/history'];

export const AGENTIC_MODELS_URL = '/__vesk/agent/models';

export function isAgenticMode(v: string): v is AgenticMode {
	return (AGENTIC_MODES as readonly string[]).indexOf(v) !== -1;
}

export const SETTINGS_SUB_TABS = ['devtools', 'agentic', 'vesk'] as const;
export type SettingsSubTab = (typeof SETTINGS_SUB_TABS)[number];

export function isSettingsSubTab(v: string): v is SettingsSubTab {
	return (SETTINGS_SUB_TABS as readonly string[]).indexOf(v) !== -1;
}

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
	agenticProvider: string;
	agenticModel: string;
	agenticMode: AgenticMode;
	agenticModels: string[];
	settingsSubTab: SettingsSubTab;
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
		agenticProvider: 'openai',
		agenticModel: '',
		agenticMode: 'explore',
		agenticModels: [],
		settingsSubTab: 'devtools',
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
			if (typeof parsed.agenticProvider === 'string' && AGENTIC_PROVIDERS.indexOf(parsed.agenticProvider) !== -1) {
				state.agenticProvider = parsed.agenticProvider;
			}
			if (typeof parsed.agenticModel === 'string' && parsed.agenticModel.length > 0) {
				state.agenticModel = parsed.agenticModel;
			}
			if (typeof parsed.agenticMode === 'string' && isAgenticMode(parsed.agenticMode)) {
				state.agenticMode = parsed.agenticMode;
			}
			if (Array.isArray(parsed.agenticModels)) {
				state.agenticModels = (parsed.agenticModels as unknown[]).filter((v) => typeof v === 'string' && (v as string).length > 0) as string[];
			}
			if (typeof parsed.settingsSubTab === 'string' && isSettingsSubTab(parsed.settingsSubTab)) {
				state.settingsSubTab = parsed.settingsSubTab;
			}
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

export interface AgenticConfigState {
	provider: string;
	model: string;
	models: string[];
	modelsLoading?: boolean;
	modelsError?: string | null;
	baseUrl: string;
	mode: AgenticMode;
	maxSteps: number;
	apiKeys: Record<string, string>;
	hasKeys: Record<string, boolean>;
	keyPreviews: Record<string, string | null>;
	loading?: boolean;
	error?: string | null;
	saving?: boolean;
	saveError?: string | null;
	saveOk?: string | null;
}

export function defaultAgenticConfigState(): AgenticConfigState {
	return {
		provider: 'openai',
		model: '',
		models: [],
		modelsLoading: false,
		modelsError: null,
		baseUrl: '',
		mode: 'explore',
		maxSteps: 25,
		apiKeys: {},
		hasKeys: {},
		keyPreviews: {},
		loading: false,
		error: null,
		saving: false,
		saveError: null,
		saveOk: null,
	};
}

export function maskApiKey(key: string): string {
	if (!key) return '';
	const s = String(key).trim();
	if (s.length <= 8) return '***';
	return s.slice(0, 4) + '***' + s.slice(-4);
}

export const TAB_GLYPHS: Record<string, string> = {
	overview: 'Ov',
	agentic: 'Ag',
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

export type MdHtmlMode = 'escape' | 'allow' | 'allowlist';

export interface VeskMdConfig {
	html?: MdHtmlMode | string;
	allowTags?: string[];
}

export interface VeskSecurityCors {
	origin?: string | string[];
	methods?: string;
	headers?: string;
	credentials?: boolean;
	maxAge?: number;
}

export interface VeskSecurityRateLimit {
	windowMs?: number;
	max?: number;
}

export interface VeskSecurity {
	xFrameOptions?: string | false;
	hsts?: string | false;
	referrerPolicy?: string | false;
	contentSecurityPolicy?: boolean | string;
	autoEscape?: boolean;
	csrf?: boolean;
	cors?: VeskSecurityCors;
	trustProxy?: boolean | string;
	rateLimit?: VeskSecurityRateLimit;
	redactLogs?: boolean;
	[key: string]: unknown;
}

export interface VeskConfigData {
	appDir?: string;
	outDir?: string;
	publicDir?: string;
	routeDataCache?: number;
	md?: VeskMdConfig;
	security?: VeskSecurity | string | false | Record<string, unknown>;
	ssg?: unknown;
	[key: string]: unknown;
}

export interface VeskConfigState {
	path: string | null;
	exists: boolean;
	source: string;
	config: VeskConfigData;
	loading?: boolean;
	error?: string | null;
	saving?: boolean;
	saveError?: string | null;
	saveOk?: string | null;
	draftSource?: string;
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

export function renderSettingsDevToolsSubtab(prefs: DevPrefs): string {
	const themes: ('system' | 'light' | 'dark')[] = ['system', 'light', 'dark'];
	const positions: ('left' | 'right')[] = ['left', 'right'];
	const pluginViews: DevtoolState['pluginsView'][] = ['cards', 'list'];
	let html = '<div class="__kp_sec">&gt; DEVTOOLS</div>';
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

export function renderSettingsAgenticSubtab(state: AgenticConfigState | null | undefined): string {
	const s: AgenticConfigState = state || defaultAgenticConfigState();
	const provider = typeof s.provider === 'string' && AGENTIC_PROVIDERS.indexOf(s.provider) !== -1 ? s.provider : 'openai';
	const model = typeof s.model === 'string' ? s.model : '';
	const models = Array.isArray(s.models) ? s.models : [];
	const baseUrl = typeof s.baseUrl === 'string' ? s.baseUrl : '';
	const mode = isAgenticMode(s.mode) ? s.mode : 'explore';
	const maxSteps = typeof s.maxSteps === 'number' && Number.isFinite(s.maxSteps) ? s.maxSteps : 25;
	const apiKeys = s.apiKeys && typeof s.apiKeys === 'object' ? s.apiKeys : {};
	const hasKeys = s.hasKeys && typeof s.hasKeys === 'object' ? s.hasKeys : {};
	const keyPreviews = s.keyPreviews && typeof s.keyPreviews === 'object' ? s.keyPreviews : {};
	let html = '<div class="__kp_sec">&gt; AGENTIC</div>';
	if (s.loading) html += '<div class="__kp_line">loading agentic config...</div>';
	if (s.error) html += '<div class="__kp_pl_err">' + escapeHtml(String(s.error)) + '</div>';
	if (s.saveOk) html += '<div class="__kp_line" style="color:var(--vk-fg)"><b>' + escapeHtml(String(s.saveOk)) + '</b></div>';
	if (s.saveError) html += '<div class="__kp_pl_err">' + escapeHtml(String(s.saveError)) + '</div>';
	if (s.saving) html += '<div class="__kp_line">saving agentic config...</div>';
	html += renderAgenticProviderSelect(provider);
	html += renderAgenticModelSelect(model, models, !!s.modelsLoading, s.modelsError || null);
	html += '<div class="__kp_setlabel">BASE URL</div>';
	html += '<input class="__kp_cfg_input" data-agentic-key="baseUrl" data-agentic-baseurl placeholder="https://api.openai.com/v1" value="' + escapeHtml(baseUrl) + '">';
	html += '<div class="__kp_cfg_hint">override provider baseUrl ()</div>';
	html += renderAgenticModeToggle(mode);
	html += '<div class="__kp_setlabel">MAX STEPS</div>';
	html += '<input class="__kp_cfg_input" data-agentic-key="maxSteps" data-agentic-maxsteps type="number" min="1" max="200" step="1" value="' + escapeHtml(String(maxSteps)) + '">';
	html += '<div class="__kp_cfg_hint">steps per run (1-200) — auto-extends past this while the agent still makes progress</div>';
	html += '<div class="__kp_sec">&gt; API KEYS</div>';
	html += '<div class="__kp_cfg_hint">per-provider keys — stored server-side, previews are masked</div>';
	for (const p of AGENTIC_PROVIDERS) {
		const rawKey = typeof (apiKeys as Record<string, unknown>)[p] === 'string' ? String((apiKeys as Record<string, unknown>)[p]) : '';
		const preview = (keyPreviews as Record<string, unknown>)[p] != null ? String((keyPreviews as Record<string, unknown>)[p]) : (hasKeys as Record<string, unknown>)[p] ? '••••' : '';
		const masked = rawKey ? maskApiKey(rawKey) : preview ? String(preview) : '';
		const hasKey = !!(hasKeys as Record<string, unknown>)[p];
		html += '<div class="__kp_ag_key_row" data-provider="' + escapeHtml(p) + '">';
		html += '<div class="__kp_setlabel">' + escapeHtml(p.toUpperCase()) + ' API KEY' + (hasKey ? ' <span class="__kp_key_has" data-has-key="' + escapeHtml(p) + '">● hasKey</span>' : ' <span class="__kp_key_nohas" data-has-key="' + escapeHtml(p) + '">○ no key</span>') + (masked ? ' <span class="__kp_key_preview" data-key-preview="' + escapeHtml(p) + '">' + escapeHtml(masked) + '</span>' : '') + '</div>';
		html += '<div class="__kp_ag_key_input_row">';
		html += '<input class="__kp_cfg_input __kp_ag_key_input" data-agentic-key-input="' + escapeHtml(p) + '" data-provider="' + escapeHtml(p) + '" type="password" placeholder="sk-..." value="' + escapeHtml(rawKey) + '" autocomplete="off">';
		html += '<button class="__kp_pl_btn" data-agentic-save-key="' + escapeHtml(p) + '" data-provider="' + escapeHtml(p) + '">save</button>';
		html += '</div>';
		if (masked) html += '<div class="__kp_cfg_hint">preview: ' + escapeHtml(masked) + ' ' + (hasKey ? '[hasKey=true]' : '[hasKey=false]') + '</div>';
		html += '</div>';
	}
	return html;
}

export function renderSettingsVeskConfigSubtab(state: VeskConfigState | null | undefined): string {
	return renderVeskConfigPanel(state);
}

export function renderSettingsSubtabs(active: string): string {
	const tabs: { id: SettingsSubTab; label: string }[] = [
		{ id: 'devtools', label: 'DEVTOOLS' },
		{ id: 'agentic', label: 'AGENTIC' },
		{ id: 'vesk', label: 'VESK CONFIG' },
	];
	let html = '<nav class="__kp_settings_tabs" data-settings-subtabs="1">';
	for (const t of tabs) {
		html +=
			'<button class="__kp_settings_tab' +
			(t.id === active ? ' active' : '') +
			'" data-settings-subtab="' +
			t.id +
			'" data-settings-tab="' +
			t.id +
			'">' +
			escapeHtml(t.label) +
			'</button>';
	}
	html += '</nav>';
	return html;
}

export function renderSettingsPanel(
	prefs: DevPrefs,
	agentic?: AgenticConfigState | null,
	vesk?: VeskConfigState | null,
	activeSubTab?: string
): string {
	const sub = isSettingsSubTab(activeSubTab || '') ? (activeSubTab as SettingsSubTab) : 'devtools';
	// Keep backward compat: if only prefs supplied, render full panel with nav defaulting to devtools
	let html = '<div class="__kp_sec">&gt; SETTINGS</div>';
	html += renderSettingsSubtabs(sub);
	html += '<div class="__kp_settings_pane" data-settings-pane="' + escapeHtml(sub) + '">';
	if (sub === 'agentic') {
		html += renderSettingsAgenticSubtab(agentic || null);
	} else if (sub === 'vesk') {
		html += renderSettingsVeskConfigSubtab(vesk || null);
	} else {
		html += renderSettingsDevToolsSubtab(prefs);
	}
	html += '</div>';
	return html;
}

export function renderVeskConfigPanel(state: VeskConfigState | null | undefined): string {
	if (!state) {
		return (
			'<div class="__kp_sec">&gt; VESK CONFIG</div>' +
			'<div class="__kp_line">loading config...</div>' +
			'<div class="__kp_cfg_hint">fetching GET /__vesk/config</div>'
		);
	}
	if (state.loading) {
		return (
			'<div class="__kp_sec">&gt; VESK CONFIG</div>' +
			'<div class="__kp_line">loading config...</div>'
		);
	}
	if (state.error) {
		return (
			'<div class="__kp_sec">&gt; VESK CONFIG</div>' +
			'<div class="__kp_pl_err">' +
			escapeHtml(String(state.error)) +
			'</div>' +
			'<button class="__kp_pl_btn" data-cfg-reload="1">retry</button>'
		);
	}
	const cfg = state.config || {};
	const md = (cfg.md || {}) as VeskMdConfig;
	const secRaw = cfg.security as unknown;
	let sec: VeskSecurity | null = null;
	let secIsObject = false;
	let secPreset: string | null = null;
	if (secRaw === false) {
		secPreset = 'off';
	} else if (typeof secRaw === 'string') {
		secPreset = String(secRaw);
	} else if (secRaw && typeof secRaw === 'object') {
		sec = secRaw as VeskSecurity;
		secIsObject = true;
	} else if (secRaw == null) {
		sec = {};
		secIsObject = true;
	}

	const appDir = typeof cfg.appDir === 'string' ? cfg.appDir : '';
	const outDir = typeof cfg.outDir === 'string' ? cfg.outDir : '';
	const publicDir = typeof cfg.publicDir === 'string' ? cfg.publicDir : '';
	const routeDataCache = typeof cfg.routeDataCache === 'number' ? cfg.routeDataCache : 0;
	const mdHtml = typeof md.html === 'string' ? md.html : 'escape';
	const allowTags = Array.isArray(md.allowTags) ? md.allowTags.join(', ') : '';

	let html = '<div class="__kp_sec">&gt; VESK CONFIG</div>';
	const pathLabel = state.path ? escapeHtml(state.path) : 'vesk.config.ts (not found)';
	html += '<div class="__kp_cfg_meta">PATH: <b>' + pathLabel + '</b> ' + (state.exists ? '' : '(will create on save)') + '</div>';
	if (state.saveOk) html += '<div class="__kp_line" style="color:var(--vk-fg)"><b>' + escapeHtml(String(state.saveOk)) + '</b></div>';
	if (state.saveError) html += '<div class="__kp_pl_err">' + escapeHtml(String(state.saveError)) + '</div>';
	if (state.saving) html += '<div class="__kp_line">saving...</div>';

	// ── core dirs + cache ─────────────────────────────────────────────
	html += '<div class="__kp_sec">&gt; CORE</div>';
	html += '<div class="__kp_setlabel">APP DIR</div>';
	html += '<input class="__kp_cfg_input" data-cfg-key="appDir" placeholder="app" value="' + escapeHtml(appDir) + '">';
	html += '<div class="__kp_setlabel">OUT DIR</div>';
	html += '<input class="__kp_cfg_input" data-cfg-key="outDir" placeholder=".vesk" value="' + escapeHtml(outDir) + '">';
	html += '<div class="__kp_setlabel">PUBLIC DIR</div>';
	html += '<input class="__kp_cfg_input" data-cfg-key="publicDir" placeholder="public" value="' + escapeHtml(publicDir) + '">';
	html += '<div class="__kp_setlabel">ROUTE DATA CACHE (ms)</div>';
	html += '<input class="__kp_cfg_input" data-cfg-key="routeDataCache" type="number" min="0" step="100" value="' + escapeHtml(String(routeDataCache)) + '">';
	html += '<div class="__kp_cfg_hint">0 = always fetch fresh on SPA nav</div>';

	// ── Markdown ──────────────────────────────────────────────────────
	html += '<div class="__kp_sec">&gt; MARKDOWN (MD)</div>';
	html += '<div class="__kp_setlabel">MD.HTML</div>';
	html += '<select class="__kp_cfg_select" data-cfg-md-html aria-label="md html">';
	for (const opt of ['escape', 'allow', 'allowlist']) {
		html += '<option value="' + opt + '"' + (mdHtml === opt ? ' selected' : '') + '>' + escapeHtml(opt) + '</option>';
	}
	html += '</select>';
	html += '<div class="__kp_setlabel">MD.ALLOW TAGS</div>';
	html += '<input class="__kp_cfg_input" data-cfg-md-tags placeholder="a, em, strong, code" value="' + escapeHtml(allowTags) + '"' + (mdHtml !== 'allowlist' ? ' disabled' : '') + '>';
	html += '<div class="__kp_cfg_hint">comma-separated, only used when html=allowlist</div>';
	if (mdHtml === 'allowlist' && !allowTags) {
		html += '<div class="__kp_cfg_hint">default allowlist: ' + escapeHtml('a, abbr, b, code, em, strong ...') + '</div>';
	}

	// ── Security ──────────────────────────────────────────────────────
	html += '<div class="__kp_sec">&gt; SECURITY</div>';
	if (secPreset) {
		html += '<div class="__kp_cfg_meta">SECURITY PRESET: <b>' + escapeHtml(secPreset) + '</b></div>';
		html += '<div class="__kp_cfg_hint">object editing disabled for preset/false. Save raw source to change preset or switch to object.</div>';
		html += '<div class="__kp_setlabel">SECURITY PRESET</div>';
		html += '<select class="__kp_cfg_select" data-cfg-sec-preset aria-label="security preset">';
		for (const p of ['strict', 'default', 'minimal', 'off', 'custom']) {
			const sel = (secPreset === p || (p === 'custom' && !secPreset)) ? ' selected' : '';
			html += '<option value="' + p + '"' + sel + '>' + escapeHtml(p) + '</option>';
		}
		html += '</select>';
		// still render object fields disabled when preset
	}
	if (secIsObject || !secPreset) {
		const s = (sec || {}) as VeskSecurity;
		const xfo = typeof s.xFrameOptions === 'string' ? s.xFrameOptions : s.xFrameOptions === false ? '' : (s.xFrameOptions == null ? 'DENY' : String(s.xFrameOptions));
		const xfoDisabled = s.xFrameOptions === false;
		html += '<div class="__kp_setlabel">X-FRAME-OPTIONS</div>';
		html += '<div class="__kp_cfg_row">';
		html += '<input class="__kp_cfg_input" data-sec-key="xFrameOptions" placeholder="DENY" value="' + escapeHtml(xfo) + '"' + (xfoDisabled ? ' disabled' : '') + '>';
		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="xFrameOptions" ' + (xfoDisabled ? 'checked' : '') + '> disable</label>';
		html += '</div>';

		const hsts = typeof s.hsts === 'string' ? s.hsts : s.hsts === false ? '' : (s.hsts == null ? '' : String(s.hsts));
		const hstsDisabled = s.hsts === false;
		html += '<div class="__kp_setlabel">HSTS</div>';
		html += '<div class="__kp_cfg_row">';
		html += '<input class="__kp_cfg_input" data-sec-key="hsts" placeholder="max-age=31536000; includeSubDomains" value="' + escapeHtml(hsts) + '"' + (hstsDisabled ? ' disabled' : '') + '>';
		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="hsts" ' + (hstsDisabled ? 'checked' : '') + '> disable</label>';
		html += '</div>';

		const rp = typeof s.referrerPolicy === 'string' ? s.referrerPolicy : s.referrerPolicy === false ? '' : (s.referrerPolicy == null ? '' : String(s.referrerPolicy));
		const rpDisabled = s.referrerPolicy === false;
		html += '<div class="__kp_setlabel">REFERRER-POLICY</div>';
		html += '<div class="__kp_cfg_row">';
		html += '<input class="__kp_cfg_input" data-sec-key="referrerPolicy" placeholder="strict-origin-when-cross-origin" value="' + escapeHtml(rp) + '"' + (rpDisabled ? ' disabled' : '') + '>';
		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="referrerPolicy" ' + (rpDisabled ? 'checked' : '') + '> disable</label>';
		html += '</div>';

		const csp = s.contentSecurityPolicy;
		let cspVal = '';
		let cspDisabled = false;
		if (csp === false) cspDisabled = true;
		else if (typeof csp === 'string') cspVal = csp;
		else if (csp === true) cspVal = "default-src 'self'";
		html += '<div class="__kp_setlabel">CONTENT-SECURITY-POLICY</div>';
		html += '<div class="__kp_cfg_row">';
		html += '<input class="__kp_cfg_input" data-sec-key="contentSecurityPolicy" placeholder="default-src \'self\' ..." value="' + escapeHtml(cspVal) + '"' + (cspDisabled ? ' disabled' : '') + '>';
		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="contentSecurityPolicy" ' + (cspDisabled ? 'checked' : '') + '> disable</label>';
		html += '</div>';

		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="autoEscape" ' + (s.autoEscape !== false ? 'checked' : '') + '> AUTO ESCAPE</label>';
		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="csrf" ' + (s.csrf !== false ? 'checked' : '') + '> CSRF</label>';
		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="redactLogs" ' + (s.redactLogs !== false ? 'checked' : '') + '> REDACT LOGS</label>';

		const tp = s.trustProxy;
		let tpVal = '';
		let tpChecked = false;
		if (typeof tp === 'string') tpVal = tp;
		else if (tp === true) tpChecked = true;
		html += '<div class="__kp_setlabel">TRUST PROXY</div>';
		html += '<div class="__kp_cfg_row">';
		html += '<input class="__kp_cfg_input" data-sec-key="trustProxy" placeholder="127.0.0.1 or CIDR" value="' + escapeHtml(tpVal) + '">';
		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="trustProxy" ' + (tpChecked ? 'checked' : '') + '> enabled</label>';
		html += '</div>';

		// cors
		const cors = (s.cors || {}) as VeskSecurityCors;
		const corsOrigin = Array.isArray(cors.origin) ? cors.origin.join(', ') : typeof cors.origin === 'string' ? cors.origin : '';
		html += '<div class="__kp_setlabel">CORS ORIGIN</div>';
		html += '<input class="__kp_cfg_input" data-sec-key="cors.origin" placeholder="* or https://example.com" value="' + escapeHtml(corsOrigin) + '">';
		html += '<div class="__kp_setlabel">CORS METHODS</div>';
		html += '<input class="__kp_cfg_input" data-sec-key="cors.methods" placeholder="GET, POST" value="' + escapeHtml(typeof cors.methods === 'string' ? cors.methods : '') + '">';
		html += '<div class="__kp_setlabel">CORS HEADERS</div>';
		html += '<input class="__kp_cfg_input" data-sec-key="cors.headers" placeholder="Content-Type" value="' + escapeHtml(typeof cors.headers === 'string' ? cors.headers : '') + '">';
		html += '<label class="__kp_cfg_check"><input type="checkbox" data-sec-toggle="cors.credentials" ' + (cors.credentials ? 'checked' : '') + '> CORS CREDENTIALS</label>';
		html += '<div class="__kp_setlabel">CORS MAX AGE</div>';
		html += '<input class="__kp_cfg_input" data-sec-key="cors.maxAge" type="number" min="0" value="' + escapeHtml(String(cors.maxAge != null ? cors.maxAge : '')) + '">';

		// rateLimit
		const rl = (s.rateLimit || {}) as VeskSecurityRateLimit;
		html += '<div class="__kp_setlabel">RATE LIMIT WINDOW MS</div>';
		html += '<input class="__kp_cfg_input" data-sec-key="rateLimit.windowMs" type="number" min="0" value="' + escapeHtml(String(rl.windowMs != null ? rl.windowMs : '')) + '">';
		html += '<div class="__kp_setlabel">RATE LIMIT MAX</div>';
		html += '<input class="__kp_cfg_input" data-sec-key="rateLimit.max" type="number" min="0" value="' + escapeHtml(String(rl.max != null ? rl.max : '')) + '">';
	}

	// ── Raw editor ────────────────────────────────────────────────────
	html += '<div class="__kp_sec">&gt; RAW vesk.config.ts</div>';
	const src = state.draftSource != null ? state.draftSource : state.source;
	html += '<textarea class="__kp_cfg_textarea" data-cfg-source rows="12" spellcheck="false">' + escapeHtml(src) + '</textarea>';
	html += '<div class="__kp_cfg_row">';
	html += '<button class="__kp_pl_btn" data-cfg-save="1"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'saving...' : 'save source') + '</button>';
	html += '<button class="__kp_pl_btn" data-cfg-reload="1">reload</button>';
	html += '</div>';
	html += '<div class="__kp_cfg_hint">POST /__vesk/config {source} — invalid source returns 400 and never clobbers</div>';

	return html;
}

export function renderSettingsWithConfig(
	prefs: DevPrefs,
	activeSubtab: string,
	cfgState: VeskConfigState | null | undefined
): string {
	const norm = activeSubtab === 'prefs' ? 'devtools' : activeSubtab === 'config' ? 'vesk' : activeSubtab;
	if (isSettingsSubTab(norm)) {
		return renderSettingsPanel(prefs, null, cfgState || null, norm);
	}
	return renderSettingsPanel(prefs, null, cfgState || null, 'devtools');
}

// ── Agentic panel — pure helpers ──────────────────────────────────────────

export interface AgenticMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	ts?: number;
}

export interface AgenticCheckpoint {
	id: string;
	message: string;
	timestamp: number;
	label?: string;
}

export interface AgenticPanelState {
	provider: string;
	model: string;
	models: string[];
	modelsLoading?: boolean;
	modelsError?: string | null;
	mode: AgenticMode;
	messages: AgenticMessage[];
	history: AgenticCheckpoint[];
	historyLoading?: boolean;
	input?: string;
	running?: boolean;
	error?: string | null;
	slashHintVisible?: boolean;
}

export function agenticProviderLabel(p: string): string {
	switch (p) {
		case 'openai': return 'OpenAI';
		
		case 'anthropic': return 'Anthropic';
		case 'google': return 'Google Gemini';
		case 'ollama': return 'Ollama';
		default: return p;
	}
}

export function buildAgenticModelsUrl(provider: string, baseUrl?: string): string {
	let url = AGENTIC_MODELS_URL + '?provider=' + encodeURIComponent(provider);
	if (baseUrl && baseUrl.trim()) url += '&baseUrl=' + encodeURIComponent(baseUrl.trim());
	return url;
}

export function filterAgenticModels(models: string[], query: string): string[] {
	if (!query) return models.slice();
	const q = query.toLowerCase();
	const out: string[] = [];
	for (const m of models) {
		if (m.toLowerCase().indexOf(q) !== -1) out.push(m);
	}
	return out;
}

export function renderAgenticProviderSelect(provider: string): string {
	let html = '<div class="__kp_setlabel">PROVIDER</div><div class="__kp_optrow" data-agentic="provider">';
	for (const p of AGENTIC_PROVIDERS) {
		html +=
			'<button class="__kp_opt' +
			(p === provider ? ' active' : '') +
			'" data-agentic-provider="' +
			escapeHtml(p) +
			'" data-key="agenticProvider" data-val="' +
			escapeHtml(p) +
			'">' +
			escapeHtml(agenticProviderLabel(p)) +
			'</button>';
	}
	html += '</div>';
	return html;
}

export function renderAgenticModelSelect(
	model: string,
	models: string[],
	loading?: boolean,
	error?: string | null
): string {
	let html = '<div class="__kp_setlabel">MODEL <span class="__kp_ag_hint">via ' + escapeHtml(AGENTIC_MODELS_URL) + '</span></div>';
	html += '<div class="__kp_ag_model_row">';
	html +=
		'<button class="__kp_pl_btn" data-agentic-refresh-models="1"' + (loading ? ' disabled' : '') + '>' + (loading ? 'loading...' : 'refresh') + '</button>';
	html += '</div>';
	if (error) html += '<div class="__kp_pl_err">' + escapeHtml(String(error)) + '</div>';
	if (loading) html += '<div class="__kp_line">loading models from ' + escapeHtml(AGENTIC_MODELS_URL) + '...</div>';
	html += '<div class="__kp_ag_models" data-agentic="models">';
	if (models.length === 0 && !loading) {
		html += '<div class="__kp_line">no models — click refresh</div>';
	} else {
		for (const m of models) {
			html +=
				'<button class="__kp_opt' +
				(m === model ? ' active' : '') +
				'" data-agentic-model="' +
				escapeHtml(m) +
				'" data-key="agenticModel" data-val="' +
				escapeHtml(m) +
				'">' +
				escapeHtml(m) +
				'</button>';
		}
	}
	html += '</div>';
	return html;
}

export function renderAgenticModeToggle(mode: AgenticMode): string {
	let html = '<div class="__kp_setlabel">MODE</div><div class="__kp_optrow" data-agentic="mode">';
	for (const m of AGENTIC_MODES) {
		html +=
			'<button class="__kp_opt' +
			(m === mode ? ' active' : '') +
			'" data-agentic-mode="' +
			escapeHtml(m) +
			'" data-key="agenticMode" data-val="' +
			escapeHtml(m) +
			'">' +
			escapeHtml(m) +
			'</button>';
	}
	html += '</div>';
	return html;
}

export function renderAgenticMessages(messages: AgenticMessage[]): string {
	if (!messages || messages.length === 0) {
		return '<div class="__kp_line">no messages yet — start a conversation</div>';
	}
	let html = '<div class="__kp_ag_messages" data-agentic="messages">';
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		const role = m.role || 'user';
		const time = m.ts ? new Date(m.ts).toLocaleTimeString() : '';
		html +=
			'<div class="__kp_ag_msg" data-role="' +
			escapeHtml(role) +
			'" data-idx="' +
			i +
			'">' +
			'<div class="__kp_ag_msg_head"><span class="__kp_ag_role">' +
			escapeHtml(role) +
			'</span>' +
			(time ? '<span class="__kp_ag_time">' + escapeHtml(time) + '</span>' : '') +
			'</div>' +
			'<div class="__kp_ag_msg_body">' +
			escapeHtml(m.content) +
			'</div>' +
			'</div>';
	}
	html += '</div>';
	return html;
}

export function renderAgenticHistory(
	history: AgenticCheckpoint[],
	loading?: boolean
): string {
	// Single stable block node so the client can refresh checkpoints in place
	// without re-rendering the whole panel (which would drop the chat messages
	// host and make the panel "jump").
	let html = '<div class="__kp_ag_hist_block" data-agentic="history-block">';
	html += '<div class="__kp_sec">&gt; HISTORY</div>';
	if (loading) html += '<div class="__kp_line">loading history...</div>';
	if (!history || history.length === 0) {
		if (!loading) html += '<div class="__kp_line">no checkpoints yet</div>';
		html += '</div>';
		return html;
	}
	html += '<div class="__kp_ag_history" data-agentic="history">';
	for (const cp of history) {
		const when = cp.timestamp ? new Date(cp.timestamp).toLocaleString() : '';
		const label = cp.label || cp.message || cp.id;
		html +=
			'<div class="__kp_ag_hist_row" data-checkpoint="' +
			escapeHtml(cp.id) +
			'">' +
			'<div class="__kp_ag_hist_info">' +
			'<div class="__kp_ag_hist_label">' +
			escapeHtml(label) +
			'</div>' +
			'<div class="__kp_ag_hist_meta">' +
			escapeHtml(when) +
			'  id:' +
			escapeHtml(cp.id) +
			'</div>' +
			'</div>' +
			'<button class="__kp_pl_btn" data-agentic-rollback="' +
			escapeHtml(cp.id) +
			'">rollback</button>' +
			'</div>';
	}
	html += '</div>';
	html += '</div>';
	return html;
}

export function renderAgenticSlashHint(): string {
	let html = '<div class="__kp_ag_slash" data-agentic="slash-hint">';
	html += '<span class="__kp_ag_slash_label">slash commands:</span> ';
	for (let i = 0; i < AGENTIC_SLASH_COMMANDS.length; i++) {
		const cmd = AGENTIC_SLASH_COMMANDS[i];
		html += '<code class="__kp_ag_slash_cmd">' + escapeHtml(cmd) + '</code>';
		if (i < AGENTIC_SLASH_COMMANDS.length - 1) html += ' ';
	}
	html += '<span class="__kp_ag_hint"> — type / to see hints</span>';
	html += '</div>';
	return html;
}

export function getAgenticSlashSuggestions(
	input: string,
	models: string[],
	providers: string[] = AGENTIC_PROVIDERS,
	tools: string[] = []
): Array<{ label: string; value: string; desc?: string }> {
	if (!input || !input.startsWith('/')) return [];
	const trimmed = input.trim();
	const spaceIdx = trimmed.indexOf(' ');
	const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
	const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
	const q = arg.toLowerCase();
	if (cmd === '/models' || cmd === '/model') {
		const filtered = filterAgenticModels(models, q);
		return filtered.slice(0, 20).map((m) => ({ label: m, value: cmd + ' ' + m, desc: 'model' }));
	}
	if (cmd === '/provider') {
		const filtered = providers.filter((p) => !q || p.toLowerCase().indexOf(q) !== -1);
		return filtered.map((p) => ({ label: p, value: '/provider ' + p, desc: agenticProviderLabel(p) }));
	}
	if (cmd === '/mode') {
		const modes = ['explore', 'debug', 'agent'];
		const filtered = modes.filter((m) => !q || m.indexOf(q) !== -1);
		return filtered.map((m) => ({ label: m, value: '/mode ' + m }));
	}
	if (cmd === '/tools' || cmd === '/tool') {
		const t = tools.length ? tools : ['vesk.inspectProject', 'filesystem.write', 'web.search', 'browser.open'];
		const filtered = t.filter((x) => !q || x.toLowerCase().indexOf(q) !== -1);
		return filtered.slice(0, 20).map((x) => ({ label: x, value: '/tool ' + x }));
	}
	if (trimmed === '/' || cmd === '/') {
		return AGENTIC_SLASH_COMMANDS.map((c) => ({ label: c, value: c }));
	}
	const filteredCmds = AGENTIC_SLASH_COMMANDS.filter((c) => c.toLowerCase().indexOf(cmd.toLowerCase()) !== -1);
	return filteredCmds.map((c) => ({ label: c, value: c }));
}

export function renderAgenticSlashPopup(
	input: string,
	models: string[],
	providers: string[] = AGENTIC_PROVIDERS,
	tools: string[] = []
): string {
	const suggestions = getAgenticSlashSuggestions(input, models, providers, tools);
	if (suggestions.length === 0) return '';
	let html = '<div class="__kp_ag_popup" data-agentic-popup="1">';
	for (const s of suggestions) {
		html +=
			'<button class="__kp_ag_popup_item" data-agentic-pick="' +
			escapeHtml(s.value) +
			'">' +
			'<span class="__kp_ag_popup_label">' +
			escapeHtml(s.label) +
			'</span>' +
			(s.desc ? '<span class="__kp_ag_popup_desc">' + escapeHtml(s.desc) + '</span>' : '') +
			'</button>';
	}
	html += '</div>';
	return html;
}

export function renderAgenticChatInput(input?: string, running?: boolean, models: string[] = [], providers: string[] = AGENTIC_PROVIDERS, tools: string[] = []): string {
	const popup = !running && input && input.startsWith('/') ? renderAgenticSlashPopup(input, models, providers, tools) : '';
	return (
		'<div class="__kp_ag_input_wrap">' +
		popup +
		'<div class="__kp_ag_input_row">' +
		'<input class="__kp_ag_input" data-agentic-input="1" placeholder="ask agentic... (try /help)" value="' +
		escapeHtml(input || '') +
		'"' +
		(running ? ' disabled' : '') +
		' autocomplete="off">' +
		'<button class="__kp_pl_btn" data-agentic-send="1"' +
		(running ? ' disabled' : '') +
		'>' +
		(running ? 'running...' : 'send') +
		'</button>' +
		'</div>' +
		'</div>'
	);
}

export function renderAgenticPanel(state: AgenticPanelState): string {
	const provider = state.provider || 'openai';
	const model = typeof state.model === 'string' ? state.model : '';
	const models = Array.isArray(state.models) ? state.models : [];
	const mode = isAgenticMode(state.mode) ? state.mode : 'explore';
	const messages = Array.isArray(state.messages) ? state.messages : [];
	const history = Array.isArray(state.history) ? state.history : [];
	let html = '<div class="__kp_sec">&gt; AGENTIC</div>';
	html += renderAgenticProviderSelect(provider);
	html += renderAgenticModelSelect(model, models, !!state.modelsLoading, state.modelsError || null);
	html += renderAgenticModeToggle(mode);
	if (state.error) html += '<div class="__kp_pl_err">' + escapeHtml(String(state.error)) + '</div>';
	html += '<div class="__kp_sec">&gt; CHAT</div>';
	html += renderAgenticMessages(messages);
	html += renderAgenticChatInput(state.input || '', !!state.running);
	html += renderAgenticSlashHint();
	html += renderAgenticHistory(history, !!state.historyLoading);
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
	'#__vesk_dev .__kp_ag_models{display:flex;gap:6px;flex-wrap:wrap;max-height:150px;overflow-y:auto;margin:6px 0 14px;padding:2px;}' +
	'#__vesk_dev .__kp_ag_model_row{display:flex;gap:8px;align-items:center;margin:6px 0 4px;}' +
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
	'#__vesk_dev .__kp_pl_toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;}' +
	'#__vesk_dev .__kp_ag_select{background:var(--vk-codebg);border:1px solid var(--vk-line-soft);color:var(--vk-fg);font-family:inherit;font-size:11px;padding:4px 8px;min-width:120px;}' +
	'#__vesk_dev .__kp_ag_select:focus{border-color:var(--vk-dim);outline:none;}' +
	'#__vesk_dev .__kp_ag_model_row{display:flex;gap:6px;align-items:center;margin:6px 0 8px;}' +
	'#__vesk_dev .__kp_ag_messages{max-height:240px;overflow-y:auto;border:1px solid var(--vk-line-soft);background:var(--vk-codebg);padding:6px;margin:6px 0;}' +
	'#__vesk_dev .__kp_ag_msg{border-bottom:1px solid var(--vk-line-soft);padding:6px 0;}' +
	'#__vesk_dev .__kp_ag_msg:last-child{border-bottom:none;}' +
	'#__vesk_dev .__kp_ag_msg_head{display:flex;gap:8px;align-items:baseline;font-size:10px;color:var(--vk-dim);text-transform:uppercase;letter-spacing:.06em;}' +
	'#__vesk_dev .__kp_ag_role{font-weight:700;color:var(--vk-fg);}' +
	'#__vesk_dev .__kp_ag_time{color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_ag_msg_body{font-size:12px;color:var(--vk-fg);white-space:pre-wrap;word-break:break-word;margin-top:2px;}' +
	'#__vesk_dev .__kp_ag_msg[data-role="assistant"] .__kp_ag_msg_body{color:var(--vk-muted);}' +
	'#__vesk_dev .__kp_ag_msg[data-role="system"] .__kp_ag_msg_body{color:var(--vk-dim);font-style:italic;}' +
	'#__vesk_dev .__kp_ag_input_wrap{position:sticky;bottom:0;z-index:11;display:flex;flex-direction:column;background:var(--vk-bg);border-top:1px solid var(--vk-line-soft);margin:8px -12px -12px;padding:6px 12px 12px;}' +
	'#__vesk_dev .__kp_ag_popup{position:absolute;bottom:100%;left:0;right:0;max-height:180px;overflow-y:auto;background:var(--vk-bg);border:1px solid var(--vk-border);border-bottom:none;z-index:10;box-shadow:0 -4px 12px rgba(0,0,0,0.3);}' +
	'#__vesk_dev .__kp_ag_popup_item{all:unset;display:flex;justify-content:space-between;align-items:center;width:100%;padding:6px 8px;font-family:inherit;font-size:11px;color:var(--vk-fg);cursor:pointer;border-bottom:1px solid var(--vk-line-soft);}' +
	'#__vesk_dev .__kp_ag_popup_item:hover{background:var(--vk-soft);}' +
	'#__vesk_dev .__kp_ag_popup_item:active{background:var(--vk-soft-hi);}' +
	'#__vesk_dev .__kp_ag_popup_label{font-weight:700;}' +
	'#__vesk_dev .__kp_ag_popup_desc{font-size:10px;color:var(--vk-dim);margin-left:8px;}' +
	'#__vesk_dev .__kp_ag_input_row{display:flex;gap:6px;margin:8px 0;}' +
	'#__vesk_dev .__kp_ag_input{flex:1;background:var(--vk-codebg);border:1px solid var(--vk-line-soft);color:var(--vk-fg);font-family:inherit;font-size:12px;padding:6px 8px;}' +
	'#__vesk_dev .__kp_ag_input::placeholder{color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_ag_input:focus{border-color:var(--vk-dim);outline:none;}' +
	'#__vesk_dev .__kp_ag_history{border:1px solid var(--vk-line-soft);margin-top:6px;max-height:200px;overflow-y:auto;}' +
	'#__vesk_dev .__kp_ag_hist_row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--vk-line-soft);}' +
	'#__vesk_dev .__kp_ag_hist_row:hover{background:var(--vk-soft);}' +
	'#__vesk_dev .__kp_ag_hist_info{flex:1;min-width:0;}' +
	'#__vesk_dev .__kp_ag_hist_label{font-size:12px;color:var(--vk-fg);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
	'#__vesk_dev .__kp_ag_hist_meta{font-size:10px;color:var(--vk-dim);}' +
	'#__vesk_dev .__kp_ag_slash{font-size:11px;color:var(--vk-dim);margin:6px 0;padding:4px 6px;border:1px dashed var(--vk-line-soft);background:var(--vk-codebg);}' +
	'#__vesk_dev .__kp_ag_slash_cmd{font-size:10px;color:var(--vk-muted);background:var(--vk-soft);border:1px solid var(--vk-line-soft);padding:1px 4px;margin-right:2px;}' +
	'#__vesk_dev .__kp_ag_hint{color:var(--vk-dim);font-size:10px;}' +
	'#__vesk_dev .__kp_cfg_input{width:100%;background:var(--vk-codebg);border:1px solid var(--vk-line-soft);color:var(--vk-fg);font-family:inherit;font-size:12px;padding:6px 8px;margin:4px 0 8px;box-sizing:border-box;}' +
	'#__vesk_dev .__kp_cfg_input:focus{border-color:var(--vk-dim);outline:none;}' +
	'#__vesk_dev .__kp_cfg_input[disabled]{opacity:.4;}' +
	'#__vesk_dev .__kp_cfg_select{background:var(--vk-codebg);border:1px solid var(--vk-line-soft);color:var(--vk-fg);font-family:inherit;font-size:11px;padding:4px 8px;min-width:140px;margin:4px 0 8px;}' +
	'#__vesk_dev .__kp_cfg_select:focus{border-color:var(--vk-dim);outline:none;}' +
	'#__vesk_dev .__kp_cfg_textarea{width:100%;min-height:180px;background:var(--vk-codebg);border:1px solid var(--vk-line-soft);color:var(--vk-fg);font-family:ui-monospace,monospace;font-size:11px;padding:8px;resize:vertical;margin:6px 0 8px;box-sizing:border-box;}' +
	'#__vesk_dev .__kp_cfg_textarea:focus{border-color:var(--vk-dim);outline:none;}' +
	'#__vesk_dev .__kp_cfg_row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 8px;}' +
	'#__vesk_dev .__kp_cfg_check{display:flex;gap:6px;align-items:center;font-size:11px;color:var(--vk-muted);margin:4px 0;cursor:pointer;}' +
	'#__vesk_dev .__kp_cfg_check input{accent-color:var(--vk-fg);}' +
	'#__vesk_dev .__kp_cfg_hint{font-size:10px;color:var(--vk-dim);margin:2px 0 6px;}' +
	'#__vesk_dev .__kp_cfg_meta{font-size:11px;color:var(--vk-dim);margin:6px 0;word-break:break-all;}' +
	'#__vesk_dev .__kp_cfg_meta b{color:var(--vk-fg);}' +
	'#__vesk_dev .__kp_settings_tabs{display:flex;gap:6px;border-bottom:1px solid var(--vk-line);margin:8px 0;padding-bottom:6px;flex-wrap:wrap;}' +
	'#__vesk_dev .__kp_settings_tab{all:unset;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--vk-muted);border:1px solid var(--vk-line-soft);padding:4px 10px;transition:color .12s ease,background .12s ease,border-color .12s ease;}' +
	'#__vesk_dev .__kp_settings_tab:hover{color:var(--vk-fg);border-color:var(--vk-dim);background:var(--vk-soft);}' +
	'#__vesk_dev .__kp_settings_tab.active{color:var(--vk-inv-fg);background:var(--vk-inv-bg);border-color:var(--vk-border);}' +
	'#__vesk_dev .__kp_settings_pane{animation:__v_tab .18s cubic-bezier(.22,.61,.36,1);}' +
	'#__vesk_dev .__kp_ag_key_row{border:1px solid var(--vk-line-soft);padding:8px;margin:6px 0;background:var(--vk-codebg);}' +
	'#__vesk_dev .__kp_ag_key_input_row{display:flex;gap:6px;align-items:center;margin:4px 0;}' +
	'#__vesk_dev .__kp_ag_key_input{flex:1;}' +
	'#__vesk_dev .__kp_key_has{color:#3fb950;font-size:10px;font-weight:700;}' +
	'#__vesk_dev .__kp_key_nohas{color:var(--vk-dim);font-size:10px;}' +
	'#__vesk_dev .__kp_key_preview{font-size:10px;color:var(--vk-muted);border:1px solid var(--vk-line-soft);padding:1px 4px;background:var(--vk-soft);}' ;


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

	// Agentic state
	let agenticMessages: AgenticMessage[] = [];
	let agenticHistory: AgenticCheckpoint[] = [];
	let agenticHistoryError: string | null = null;
	let agenticModelsCache: string[] = [];
	let agenticModelsLoading = false;
	let agenticModelsError: string | null = null;
	// The user's explicitly picked model — survives a later config-load that would
	// otherwise clobber ui.agenticModel back to the (possibly stale) persisted default.
	let agenticSelectedModel = '';
	let agenticBaseUrl = '';
	let agenticRunning = false;
	let agenticError: string | null = null;
	let agenticMaxSteps = 25;
	let agenticRunStep = 0;
	let agenticRunBudget = 0;
	let agenticInput = '';
	let agenticHistoryLoading = false;

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

	// Settings subtab — persisted via ui.settingsSubTab
	let settingsSubtab: string = ui.settingsSubTab || 'devtools';
	// Vesk Config state
	let cfgState: VeskConfigState | null = null;
	let cfgLoading = false;
	let cfgError: string | null = null;
	let cfgSaving = false;
	let cfgSaveError: string | null = null;
	let cfgSaveOk: string | null = null;
	// Agentic Config state (settings agentic subtab)
	let agenticConfigState: AgenticConfigState | null = null;
	let agenticConfigLoading = false;
	let agenticConfigError: string | null = null;
	let agenticConfigSaving = false;
	let agenticConfigSaveError: string | null = null;
	let agenticConfigSaveOk: string | null = null;

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
		} else if (key === 'agenticProvider' && AGENTIC_PROVIDERS.indexOf(val) !== -1) {
			ui.agenticProvider = val;
			// a model pick is provider-scoped — clear it so the new provider re-resolves
			// to a valid model from its own freshly fetched list.
			agenticSelectedModel = '';
			agenticModelsCache = [];
			ui.agenticModels = [];
			if (agenticConfigState) agenticConfigState.models = [];
			refreshAgenticModels();
			// also refresh for settings sub-tab if open
			if (activeTab === 'settings' && settingsSubtab === 'agentic') refreshAgenticModels();
		} else if (key === 'agenticModel' && val.length > 0) {
			ui.agenticModel = val;
			agenticSelectedModel = val;
		} else if (key === 'agenticMode' && isAgenticMode(val)) {
			ui.agenticMode = val;
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
				if (tab === 'agentic') {
					refreshAgenticModels();
					refreshAgenticHistory();
				}
				if (tab === 'settings') {
					if (settingsSubtab === 'vesk' && !cfgState && !cfgLoading) refreshVeskConfig();
					if (settingsSubtab === 'agentic' && !agenticConfigState && !agenticConfigLoading) refreshAgenticConfig();
					if ((settingsSubtab as string) === 'config' && !cfgState && !cfgLoading) refreshVeskConfig();
				}
				setTab(tab);
			});
		}
		const contentEl = doc.getElementById('__kp_content') as HTMLElement;
		contentEl.addEventListener('click', function (e) {
			gpClickHandler(e);
		});
		contentEl.addEventListener('change', function (e) {
			const target = e.target as HTMLElement;
			const providerSel = target.closest('[data-agentic-provider-select]') as HTMLSelectElement | null;
			if (providerSel) {
				changePref('agenticProvider', providerSel.value);
				saveAgenticConfigPatch({ provider: providerSel.value });
				return;
			}
			const modelSel = target.closest('[data-agentic-model]') as HTMLSelectElement | null;
			if (modelSel) {
				changePref('agenticModel', modelSel.value);
				saveAgenticConfigPatch({ model: modelSel.value });
				return;
			}
			// Agentic settings: baseUrl, maxSteps, mode, provider/model via settings subtab also use same keys
			const agBaseEl = target.closest('[data-agentic-baseurl]') as HTMLInputElement | null;
			if (agBaseEl) {
				const v = agBaseEl.value || '';
				saveAgenticConfigPatch({ baseUrl: v });
				if (agenticConfigState) agenticConfigState.baseUrl = v;
				agenticBaseUrl = v;
				// A base URL change can turn a stub list (custom) into a real one — refresh.
				refreshAgenticModels();
				return;
			}
			const agBaseKeyEl = target.closest('[data-agentic-key="baseUrl"]') as HTMLInputElement | null;
			if (agBaseKeyEl) {
				const v = agBaseKeyEl.value || '';
				saveAgenticConfigPatch({ baseUrl: v });
				if (agenticConfigState) agenticConfigState.baseUrl = v;
				agenticBaseUrl = v;
				refreshAgenticModels();
				return;
			}
			const agMaxEl = target.closest('[data-agentic-maxsteps]') as HTMLInputElement | null;
			if (agMaxEl) {
				const n = parseInt(agMaxEl.value, 10);
				if (!isNaN(n) && n >= 1 && n <= 100) {
					saveAgenticConfigPatch({ maxSteps: n });
					if (agenticConfigState) agenticConfigState.maxSteps = n;
				}
				return;
			}
			const agMaxKeyEl = target.closest('[data-agentic-key="maxSteps"]') as HTMLInputElement | null;
			if (agMaxKeyEl) {
				const n = parseInt(agMaxKeyEl.value, 10);
				if (!isNaN(n) && n >= 1 && n <= 100) {
					saveAgenticConfigPatch({ maxSteps: n });
					if (agenticConfigState) agenticConfigState.maxSteps = n;
				}
				return;
			}
			// Vesk Config: core fields (appDir, outDir, publicDir, routeDataCache)
			const cfgKeyEl = target.closest('[data-cfg-key]') as HTMLInputElement | null;
			if (cfgKeyEl) {
				const k = cfgKeyEl.getAttribute('data-cfg-key') || '';
				if (k === 'routeDataCache') {
					const n = parseInt(cfgKeyEl.value, 10);
					if (!isNaN(n) && n >= 0) postVeskConfigKey(k, n);
					else if (cfgKeyEl.value === '' || cfgKeyEl.value == null) postVeskConfigKey(k, 0);
					return;
				}
				if (k === 'appDir' || k === 'outDir' || k === 'publicDir') {
					postVeskConfigKey(k, cfgKeyEl.value);
					return;
				}
			}
			const mdHtmlEl = target.closest('[data-cfg-md-html]') as HTMLSelectElement | null;
			if (mdHtmlEl) {
				const htmlMode = mdHtmlEl.value;
				const curMd = (cfgState && cfgState.config && cfgState.config.md) ? cfgState.config.md as VeskMdConfig : {};
				const curTags = Array.isArray(curMd.allowTags) ? curMd.allowTags : [];
				postVeskConfigKey('md', { html: htmlMode, allowTags: curTags });
				return;
			}
			const mdTagsEl = target.closest('[data-cfg-md-tags]') as HTMLInputElement | null;
			if (mdTagsEl) {
				const raw = mdTagsEl.value || '';
				const tags = raw.split(',').map(function (s) { return s.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''); }).filter(Boolean);
				const curMd2 = (cfgState && cfgState.config && cfgState.config.md) ? cfgState.config.md as VeskMdConfig : {};
				const htmlMode2 = typeof curMd2.html === 'string' ? curMd2.html : 'escape';
				postVeskConfigKey('md', { html: htmlMode2, allowTags: tags });
				return;
			}
			const secPresetEl = target.closest('[data-cfg-sec-preset]') as HTMLSelectElement | null;
			if (secPresetEl) {
				const v = secPresetEl.value;
				if (v === 'custom') {
					postVeskConfigKey('security', {});
				} else if (v === 'off') {
					postVeskConfigKey('security', false);
				} else {
					postVeskConfigKey('security', v);
				}
				return;
			}
			const secKeyEl = target.closest('[data-sec-key]') as HTMLInputElement | null;
			if (secKeyEl) {
				const sk = secKeyEl.getAttribute('data-sec-key') || '';
				const rawVal = secKeyEl.value;
				// Build security patch
				const curSecRaw = cfgState && cfgState.config ? cfgState.config.security : {};
				let curSec: Record<string, unknown> = {};
				if (curSecRaw && typeof curSecRaw === 'object' && !Array.isArray(curSecRaw)) curSec = Object.assign({}, curSecRaw as Record<string, unknown>);
				if (sk.indexOf('.') !== -1) {
					const parts = sk.split('.');
					const top = parts[0];
					const sub = parts[1];
					let nested = curSec[top] as Record<string, unknown> | undefined;
					if (!nested || typeof nested !== 'object') nested = {};
					else nested = Object.assign({}, nested);
					if (sk === 'cors.origin') {
						const list = rawVal.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
						nested[sub] = list.length === 1 ? list[0] : list.length ? list : undefined;
					} else if (sk === 'rateLimit.windowMs' || sk === 'rateLimit.max') {
						const num = rawVal === '' ? undefined : parseInt(rawVal, 10);
						if (num != null && !isNaN(num)) nested[sub] = num;
						else delete nested[sub];
					} else {
						if (rawVal === '') delete nested[sub];
						else nested[sub] = rawVal;
					}
					// clean nested if empty and top is cors/rateLimit
					if (Object.keys(nested).length === 0) delete curSec[top];
					else curSec[top] = nested;
				} else {
					if (rawVal === '') delete curSec[sk];
					else curSec[sk] = rawVal;
				}
				postVeskConfigKey('security', curSec);
				return;
			}
			const secToggleEl = target.closest('[data-sec-toggle]') as HTMLInputElement | null;
			if (secToggleEl) {
				const tk = secToggleEl.getAttribute('data-sec-toggle') || '';
				const checked = !!secToggleEl.checked;
				const curSecRaw2 = cfgState && cfgState.config ? cfgState.config.security : {};
				let curSec2: Record<string, unknown> = {};
				if (curSecRaw2 && typeof curSecRaw2 === 'object' && !Array.isArray(curSecRaw2)) curSec2 = Object.assign({}, curSecRaw2 as Record<string, unknown>);
				if (tk === 'xFrameOptions' || tk === 'hsts' || tk === 'referrerPolicy' || tk === 'contentSecurityPolicy') {
					if (checked) curSec2[tk] = false;
					else {
						if (tk === 'xFrameOptions') curSec2[tk] = 'DENY';
						else if (tk === 'hsts') curSec2[tk] = 'max-age=31536000; includeSubDomains';
						else if (tk === 'referrerPolicy') curSec2[tk] = 'strict-origin-when-cross-origin';
						else if (tk === 'contentSecurityPolicy') curSec2[tk] = "default-src 'self'";
					}
				} else if (tk === 'autoEscape' || tk === 'csrf' || tk === 'redactLogs') {
					curSec2[tk] = checked;
				} else if (tk === 'trustProxy') {
					curSec2[tk] = checked ? true : false;
				} else if (tk === 'cors.credentials') {
					let corsObj = curSec2['cors'] as Record<string, unknown> | undefined;
					if (!corsObj || typeof corsObj !== 'object') corsObj = {};
					else corsObj = Object.assign({}, corsObj);
					if (checked) corsObj['credentials'] = true;
					else delete corsObj['credentials'];
					if (Object.keys(corsObj).length === 0) delete curSec2['cors'];
					else curSec2['cors'] = corsObj;
				}
				postVeskConfigKey('security', curSec2);
				return;
			}
		});
		contentEl.addEventListener('input', function (e) {
			const target = e.target as HTMLElement;
			if (target && target.getAttribute('data-agentic-input') === '1') {
				agenticInput = (target as HTMLInputElement).value;
				// Update only the slash popup, never re-render the whole panel:
				// recreating the textbox on every keystroke dismisses the mobile
				// keyboard and makes the UI jump.
				syncAgenticSlashPopup();
				return;
			}
			const cfgSrc = target.closest('[data-cfg-source]') as HTMLTextAreaElement | null;
			if (cfgSrc) {
				if (cfgState) cfgState.draftSource = cfgSrc.value;
				return;
			}
		});
		contentEl.addEventListener('keydown', function (e) {
			const ke = e as KeyboardEvent;
			const t = ke.target as HTMLElement;
			if (t && t.getAttribute('data-agentic-input') === '1' && ke.key === 'Enter') {
				e.preventDefault();
				sendAgenticMessage();
			}
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

	function setSettingsSubTab(sub: string): void {
		if (!isSettingsSubTab(sub)) return;
		settingsSubtab = sub;
		ui.settingsSubTab = sub as SettingsSubTab;
		persistUi();
		if (sub === 'vesk' && !cfgState && !cfgLoading) refreshVeskConfig();
		if (sub === 'agentic') {
			if (!agenticConfigState && !agenticConfigLoading) refreshAgenticConfig();
			// Always refresh live models via {PROVIDER}/models (through dev server proxy) when Agentic settings opened
			refreshAgenticModels();
		}
		renderPanel();
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
		if (tab === 'settings') {
			if (settingsSubtab === 'vesk' && !cfgState && !cfgLoading) refreshVeskConfig();
			if (settingsSubtab === 'agentic' && !agenticConfigState && !agenticConfigLoading) refreshAgenticConfig();
			// legacy mapping: old prefs/config -> new ids already handled via isSettingsSubTab, but ensure legacy 'config' still triggers
			if ((settingsSubtab === 'config' as string) && !cfgState && !cfgLoading) refreshVeskConfig();
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

	function syncAgenticSlashPopup(): void {
		if (!doc) return;
		const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
		if (!inputEl) return;
		const wrap = inputEl.closest('.__kp_ag_input_wrap') as HTMLElement | null;
		if (!wrap) return;
		const cur = wrap.querySelector('[data-agentic-popup]') as HTMLElement | null;
		const nextHtml =
			!agenticRunning && agenticInput.charAt(0) === '/'
				? renderAgenticSlashPopup(agenticInput, [], AGENTIC_PROVIDERS, [])
				: '';
		if (nextHtml) {
			if (cur) (cur as HTMLElement).outerHTML = nextHtml;
			else wrap.insertAdjacentHTML('afterbegin', nextHtml);
		} else if (cur) {
			cur.remove();
		}
	}

	function renderPanel(): void {
		if (!doc.getElementById('__vesk_dev')) createDot();
		if (!panelEl) return;
		if (!panelOpen) return;

		const content = doc.getElementById('__kp_content');
		if (!content) return;

		// If the agentic textbox is focused (actively typing on mobile), carry
		// focus + caret across the redraw so the keyboard never dismisses.
		const activeEl = doc.activeElement;
		const wasAgenticInput = !!activeEl && activeEl.getAttribute('data-agentic-input') === '1';
		const caret = wasAgenticInput ? (activeEl as HTMLInputElement).selectionStart : -1;

		const renderers: Record<string, () => string> = {
			overview: () =>
				renderOverviewPanel({
					host: win.location.host,
					lastCompileMs,
					lastError,
				}),
			agentic: () =>
				renderAgenticPanel({
					provider: ui.agenticProvider,
					model: ui.agenticModel,
					models: agenticModelsCache.length ? agenticModelsCache : ui.agenticModels,
					modelsLoading: agenticModelsLoading,
					modelsError: agenticModelsError,
					mode: ui.agenticMode,
					messages: agenticMessages,
					history: agenticHistory,
					historyLoading: agenticHistoryLoading,
					input: agenticInput,
					running: agenticRunning,
					error: agenticError || agenticHistoryError,
				}),
			errors: () => renderErrorsPanel(lastError),
			diagnostics: () =>
				diagnosticsError
					? '<div class="__kp_line">' + escapeHtml(diagnosticsError) + '</div>'
					: renderDiagnosticsPanel(diagnostics),
			plugins: () => renderPluginsTab(),
			log: () => renderLogPanel(log),
			settings: () => {
				// Build config render state for subtab
				let cfgRender: VeskConfigState | null = null;
				if (cfgLoading) {
					cfgRender = {
						path: cfgState ? cfgState.path : null,
						exists: cfgState ? cfgState.exists : false,
						source: cfgState ? cfgState.source : '',
						config: cfgState ? cfgState.config : {},
						loading: true,
						error: null,
						saving: cfgSaving,
						saveError: cfgSaveError,
						saveOk: cfgSaveOk,
						draftSource: cfgState ? cfgState.draftSource : '',
					};
				} else if (cfgError) {
					cfgRender = {
						path: cfgState ? cfgState.path : null,
						exists: cfgState ? cfgState.exists : false,
						source: cfgState ? cfgState.source : '',
						config: cfgState ? cfgState.config : {},
						loading: false,
						error: cfgError,
						saving: cfgSaving,
						saveError: cfgSaveError,
						saveOk: cfgSaveOk,
						draftSource: cfgState ? cfgState.draftSource : '',
					};
				} else if (cfgState) {
					cfgRender = {
						path: cfgState.path,
						exists: cfgState.exists,
						source: cfgState.source,
						config: cfgState.config,
						loading: false,
						error: null,
						saving: cfgSaving,
						saveError: cfgSaveError,
						saveOk: cfgSaveOk,
						draftSource: cfgState.draftSource,
					};
				}
				// Build agentic render state
				let agenticRender: AgenticConfigState | null = null;
				if (agenticConfigLoading) {
					agenticRender = agenticConfigState ? { ...agenticConfigState, loading: true } : { ...defaultAgenticConfigState(), loading: true, provider: ui.agenticProvider, model: ui.agenticModel, mode: ui.agenticMode, models: agenticModelsCache.slice() };
				} else if (agenticConfigError) {
					agenticRender = agenticConfigState ? { ...agenticConfigState, error: agenticConfigError } : { ...defaultAgenticConfigState(), error: agenticConfigError, provider: ui.agenticProvider, model: ui.agenticModel, mode: ui.agenticMode };
				} else if (agenticConfigState) {
					agenticRender = {
						...agenticConfigState,
						saving: agenticConfigSaving,
						saveError: agenticConfigSaveError,
						saveOk: agenticConfigSaveOk,
						// Live cache always wins over the possibly-stale config snapshot — the
						// subtab must show the models fetched for the CURRENT provider/baseUrl.
						models: agenticModelsCache.length ? agenticModelsCache.slice() : agenticConfigState.models,
						modelsLoading: agenticModelsLoading,
						modelsError: agenticModelsError,
					};
				} else {
					agenticRender = {
						...defaultAgenticConfigState(),
						provider: ui.agenticProvider,
						model: ui.agenticModel,
						mode: ui.agenticMode,
						models: agenticModelsCache.slice(),
						modelsLoading: agenticModelsLoading,
						modelsError: agenticModelsError,
					};
				}
				return renderSettingsPanel(ui as DevPrefs, agenticRender, cfgRender, settingsSubtab);
			},
		};
		const renderTab: (() => string) | undefined = renderers[activeTab];
		const html = renderTab ? renderTab() : '<div class="__kp_line">unknown tab: ' + escapeHtml(activeTab) + '</div>';
		content.innerHTML = '<div class="__kp_pane" data-tab="' + escapeHtml(activeTab) + '">' + html + '</div>';
		const pane = content.firstElementChild as HTMLElement | null;
		if (pane) {
			// Restore focus onto the redrawn textbox (skipping the scroll-to-top,
			// which would yank the pane out from under the keyboard).
			if (wasAgenticInput) {
				const nue = doc.querySelector('[data-agentic-input="1"]') as HTMLInputElement | null;
				if (nue) {
					nue.focus();
					try {
						nue.setSelectionRange(caret, caret);
					} catch (_e) {
						/* ignore selection restore failures */
					}
				}
			} else {
				pane.scrollTop = 0;
			}
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

	function refreshVeskConfig(): void {
		if (typeof fetch === 'undefined') return;
		cfgLoading = true;
		cfgError = null;
		renderPanel();
		fetch('/__vesk/config')
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.then(function (data: unknown) {
				const d = data as { path?: string | null; exists?: boolean; source?: string; config?: VeskConfigData; error?: string };
				if (d && d.error) throw new Error(String(d.error));
				cfgState = {
					path: d.path != null ? String(d.path) : null,
					exists: !!d.exists,
					source: typeof d.source === 'string' ? d.source : '',
					config: (d.config && typeof d.config === 'object' ? d.config : {}) as VeskConfigData,
					draftSource: typeof d.source === 'string' ? d.source : '',
				};
				cfgLoading = false;
				cfgError = null;
				cfgSaveError = null;
				cfgSaveOk = null;
				renderPanel();
			})
			.catch(function (e: unknown) {
				cfgLoading = false;
				cfgError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
	}

	function postVeskConfigKey(key: string, value: unknown): void {
		if (typeof fetch === 'undefined') {
			cfgSaveError = 'fetch unavailable';
			renderPanel();
			return;
		}
		cfgSaving = true;
		cfgSaveError = null;
		cfgSaveOk = null;
		renderPanel();
		fetch('/__vesk/config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key: key, value: value }),
		})
			.then(function (r) {
				return r.json().then(function (body: { error?: string; ok?: boolean; path?: string; source?: string; config?: VeskConfigData }) {
					if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
					return body;
				});
			})
			.then(function (body) {
				cfgSaving = false;
				if (body.config && typeof body.config === 'object') {
					if (!cfgState) cfgState = { path: body.path || null, exists: true, source: body.source || '', config: body.config as VeskConfigData, draftSource: body.source || '' };
					else {
						cfgState.config = body.config as VeskConfigData;
						cfgState.source = body.source || cfgState.source;
						cfgState.draftSource = body.source || cfgState.draftSource;
						cfgState.path = body.path || cfgState.path;
						cfgState.exists = true;
					}
				}
				cfgSaveOk = 'saved ' + key;
				setTimeout(function () { cfgSaveOk = null; renderPanel(); }, 2500);
				renderPanel();
			})
			.catch(function (e: unknown) {
				cfgSaving = false;
				cfgSaveError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
	}

	function postVeskConfigSource(source: string): void {
		if (typeof fetch === 'undefined') {
			cfgSaveError = 'fetch unavailable';
			renderPanel();
			return;
		}
		cfgSaving = true;
		cfgSaveError = null;
		cfgSaveOk = null;
		renderPanel();
		fetch('/__vesk/config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ source: source }),
		})
			.then(function (r) {
				return r.json().then(function (body: { error?: string; ok?: boolean; path?: string; source?: string; config?: VeskConfigData }) {
					if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
					return body;
				});
			})
			.then(function (body) {
				cfgSaving = false;
				if (body.config && typeof body.config === 'object') {
					if (!cfgState) cfgState = { path: body.path || null, exists: true, source: body.source || source, config: body.config as VeskConfigData, draftSource: body.source || source };
					else {
						cfgState.config = body.config as VeskConfigData;
						cfgState.source = body.source || source;
						cfgState.draftSource = body.source || source;
						cfgState.path = body.path || cfgState.path;
						cfgState.exists = true;
					}
				}
				cfgSaveOk = 'config saved';
				setTimeout(function () { cfgSaveOk = null; renderPanel(); }, 2500);
				renderPanel();
			})
			.catch(function (e: unknown) {
				cfgSaving = false;
				cfgSaveError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
	}

	function refreshAgenticConfig(): void {
		if (typeof fetch === 'undefined') return;
		agenticConfigLoading = true;
		agenticConfigError = null;
		renderPanel();
		fetch('/__vesk/agent/config')
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.then(function (data: unknown) {
				const d = data as Record<string, unknown>;
				const provider = typeof d.provider === 'string' && AGENTIC_PROVIDERS.indexOf(d.provider as string) !== -1 ? String(d.provider) : ui.agenticProvider;
				const model = typeof d.model === 'string' ? String(d.model) : ui.agenticModel;
				const baseUrl = typeof d.baseUrl === 'string' ? String(d.baseUrl) : (typeof (d as Record<string, unknown>).baseUrl === 'string' ? String((d as Record<string, unknown>).baseUrl) : '');
				agenticBaseUrl = baseUrl;
				const mode = typeof d.mode === 'string' && isAgenticMode(d.mode as string) ? (d.mode as AgenticMode) : ui.agenticMode;
				const maxSteps = typeof d.maxSteps === 'number' ? d.maxSteps as number : 25;
	agenticMaxSteps = maxSteps;
				const hasKey = !!d.hasKey;
				const keyPreview = typeof d.keyPreview === 'string' ? String(d.keyPreview) : null;
				const previews: Record<string, string | null> = {};
				const hasKeys: Record<string, boolean> = {};
				for (const p of AGENTIC_PROVIDERS) {
					if (p === provider) {
						hasKeys[p] = hasKey;
						previews[p] = keyPreview;
					} else {
						hasKeys[p] = false;
						previews[p] = null;
					}
				}
				agenticConfigState = {
					provider: provider,
					model: model,
					models: Array.isArray(d.models) ? (d.models as string[]) : agenticModelsCache.slice(),
					baseUrl: baseUrl,
					mode: mode,
					maxSteps: maxSteps,
					apiKeys: {},
					hasKeys: hasKeys,
					keyPreviews: previews,
					loading: false,
					error: null,
				};
				agenticConfigLoading = false;
				agenticConfigError = null;
				// sync ui — but never clobber the user's explicitly selected model with a
				// (possibly stale persisted) config default. The fresh per-provider fetched
				// list + user pick win; server config is only the persisted default.
				ui.agenticProvider = provider;
				if (!agenticSelectedModel) ui.agenticModel = model;
				ui.agenticMode = mode;
				persistUi();
				renderPanel();
			})
			.catch(function (e: unknown) {
				agenticConfigLoading = false;
				agenticConfigError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
	}

	function saveAgenticConfigPatch(patch: Record<string, unknown>): void {
		if (typeof fetch === 'undefined') {
			agenticConfigSaveError = 'fetch unavailable';
			renderPanel();
			return;
		}
		agenticConfigSaving = true;
		agenticConfigSaveError = null;
		agenticConfigSaveOk = null;
		renderPanel();
		fetch('/__vesk/agent/config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch),
		})
			.then(function (r) {
				return r.json().then(function (body: Record<string, unknown>) {
					if (!r.ok) throw new Error(String(body.error || 'HTTP ' + r.status));
					return body;
				});
			})
			.then(function () {
				agenticConfigSaving = false;
				agenticConfigSaveOk = 'saved';
				setTimeout(function () { agenticConfigSaveOk = null; renderPanel(); }, 2000);
				// update local state
				if (agenticConfigState) {
					if (typeof patch.provider === 'string') agenticConfigState.provider = String(patch.provider);
					if (typeof patch.model === 'string') agenticConfigState.model = String(patch.model);
					if (typeof patch.baseUrl === 'string') agenticConfigState.baseUrl = String(patch.baseUrl);
					if (typeof patch.mode === 'string' && isAgenticMode(patch.mode as string)) agenticConfigState.mode = patch.mode as AgenticMode;
					if (typeof patch.maxSteps === 'number') agenticConfigState.maxSteps = patch.maxSteps as number;
					agenticConfigState.saveOk = agenticConfigSaveOk;
				}
				if (typeof patch.provider === 'string') { ui.agenticProvider = String(patch.provider); persistUi(); }
				if (typeof patch.model === 'string') { ui.agenticModel = String(patch.model); persistUi(); }
				if (typeof patch.mode === 'string') { ui.agenticMode = patch.mode as AgenticMode; persistUi(); }
				renderPanel();
			})
			.catch(function (e: unknown) {
				agenticConfigSaving = false;
				agenticConfigSaveError = e instanceof Error ? e.message : String(e);
				if (agenticConfigState) agenticConfigState.saveError = agenticConfigSaveError;
				renderPanel();
			});
	}

	function saveAgenticApiKey(provider: string, key: string): void {
		if (!key.trim()) {
			agenticConfigSaveError = 'api key empty';
			renderPanel();
			return;
		}
		saveAgenticConfigPatch({ provider: provider, apiKey: key });
		// optimistic hasKey update
		if (agenticConfigState) {
			agenticConfigState.hasKeys[provider] = true;
			agenticConfigState.keyPreviews[provider] = maskApiKey(key);
		}
		renderPanel();
	}

	function refreshAgenticModels(): void {
		if (typeof fetch === 'undefined') return;
		agenticModelsLoading = true;
		agenticModelsError = null;
		renderPanel();
		const url = buildAgenticModelsUrl(ui.agenticProvider, agenticBaseUrl);
		fetch(url)
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.then(function (data: unknown) {
				const d = data as { models?: unknown; error?: string };
				let list: string[] = [];
				if (Array.isArray(d.models)) {
					list = (d.models as unknown[]).filter(function (v) { return typeof v === 'string' && (v as string).length > 0; }) as string[];
				} else if (Array.isArray(data)) {
					list = (data as unknown[]).filter(function (v) { return typeof v === 'string'; }) as string[];
				}
				// Live models always win — keep the settings subtab in sync with the cache.
				agenticModelsCache = list;
				ui.agenticModels = list.slice();
				if (agenticConfigState) {
					agenticConfigState.models = list.slice();
					agenticConfigState.modelsLoading = false;
					agenticConfigState.modelsError = null;
					// reflect the resolved provider/baseUrl so the subtab is self-consistent
					agenticConfigState.provider = ui.agenticProvider;
					agenticConfigState.baseUrl = agenticBaseUrl;
					// If the current model is not among the fetched models for this
					// provider, fall back to the first valid model (no hardcoding).
					if (list.length > 0 && list.indexOf(ui.agenticModel) === -1) {
						ui.agenticModel = list[0] as string;
						agenticConfigState.model = ui.agenticModel;
						persistUi();
						saveAgenticConfigPatch({ model: ui.agenticModel });
					}
				}
				persistUi();
				agenticModelsLoading = false;
				renderPanel();
			})
			.catch(function (e: unknown) {
				agenticModelsLoading = false;
				agenticModelsError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
	}

	function patchAgenticHistorySection(): void {
		const pane = agenticPaneEl();
		if (!pane) return;
		const block = pane.querySelector('[data-agentic="history-block"]') as HTMLElement | null;
		if (!block) return;
		block.innerHTML = renderAgenticHistory(agenticHistory, agenticHistoryLoading) +
			(agenticHistoryError ? '<div class="__kp_pl_err">' + String(agenticHistoryError) + '</div>' : '');
	}

	function refreshAgenticHistory(): void {
		if (typeof fetch === 'undefined') return;
		agenticHistoryLoading = true;
		agenticHistoryError = null;
		patchAgenticHistorySection();
		fetch('/__vesk/agent/history')
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.then(function (data: unknown) {
				const d = data as { history?: unknown; checkpoints?: unknown };
				const raw = Array.isArray(d.history) ? d.history : Array.isArray(d.checkpoints) ? d.checkpoints : Array.isArray(data) ? data : [];
				const list = raw as unknown[];
				agenticHistory = [];
				for (let i = 0; i < list.length; i++) {
					const c = list[i] as Record<string, unknown>;
					agenticHistory.push({
						id: String(c.id || c.checkpointId || i),
						message: String(c.message || c.label || c.id || ''),
						timestamp: typeof c.timestamp === 'number' ? c.timestamp as number : typeof c.createdAt === 'string' ? Date.parse(c.createdAt as string) || Date.now() : Date.now(),
						label: typeof c.label === 'string' ? c.label as string : typeof c.message === 'string' ? c.message as string : undefined,
					});
				}
				agenticHistoryLoading = false;
				patchAgenticHistorySection();
			})
			.catch(function (e: unknown) {
				agenticHistoryLoading = false;
				agenticHistoryError = e instanceof Error ? e.message : String(e);
				patchAgenticHistorySection();
			});
	}

	// Resolve the model to send: the user's explicit pick wins when it's valid for
	// the active provider; otherwise fall back to the first valid model in the
	// fetched per-provider list (never a dead hardcoded default).
	function resolveAgenticModel(): string {
		// A user's explicit pick reliably wins at send time.
		if (agenticSelectedModel) return agenticSelectedModel;
		const list = agenticModelsCache.length ? agenticModelsCache : ui.agenticModels;
		const pick = (ui.agenticModel || '').trim();
		if (pick && (list.length === 0 || list.indexOf(pick) !== -1)) return pick;
		if (list.length) return list[0];
		return pick;
	}

	function agenticPaneEl(): HTMLElement | null {
		const pane = doc.querySelector('#__vesk_dev .__kp_pane[data-tab="agentic"]') as HTMLElement | null;
		return pane;
	}

	function agenticPaneNearBottom(pane: HTMLElement): boolean {
		return pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 48;
	}

	function buildAgenticMessageEl(m: AgenticMessage, idx: number): HTMLElement {
		const role = m.role || 'user';
		const time = m.ts ? new Date(m.ts).toLocaleTimeString() : '';
		const wrap = doc.createElement('div');
		wrap.className = '__kp_ag_msg';
		wrap.setAttribute('data-role', role);
		wrap.setAttribute('data-idx', String(idx));
		const head = doc.createElement('div');
		head.className = '__kp_ag_msg_head';
		const roleSpan = doc.createElement('span');
		roleSpan.className = '__kp_ag_role';
		roleSpan.textContent = role;
		head.appendChild(roleSpan);
		if (time) {
			const t = doc.createElement('span');
			t.className = '__kp_ag_time';
			t.textContent = time;
			head.appendChild(t);
		}
		const body = doc.createElement('div');
		body.className = '__kp_ag_msg_body';
		body.textContent = m.content;
		wrap.appendChild(head);
		wrap.appendChild(body);
		return wrap;
	}

	function updateAgenticChatState(): void {
		// Send button + running indicator only for the live chat pane. The input
		// stays enabled while running (disabling a focused input blurs it and
		// dismisses the mobile keyboard); sends are guarded by agenticRunning.
		const pane = agenticPaneEl();
		if (!pane) return;
		const sendBtn = pane.querySelector('button[data-agentic-send]') as HTMLButtonElement | null;
		if (sendBtn) {
			sendBtn.disabled = !!agenticRunning;
			const label = agenticRunning
				? 'running' + (agenticRunStep > 0 ? ' step ' + agenticRunStep + (agenticRunBudget > 0 ? '/' + agenticRunBudget : '') : '') + '…'
				: 'send';
			if (sendBtn.textContent !== label) sendBtn.textContent = label;
		}
		const errHost = pane.querySelector('.__kp_pl_err') as HTMLElement | null;
		if (agenticError) {
			if (errHost) {
				errHost.textContent = agenticError;
			} else {
				const errDiv = doc.createElement('div');
				errDiv.className = '__kp_pl_err';
				const host = pane.querySelector('.__kp_ag_messages') as HTMLElement | null;
				if (host && host.parentNode) {
					if (host.nextSibling) host.parentNode.insertBefore(errDiv, host.nextSibling);
					else host.parentNode.appendChild(errDiv);
				} else {
					pane.appendChild(errDiv);
				}
			}
		} else if (errHost) {
			errHost.remove();
		}
	}

	// Incremental chat DOM update: grows/shrinks the message list in place and
	// patches the last message body as stream deltas arrive. The pane element is
	// never recreated, so scroll position and the textbox stay put during
	// send/receive — no UI jumping.
	function patchAgenticChat(): void {
		const pane = agenticPaneEl();
		if (!pane) return;
		let host = pane.querySelector('.__kp_ag_messages') as HTMLElement | null;
		if (!host) {
			// The empty chat renders only a placeholder line (no host node), so
			// create the host in its place the first time a message exists. We
			// NEVER re-render the whole pane here — that is what makes the UI jump.
			const wrap = doc.createElement('div');
			wrap.className = '__kp_ag_messages';
			wrap.setAttribute('data-agentic', 'messages');
			const placeholder = pane.querySelector('.__kp_line');
			if (placeholder && placeholder.parentNode === pane) {
				placeholder.parentNode.replaceChild(wrap, placeholder);
			} else {
				const inputWrap = pane.querySelector('.__kp_ag_input_wrap');
				if (inputWrap) pane.insertBefore(wrap, inputWrap);
				else pane.appendChild(wrap);
			}
			host = wrap;
		}
		if (pane && host) {
			let count = host.children.length;
			while (count < agenticMessages.length) {
				host.appendChild(buildAgenticMessageEl(agenticMessages[count], count));
				count++;
			}
			while (count > agenticMessages.length && host.lastChild) {
				host.removeChild(host.lastChild);
				count--;
			}
			for (let i = 0; i < agenticMessages.length; i++) {
				const row = host.children[i] as HTMLElement | null;
				if (!row) continue;
				const m = agenticMessages[i];
				const body = row.querySelector('.__kp_ag_msg_body') as HTMLElement | null;
				if (body && body.textContent !== m.content) body.textContent = m.content;
				if (m.ts) {
					const t = new Date(m.ts).toLocaleTimeString();
					const timeEl = row.querySelector('.__kp_ag_time') as HTMLElement | null;
					if (timeEl && timeEl.textContent !== t) timeEl.textContent = t;
				}
			}
			if (agenticRunning || agenticPaneNearBottom(pane)) {
				pane.scrollTop = pane.scrollHeight;
			}
		}
		updateAgenticChatState();
	}

	function consumeAgenticStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
		const decoder = new TextDecoder();
		let buffer = '';
		let finished = false;
		function dispatch(rawFrame: string): void {
			if (finished) return;
			let type = 'message';
			let data = '';
			const lines = rawFrame.split('\n');
			for (const line of lines) {
				if (line.indexOf('event:') === 0) type = line.slice(6).trim();
				else if (line.indexOf('data:') === 0) data = line.slice(5).trim();
			}
			if (!data) return;
			let ev: Record<string, unknown>;
			try {
				ev = JSON.parse(data) as Record<string, unknown>;
			} catch {
				return;
			}
			const evType = type;
			if (evType === 'step') {
				if (typeof ev.step === 'number') agenticRunStep = ev.step as number;
				if (typeof ev.budget === 'number' && (ev.budget as number) > 0) agenticRunBudget = ev.budget as number;
				updateAgenticChatState();
				return;
			}
			if (evType === 'text_delta') {
				const content = typeof ev.content === 'string' ? (ev.content as string) : '';
				if (!content) return;
				const cur = agenticMessages[agenticMessages.length - 1];
				if (cur && cur.role === 'assistant' && typeof cur.content === 'string') {
					cur.content += content;
				} else {
					agenticMessages.push({ role: 'assistant', content: content, ts: Date.now() });
				}
				patchAgenticChat();
				return;
			}
			if (evType === 'tool_call') {
				const call = ev.call as Record<string, unknown> | undefined;
				const name = call && typeof call.name === 'string' ? String(call.name) : '';
				if (name) {
					agenticMessages.push({ role: 'system', content: '→ tool: ' + name + (typeof ev.step === 'number' ? ' (step ' + String(ev.step) + ')' : ''), ts: Date.now() });
					patchAgenticChat();
				}
				return;
			}
			if (evType === 'error') {
				finished = true;
				agenticError = typeof ev.message === 'string' ? String(ev.message) : typeof ev.error === 'string' ? String(ev.error) : 'agent error';
				agenticRunning = false;
				agenticRunStep = 0;
				patchAgenticChat();
				return;
			}
			if (evType === 'done') {
				finished = true;
				const res = ev.result as Record<string, unknown> | undefined;
				const text = res && typeof res.text === 'string' ? String(res.text) : '';
				const cur = agenticMessages[agenticMessages.length - 1];
				if (cur && cur.role === 'assistant' && cur.content) {
					if (text && cur.content !== text) cur.content = text;
				} else if (text) {
					agenticMessages.push({ role: 'assistant', content: text, ts: Date.now() });
				}
				agenticRunning = false;
				agenticRunStep = 0;
				patchAgenticChat();
				refreshAgenticHistory();
			}
		}
		function pump(step: ReadableStreamReadResult<Uint8Array>): Promise<void> | void {
			if (step.done) {
				try {
					reader.releaseLock();
				} catch {
					/* already released */
				}
				agenticRunning = false;
				agenticRunStep = 0;
				patchAgenticChat();
				return;
			}
			buffer += decoder.decode(step.value as Uint8Array, { stream: true });
			let idx = buffer.indexOf('\n\n');
			while (idx !== -1) {
				const rawFrame = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				dispatch(rawFrame);
				idx = buffer.indexOf('\n\n');
			}
			return reader.read().then(pump);
		}
		return reader.read().then(pump);
	}

	function sendAgenticMessage(): void {
		if (agenticRunning) return;
		const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
		const text = inputEl ? inputEl.value : agenticInput;
		const prompt = (text || '').trim();
		if (!prompt) return;
		if (prompt.charAt(0) === '/') {
			const cmd = prompt.split(/\s+/)[0];
			if (AGENTIC_SLASH_COMMANDS.indexOf(cmd) !== -1) {
				handleAgenticSlash(cmd, prompt);
				return;
			}
		}
		agenticRunning = true;
		agenticError = null;
		agenticRunStep = 0;
		agenticRunBudget = agenticMaxSteps > 0 ? agenticMaxSteps : 0;
		agenticMessages.push({ role: 'user', content: prompt, ts: Date.now() });
		if (inputEl) inputEl.value = '';
		agenticInput = '';
		patchAgenticChat();
		if (typeof fetch === 'undefined') {
			agenticRunning = false;
			agenticError = 'fetch unavailable';
			patchAgenticChat();
			return;
		}
		const sendModel = resolveAgenticModel();
		if (!sendModel) {
			agenticRunning = false;
			agenticError = 'no model selected — refresh the model list for ' + ui.agenticProvider;
			patchAgenticChat();
			return;
		}
		const maxSteps = agenticMaxSteps > 0 ? agenticMaxSteps : undefined;
		fetch('/__vesk/agent/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: prompt, provider: ui.agenticProvider, model: sendModel, mode: ui.agenticMode, maxSteps: maxSteps, stream: true, providerConfig: { provider: ui.agenticProvider, model: sendModel } }),
		})
			.then(function (r) {
				const ctype = r.headers.get('content-type') || '';
				if (!r.ok) {
					return r.json().then(function (b) {
						throw new Error((b as { error?: string }).error || 'HTTP ' + r.status);
					});
				}
				if (ctype.indexOf('text/event-stream') !== -1 && r.body && typeof (r.body as ReadableStream<Uint8Array>).getReader === 'function') {
					return consumeAgenticStream((r.body as ReadableStream<Uint8Array>).getReader());
				}
				// Older server / non-streaming fallback: whole reply at once.
				return r.json().then(function (body) {
					const result = (body as { result?: { text?: string } }).result;
					const reply = result && typeof result.text === 'string' ? result.text : 'done';
					agenticMessages.push({ role: 'assistant', content: reply, ts: Date.now() });
					agenticRunning = false;
					agenticRunStep = 0;
					patchAgenticChat();
					refreshAgenticHistory();
				});
			})
			.catch(function (e: unknown) {
				agenticRunning = false;
				agenticRunStep = 0;
				agenticError = e instanceof Error ? e.message : String(e);
				patchAgenticChat();
			});
	}

	function handleAgenticSlash(cmd: string, full: string): void {
		// normalize /models -> /model
		const normalizedCmd = cmd === '/models' ? '/model' : cmd;
		if (normalizedCmd === '/help' || normalizedCmd === '/commands') {
			let help = 'slash commands: ' + AGENTIC_SLASH_COMMANDS.join(', ') + ' — provider: ' + ui.agenticProvider + ' model: ' + ui.agenticModel + ' mode: ' + ui.agenticMode + '\n';
			help += '/provider <openai|anthropic|google|ollama> — switch provider\n';
			help += '/model [name] — switch model or list models (no arg = list)\n';
			help += '/mode <explore|debug|agent> — switch mode\n';
			help += '/tools — list available vesk tools\n';
			help += '/commands — list this help\n';
			help += '/config — show current agentic config\n';
			help += '/history — refresh checkpoints\n';
			agenticMessages.push({ role: 'system', content: help, ts: Date.now() });
			const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl) inputEl.value = '';
			agenticInput = '';
			renderPanel();
			return;
		}
		if (normalizedCmd === '/clear') {
			agenticMessages = [];
			const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl) inputEl.value = '';
			agenticInput = '';
			renderPanel();
			return;
		}
		if (normalizedCmd === '/provider') {
			const arg = full.slice(cmd.length).trim().split(/\s+/)[0] || '';
			if (!arg || AGENTIC_PROVIDERS.indexOf(arg) === -1) {
				agenticMessages.push({ role: 'system', content: 'usage: /provider <' + AGENTIC_PROVIDERS.join('|') + '>  — current: ' + ui.agenticProvider, ts: Date.now() });
				renderPanel();
				return;
			}
			changePref('agenticProvider', arg);
			// also persist server-side via POST /__vesk/agent/config
			if (typeof fetch !== 'undefined') fetch('/__vesk/agent/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: arg }) }).catch(function () {});
			agenticMessages.push({ role: 'system', content: 'provider → ' + arg, ts: Date.now() });
			const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl) inputEl.value = '';
			agenticInput = '';
			renderPanel();
			return;
		}
		if (normalizedCmd === '/model') {
			const arg = full.slice(cmd.length).trim();
			if (!arg) {
				// list models for current provider
				agenticMessages.push({ role: 'system', content: 'fetching models for ' + ui.agenticProvider + '...', ts: Date.now() });
				renderPanel();
				if (typeof fetch !== 'undefined') {
					fetch(buildAgenticModelsUrl(ui.agenticProvider, agenticBaseUrl)).then(function (r) { return r.json(); }).then(function (data: { models?: string[] }) {
						const list = Array.isArray(data.models) ? data.models : [];
						agenticModelsCache = list; ui.agenticModels = list.slice(); persistUi();
						agenticMessages.push({ role: 'system', content: 'models (' + ui.agenticProvider + '): ' + (list.length ? list.join(', ') : 'none (fallback)'), ts: Date.now() });
						renderPanel();
					}).catch(function (e: unknown) {
						agenticMessages.push({ role: 'system', content: 'model list error: ' + (e instanceof Error ? e.message : String(e)), ts: Date.now() });
						renderPanel();
					});
				}
				const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
				if (inputEl) inputEl.value = '';
				agenticInput = '';
				return;
			}
			// set model
			const modelName = arg.split(/\s+/)[0];
			changePref('agenticModel', modelName);
			if (typeof fetch !== 'undefined') fetch('/__vesk/agent/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelName }) }).catch(function () {});
			agenticMessages.push({ role: 'system', content: 'model → ' + modelName, ts: Date.now() });
			const inputEl2 = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl2) inputEl2.value = '';
			agenticInput = '';
			renderPanel();
			return;
		}
		if (normalizedCmd === '/mode') {
			const arg = full.slice(cmd.length).trim().split(/\s+/)[0] || '';
			if (!arg || AGENTIC_MODES.indexOf(arg as AgenticMode) === -1) {
				agenticMessages.push({ role: 'system', content: 'usage: /mode <' + AGENTIC_MODES.join('|') + '>  — current: ' + ui.agenticMode, ts: Date.now() });
				renderPanel();
				return;
			}
			changePref('agenticMode', arg);
			if (typeof fetch !== 'undefined') fetch('/__vesk/agent/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: arg }) }).catch(function () {});
			agenticMessages.push({ role: 'system', content: 'mode → ' + arg, ts: Date.now() });
			const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl) inputEl.value = '';
			agenticInput = '';
			renderPanel();
			return;
		}
		if (normalizedCmd === '/tools') {
			agenticMessages.push({ role: 'system', content: 'fetching tools...', ts: Date.now() });
			renderPanel();
			if (typeof fetch !== 'undefined') {
				fetch('/__vesk/agent/tools').then(function (r) { return r.json(); }).then(function (data: { tools?: Array<{ name: string; description: string; capability: string }> }) {
					const tools = Array.isArray(data.tools) ? data.tools : [];
					const lines = tools.map(function (t) { return t.name + ' — ' + t.description + ' [' + t.capability + ']'; });
					agenticMessages.push({ role: 'system', content: 'tools (' + tools.length + '):\n' + lines.join('\n'), ts: Date.now() });
					renderPanel();
				}).catch(function (e: unknown) {
					agenticMessages.push({ role: 'system', content: 'tools error: ' + (e instanceof Error ? e.message : String(e)), ts: Date.now() });
					renderPanel();
				});
			}
			const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl) inputEl.value = '';
			agenticInput = '';
			return;
		}
		if (normalizedCmd === '/config') {
			if (typeof fetch !== 'undefined') {
				fetch('/__vesk/agent/config').then(function (r) { return r.json(); }).then(function (data: unknown) {
					agenticMessages.push({ role: 'system', content: 'config: ' + JSON.stringify(data, null, 2), ts: Date.now() });
					renderPanel();
				}).catch(function (e: unknown) {
					agenticMessages.push({ role: 'system', content: 'config error: ' + (e instanceof Error ? e.message : String(e)), ts: Date.now() });
					renderPanel();
				});
			}
			const inputElc = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputElc) inputElc.value = '';
			agenticInput = '';
			renderPanel();
			return;
		}
		if (normalizedCmd === '/history') {
			refreshAgenticHistory();
			agenticMessages.push({ role: 'system', content: 'refreshing history...', ts: Date.now() });
			const inputElh = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputElh) inputElh.value = '';
			agenticInput = '';
			renderPanel();
			return;
		}
		if (normalizedCmd === '/tool') {
			const name = full.slice(cmd.length).trim().split(/\s+/)[0] || '';
			if (!name) { agenticMessages.push({ role: 'system', content: 'usage: /tool <name> — try /tools to list', ts: Date.now() }); renderPanel(); return; }
			if (typeof fetch !== 'undefined') {
				fetch('/__vesk/agent/tools').then(function (r) { return r.json(); }).then(function (data: { tools?: Array<{ name: string; description: string }> }) {
					const hit = (data.tools || []).find(function (t) { return t.name === name; });
					if (hit) agenticMessages.push({ role: 'system', content: hit.name + ': ' + hit.description, ts: Date.now() });
					else agenticMessages.push({ role: 'system', content: 'tool not found: ' + name, ts: Date.now() });
					renderPanel();
				}).catch(function (e: unknown) { agenticMessages.push({ role: 'system', content: 'error: ' + (e instanceof Error ? e.message : String(e)), ts: Date.now() }); renderPanel(); });
			}
			const inputElt = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputElt) inputElt.value = '';
			agenticInput = '';
			return;
		}
		if (normalizedCmd === '/checkpoint') {
			agenticRunning = true;
			renderPanel();
			fetch('/__vesk/agent/checkpoint', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: full.slice('/checkpoint'.length).trim() || 'checkpoint' }),
			}).then(function (r) { return r.json().then(function (b: { error?: string }) { if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status); return b; }); }).then(function () {
				agenticRunning = false;
				agenticMessages.push({ role: 'system', content: 'checkpoint created', ts: Date.now() });
				renderPanel();
				refreshAgenticHistory();
			}).catch(function (e: unknown) {
				agenticRunning = false;
				agenticError = e instanceof Error ? e.message : String(e);
				renderPanel();
			});
			const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl) inputEl.value = '';
			agenticInput = '';
			return;
		}
		if (normalizedCmd === '/rollback') {
			const id = full.slice('/rollback'.length).trim();
			if (!id) {
				agenticMessages.push({ role: 'system', content: 'usage: /rollback <checkpointId>', ts: Date.now() });
				renderPanel();
				return;
			}
			rollbackAgenticCheckpoint(id);
			const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl) inputEl.value = '';
			agenticInput = '';
			return;
		}
		agenticMessages.push({ role: 'system', content: 'unknown slash command: ' + cmd + ' — try /help', ts: Date.now() });
		renderPanel();
	}

	function rollbackAgenticCheckpoint(id: string): void {
		if (typeof fetch === 'undefined') {
			agenticHistoryError = 'fetch unavailable';
			renderPanel();
			return;
		}
		agenticHistoryError = null;
		renderPanel();
		fetch('/__vesk/agent/rollback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ checkpointId: id }),
		})
			.then(function (r) {
				return r.json().then(function (body: { error?: string }) {
					if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
					return body;
				});
			})
			.then(function () {
				agenticMessages.push({ role: 'system', content: 'rolled back to ' + id, ts: Date.now() });
				renderPanel();
				refreshAgenticHistory();
			})
			.catch(function (e: unknown) {
				agenticHistoryError = e instanceof Error ? e.message : String(e);
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
				if (key === 'agenticProvider') saveAgenticConfigPatch({ provider: val });
				if (key === 'agenticModel') saveAgenticConfigPatch({ model: val });
				if (key === 'agenticMode' && isAgenticMode(val)) saveAgenticConfigPatch({ mode: val });
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
		const agenticSend = target.closest('[data-agentic-send]') as HTMLElement | null;
		if (agenticSend) {
			sendAgenticMessage();
			return;
		}
		const agenticRefresh = target.closest('[data-agentic-refresh-models]') as HTMLElement | null;
		if (agenticRefresh) {
			refreshAgenticModels();
			return;
		}
		const agenticRollback = target.closest('[data-agentic-rollback]') as HTMLElement | null;
		if (agenticRollback) {
			const id = agenticRollback.getAttribute('data-agentic-rollback') || '';
			if (id) rollbackAgenticCheckpoint(id);
			return;
		}
		const agenticProvider = target.closest('[data-agentic-provider]') as HTMLElement | null;
		if (agenticProvider) {
			const p = agenticProvider.getAttribute('data-agentic-provider') || '';
			if (p) {
				changePref('agenticProvider', p);
				saveAgenticConfigPatch({ provider: p });
				if (agenticConfigState) agenticConfigState.provider = p;
			}
			return;
		}
		const agenticModeBtn = target.closest('[data-agentic-mode]') as HTMLElement | null;
		if (agenticModeBtn) {
			const m = agenticModeBtn.getAttribute('data-agentic-mode') || '';
			if (m) {
				changePref('agenticMode', m);
				saveAgenticConfigPatch({ mode: m });
				if (agenticConfigState) agenticConfigState.mode = m as AgenticMode;
			}
			return;
		}
		const agenticPick = target.closest('[data-agentic-pick]') as HTMLElement | null;
		if (agenticPick) {
			const val = agenticPick.getAttribute('data-agentic-pick') || '';
			const inputEl = doc.querySelector('[data-agentic-input]') as HTMLInputElement | null;
			if (inputEl) {
				inputEl.value = val + ' ';
				agenticInput = val + ' ';
				inputEl.focus();
			} else {
				agenticInput = val + ' ';
			}
			renderPanel();
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
		const agenticSaveKey = target.closest('[data-agentic-save-key]') as HTMLElement | null;
		if (agenticSaveKey) {
			const prov = agenticSaveKey.getAttribute('data-agentic-save-key') || agenticSaveKey.getAttribute('data-provider') || '';
			const inp = doc.querySelector('[data-agentic-key-input="' + prov + '"]') as HTMLInputElement | null;
			const keyVal = inp ? inp.value : '';
			if (prov) saveAgenticApiKey(prov, keyVal);
			return;
		}
		const settingsSub = target.closest('[data-settings-subtab]') as HTMLElement | null;
		if (settingsSub) {
			const subRaw = settingsSub.getAttribute('data-settings-subtab') || settingsSub.getAttribute('data-settings-tab') || 'devtools';
			// support legacy ids
			let sub = subRaw;
			if (sub === 'prefs') sub = 'devtools';
			if (sub === 'config') sub = 'vesk';
			if (isSettingsSubTab(sub)) {
				setSettingsSubTab(sub);
			} else if (sub === 'config' || sub === 'prefs') {
				// fallback legacy
				setSettingsSubTab(sub === 'config' ? 'vesk' : 'devtools');
			}
			return;
		}
		if (target.closest('[data-cfg-save]')) {
			const ta = doc.querySelector('[data-cfg-source]') as HTMLTextAreaElement | null;
			const src = ta ? ta.value : (cfgState ? cfgState.source : '');
			postVeskConfigSource(src);
			return;
		}
		if (target.closest('[data-cfg-reload]')) {
			refreshVeskConfig();
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
