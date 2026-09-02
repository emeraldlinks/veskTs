/**
 * Vesk Runtime — dev HMR client unit tests (DOM-free).
 *
 * Imports the hmr-client source directly (before any dist rebuild) and
 * exercises the pure exported helpers: codeframe rendering, plugin rows,
 * error-node building, log rows, URL defaults, and the global `__vesk_hmr_*`
 * registration. Also asserts the adapter-tested literal substrings really
 * exist in the source file.
 *
 * Run: npx tsx packages/runtime/src/hmr-client.test.ts
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
	renderCodeframe,
	buildErrorNodes,
	renderPluginRow,
	renderLogRow,
	resolveUrls,
	registerGlobalHmr,
	renderTabBar,
	renderOverviewPanel,
	renderErrorsPanel,
	renderPluginsPanel,
	renderPluginCard,
	renderPluginListView,
	renderPluginCardsView,
	renderPluginDetail,
	renderPluginExports,
	renderPluginSearch,
	renderSearchPluginDetail,
	renderLogPanel,
	renderDiagnosticsPanel,
	renderSettingsPanel,
	renderVeskConfigPanel,
	renderSettingsWithConfig,
	renderSettingsSubtabs,
	loadDevtoolState,
	saveDevtoolState,
	defaultDevtoolState,
	DEV_STATE_KEY,
	PANEL_MIN_W,
	PANEL_MIN_H,
	PANEL_EDGE,
	DEV_TABS,
	PLUGIN_SEARCH_SUGGESTIONS,
} from './hmr-client';
import type { PluginRecord, PluginExportsData, PluginSearchResult, DevDiagnostic, VeskConfigState } from './hmr-client';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
	if (cond) {
		passed++;
		console.log('  \u2713 ' + msg);
	} else {
		failed++;
		console.log('  \u2717 ' + msg);
	}
}

function makeFrame(): NonNullable<Parameters<typeof renderCodeframe>[0]> {
	const code = [];
	for (let no = 995; no <= 1005; no++) {
		code.push({ no, text: no === 1000 ? 'const broken = this is not valid' : 'const fine = ' + no, isError: no === 1000 });
	}
	return { file: 'app/page.vsk', line: 1000, column: 17, context: 5, code };
}

console.log('\n\u2550\u2550\u2550 Vesk HMR client module tests (DOM-free) \u2550\u2550\u2550\n');

// --- codeframe rendering ----------------------------------------------------
{
	const html = renderCodeframe(makeFrame());

	assert(html.includes('class="kf-err"'), 'error line is inverse-video highlighted (kf-err)');
	assert(/<div class="kf-err">> /.test(html), 'error line gets a > gutter marker');
	assert(html.includes('<div>  <span class="kf-ln"> 995</span>'), 'non-error line gets a blank gutter marker');
	assert(html.includes('<span class="kf-ln">1000</span>'), 'gutter shows the exact line number unpadded');
	assert(html.includes('<span class="kf-ln"> 995</span>'), '5-above line present in the window');
	assert(html.includes('<span class="kf-ln">1005</span>'), '5-below line present in the window');
	assert(html.includes('kf-caret'), 'caret element present when column is set');
	assert(html.includes('^'), 'caret glyph rendered');

	const caretIdx = html.indexOf('kf-caret');
	assert(caretIdx > html.indexOf('broken'), 'caret appears on the error line after the text');

	assert(html.indexOf('995') < html.indexOf('1000'), 'lines render in ascending gutter order');
}

// codeframe with no column -> no caret
{
	const frame = makeFrame();
	frame.column = null as unknown as number;
	const html = renderCodeframe(frame);
	assert(!html.includes('kf-caret'), 'no caret when column is null');
	assert(html.includes('kf-err'), 'error line still highlighted without caret');
}

// codeframe with empty / missing code
{
	assert(renderCodeframe(null) === '', 'null frame renders empty');
	assert(renderCodeframe({} as never) === '', 'empty-code frame renders empty');
}

// --- buildErrorNodes --------------------------------------------------------
{
	const payload = {
		file: 'app/page.vsk',
		filePath: '',
		line: 1000,
		column: 17,
		message: 'Unexpected token',
		codeframe: makeFrame(),
		tips: ['Check your syntax'],
		suggestions: ['Use a valid expression', 'Wrap in parens'],
		nextSteps: ['Restart the dev server'],
		stack: 'at renderPage (app/page.vsk:1000:17)',
	};
	const nodes = buildErrorNodes(payload);

	assert(nodes.file.includes('app/page.vsk:1000:17'), 'file header shows file, line and column');
	assert(nodes.message === 'Unexpected token', 'message is escaped/copied verbatim');
	assert(nodes.codeframe.includes('kf-err'), 'codeframe piece includes the highlighted error line');
	assert(nodes.lists.includes('&gt; TIPS'), 'TIPS section label rendered (uppercase, > prefix)');
	assert(nodes.lists.includes('&gt; SUGGESTIONS'), 'SUGGESTIONS section label rendered');
	assert(nodes.lists.includes('&gt; NEXT STEPS'), 'NEXT STEPS section label rendered');
	assert(nodes.lists.includes('Check your syntax'), 'tip content rendered');
	assert(nodes.lists.indexOf('SUGGESTIONS') < nodes.lists.indexOf('NEXT STEPS'), 'sections keep declared order');
	assert(nodes.stack === 'at renderPage (app/page.vsk:1000:17)', 'stack text preserved');
}

// buildErrorNodes with missing optional fields
{
	const nodes = buildErrorNodes({ file: '', filePath: 'app/layout.vsk', line: 3, column: null, message: 'boop', codeframe: undefined, stack: undefined });
	assert(nodes.file.includes('app/layout.vsk:3'), 'falls back to filePath and still shows line');
	assert(!nodes.file.includes(':3:null'), 'null column is not appended');
	assert(nodes.codeframe === '', 'missing codeframe renders empty');
	assert(nodes.lists === '', 'no lists when no tips/suggestions/nextSteps');
	assert(nodes.stack === '(no stack trace)', 'missing stack shows placeholder');
}

// HTML escaping in error nodes
{
	const nodes = buildErrorNodes({
		file: 'a<b>.vsk',
		filePath: '',
		line: null,
		column: null,
		message: 'x < y && z > w',
		codeframe: { file: 'f', line: 1, column: 1, context: 1, code: [{ no: 1, text: '<div> & </div>', isError: true }] },
		tips: ['<script>alert(1)</script>'],
		stack: undefined,
	});
	assert(nodes.message.includes('&lt; y'), 'message angle brackets escaped');
	assert(nodes.codeframe.includes('&lt;div&gt;'), 'codeframe text escaped');
	assert(nodes.codeframe.includes('&amp;'), 'codeframe ampersand escaped');
	assert(nodes.lists.includes('&lt;script&gt;'), 'tip content escaped');
}

// --- plugin rows ------------------------------------------------------------
{
	const row = renderPluginRow({ name: 'tailwind', installed: true, active: true }, 0);
	assert(row.includes('&gt; tailwind'), 'plugin row has > name (HTML-escaped >)');
	assert(row.includes('[installed true]'), 'installed state rendered as bool');
	assert(row.includes('[active true]'), 'active state rendered as bool');

	const inactive = renderPluginRow({ name: 'seo', installed: false, active: false }, 1);
	assert(inactive.includes('[installed false]'), 'installed false rendered');

	const withErr = renderPluginRow({ name: 'md', installed: true, active: false, error: 'boom' }, 2);
	assert(withErr.includes('[error] boom'), 'plugin error line rendered');

	const unnamed = renderPluginRow({ installed: true, active: true } as never, 5);
	assert(unnamed.includes('plugin#5'), 'fallback name when name missing');
}

// --- log rows ---------------------------------------------------------------
{
	const row = renderLogRow({ type: 'update', ms: 12, time: 12, ts: 0 });
	assert(row.includes('update'), 'log row includes event type');
	assert(row.includes('12ms'), 'log row includes ms');
	assert(row.includes('--:--:--'), 'log row includes timestamp fallback for epoch 0');
}

// --- URL defaults -----------------------------------------------------------
{
	const def = resolveUrls();
	assert(def.stateUrl === '/__vesk/hmr/state', 'stateUrl defaults to /__vesk/hmr/state');
	assert(def.pluginsUrl === '/__vesk/plugins', 'pluginsUrl defaults to /__vesk/plugins');
	assert(def.diagnosticsUrl === '/__vesk/diagnostics', 'diagnosticsUrl defaults to /__vesk/diagnostics');
	const custom = resolveUrls({ stateUrl: '/custom/state', pluginsUrl: '/custom/plugins', diagnosticsUrl: '/custom/diag' });
	assert(custom.stateUrl === '/custom/state', 'stateUrl override respected');
	assert(custom.pluginsUrl === '/custom/plugins', 'pluginsUrl override respected');
	assert(custom.diagnosticsUrl === '/custom/diag', 'diagnosticsUrl override respected');
}

// --- global HMR show/dismiss registration -----------------------------------
{
	const api = { show: () => 'show', dismiss: () => 'dismiss' };
	registerGlobalHmr(api);
	const g = globalThis as Record<string, unknown>;
	assert(typeof g.__vesk_hmr_show === 'function', 'globalThis.__vesk_hmr_show registered as a function');
	assert(typeof g.__vesk_hmr_dismiss === 'function', 'globalThis.__vesk_hmr_dismiss registered as a function');
}

// --- tab bar ------------------------------------------------------------------
{
	const html = renderTabBar('errors');
	assert(DEV_TABS.length === 7, 'DEV_TABS exposes overview/agentic/errors/diagnostics/plugins/log/settings');
	assert(html.includes('data-tab="overview"'), 'tab bar includes overview tab');
	assert(html.includes('data-tab="diagnostics"'), 'tab bar includes diagnostics tab');
	assert(html.includes('data-tab="plugins"'), 'tab bar includes plugins tab');
	assert(html.includes('data-tab="settings"'), 'tab bar includes settings tab');
	for (const tab of DEV_TABS) {
		assert(html.includes('data-tab="' + tab + '"'), 'tab bar renders every configured tab: ' + tab);
	}
	assert(html.includes('class="__kp_tab active" data-tab="errors"'), 'active tab gets the active class');
	assert(!html.includes('class="__kp_tab active" data-tab="overview"'), 'only one tab is marked active');
}

// --- diagnostics panel ---------------------------------------------------------
{
	const empty = renderDiagnosticsPanel([]);
	assert(empty.includes('no findings'), 'empty diagnostics render a clear state');

	const findings: DevDiagnostic[] = [
		{ severity: 'error', code: 'HMR_COMPILE', file: 'app/page.vsk', line: 10, column: 4, message: 'Unexpected token', hint: 'Check brackets' },
		{ severity: 'warning', code: 'BUNDLE_SIZE', file: null, line: null, column: null, message: 'Client bundle is 420.0 KB', hint: 'Trim heavy imports' },
		{ severity: 'info', code: 'BUNDLE_SIZE', file: null, message: 'Client bundle is 12.0 KB.' },
	];
	const html = renderDiagnosticsPanel(findings);
	assert(html.includes('&gt; DIAGNOSTICS'), 'diagnostics panel header rendered');
	assert(html.includes('&gt; ERROR (1)'), 'errors grouped with count');
	assert(html.includes('&gt; WARNING (1)'), 'warnings grouped with count');
	assert(html.includes('&gt; INFO (1)'), 'info grouped with count');
	assert(html.indexOf('&gt; ERROR') < html.indexOf('&gt; WARNING'), 'errors listed before warnings');
	assert(html.indexOf('&gt; WARNING') < html.indexOf('&gt; INFO'), 'warnings listed before info');
	assert(html.includes('data-severity="error"'), 'finding carries its severity');
	assert(html.includes('Unexpected token'), 'message rendered');
	assert(html.includes('app/page.vsk:10:4'), 'file:line:column rendered');
	assert(html.includes('Check brackets'), 'hint rendered');
	assert(/ERROR/.test(html) && html.includes('HMR_COMPILE'), 'code shown next to badge');
}

// --- overview panel (no websocket status) -------------------------------------
{
	const html = renderOverviewPanel({ host: 'localhost:3000', lastCompileMs: 24, lastError: null });
	assert(html.includes('DEV SERVER: <b>localhost:3000</b>'), 'overview shows the dev server host');
	assert(html.includes('LAST COMPILE: <b>24ms</b>'), 'overview shows last compile time');
	assert(html.includes('LAST ERROR: <b>none</b>'), 'overview shows no last error');
	assert(!html.includes('WS'), 'overview never renders a websocket status label');

	const withErr = renderOverviewPanel({ host: 'h', lastCompileMs: 0, lastError: { file: 'x.vsk', filePath: '', line: null, column: null, message: 'boom', stack: undefined } });
	assert(withErr.includes('LAST COMPILE: <b>pending</b>'), 'overview shows pending before first compile');
	assert(withErr.includes('LAST ERROR: <b>boom</b>'), 'overview surfaces the last error message');
	assert(!withErr.includes('WS'), 'overview with an error still has no websocket status');
}

// --- errors panel --------------------------------------------------------------
{
	const empty = renderErrorsPanel(null);
	assert(empty.includes('no errors'), 'errors tab shows the empty state');

	const full = renderErrorsPanel({
		file: 'app/page.vsk', filePath: '', line: 1, column: 1, message: 'syntax',
		codeframe: makeFrame(), tips: ['tip'], suggestions: [], nextSteps: [], stack: 'at x',
	});
	assert(full.includes('&gt; ERRORS'), 'errors tab has ERRORS section label');
	assert(full.includes('<b>app/page.vsk:1:1</b>'), 'errors tab shows file/line/column');
	assert(full.includes('kf-err'), 'errors tab renders the codeframe');
	assert(full.includes('tip'), 'errors tab renders tips');
	assert(full.includes('Stack trace'), 'errors tab renders the stack details');
}

// --- plugins panel -------------------------------------------------------------
{
	const mk = (over: Partial<PluginRecord>): PluginRecord =>
		Object.assign(
			{
				name: '',
				package: '',
				path: null,
				active: false,
				installed: false,
				version: null,
				latest: null,
				description: null,
				author: null,
				license: null,
				homepage: null,
				repository: null,
				updatedAt: null,
				keywords: [],
				iconUrl: null,
				metaSource: 'none',
				source: 'state',
				error: null,
			},
			over
		);
	const tailwind = mk({ name: 'tailwind', package: '@vesk/tailwind', installed: true, active: true, version: '1.2.3', latest: '1.2.4', description: 'tw' });
	const seo = mk({ name: 'seo', installed: false, active: false });
	const cards = renderPluginsPanel([tailwind, seo], null, 'cards');
	assert(cards.includes('&gt; PLUGINS'), 'plugins tab has PLUGINS section label');
	assert(cards.includes('data-pl-view="cards"'), 'plugins toolbar offers a cards view toggle');
	assert(cards.includes('data-pl-view="list"'), 'plugins toolbar offers a list view toggle');
	assert(cards.includes('data-pl-search="1"'), 'plugins toolbar offers an install/search entry');
	assert(cards.includes('tailwind'), 'cards view lists each plugin row');
	assert(cards.includes('seo'), 'cards view lists every plugin');
	assert(cards.includes('__kp_pl_card'), 'cards view uses card markup');

	const list = renderPluginsPanel([tailwind, seo], null, 'list');
	assert(list.includes('__kp_pl_row'), 'list view uses row markup');
	assert(list.includes('__kp_pl_list'), 'list view wraps rows in a list container');

	const empty = renderPluginsPanel([], null);
	assert(empty.includes('no plugins reported'), 'plugins tab shows empty state');

	const err = renderPluginsPanel([], 'unavailable');
	assert(err.includes('kp-err'), 'plugins tab shows a fetch/state error');
	assert(err.includes('unavailable'), 'plugins tab surfaces the error text');
}

// --- plugin search + detail (install loading / pre-install detail) -----------
{
	const hit: PluginSearchResult = {
		name: '@vesk/plugin-demo',
		version: '1.0.0',
		description: 'demo plugin',
		author: 'acme',
		date: '2026-01-01',
		keywords: ['vesk'],
	};
	const idle = renderPluginSearch('@vesk', [hit], null, false, null);
	assert(idle.includes('&gt; INSTALL / SEARCH'), 'search view has INSTALL / SEARCH label');
	assert(idle.includes('data-search-pkg="@vesk/plugin-demo"'), 'search rows carry a data-search-pkg open trigger');
	assert(idle.includes('data-search-pkg-open="@vesk/plugin-demo"'), 'search rows offer a details action');
	assert(idle.includes('>install</button>'), 'install button is enabled when idle');
	assert(!idle.includes('installing...'), 'install button is not busy when idle');

	const busy = renderPluginSearch('@vesk', [hit], null, false, '@vesk/plugin-demo');
	assert(busy.includes('installing...'), 'install button shows a progressing state while installing');
	assert(busy.includes('disabled'), 'install button is disabled while installing');
	assert(busy.includes('please wait'), 'a progress message is shown while installing');

	const column = renderPluginSearch('@vesk', [hit], null, false, '@vesk/other');
	assert(column.includes('>install</button>') && !column.includes('installing...'), 'only the in-flight package shows a busy install state');

	const detail = renderSearchPluginDetail(hit, null);
	assert(detail.includes('&gt; PLUGIN (npm)'), 'search-result detail has a PLUGIN (npm) label');
	assert(detail.includes('@vesk/plugin-demo'), 'search-result detail shows the package name');
	assert(detail.includes('not installed'), 'search-result detail marks the plugin as not installed');
	assert(detail.includes('demo plugin'), 'search-result detail shows the npm description');
	assert(detail.includes('acme'), 'search-result detail shows the npm author');
	assert(detail.includes('data-pl-install="@vesk/plugin-demo"'), 'search-result detail offers an install action');
	assert(detail.includes('>install</button>'), 'search-result detail install button is enabled while idle');

	const busyDetail = renderSearchPluginDetail(hit, '@vesk/plugin-demo');
	assert(busyDetail.includes('installing...'), 'search-result detail install shows progress while installing');
	assert(busyDetail.includes('disabled'), 'search-result detail install is disabled while installing');

	const instRow = renderPluginSearch('@vesk', [hit], null, false, null, ['@vesk/plugin-demo']);
	assert(instRow.includes('__kp_pl_badge on'), 'search rows mark an already-installed package with an installed badge');
	assert(instRow.includes('>installed</button>'), 'install button is relabeled installed when the package is already installed');
	assert(instRow.indexOf('>installed</button>') > -1 && instRow.includes('disabled'), 'install button is disabled for an already-installed package');

	const missingRow = renderPluginSearch('@vesk', [hit], null, false, null, ['@vesk/other']);
	assert(!missingRow.includes('__kp_pl_badge on'), 'uninstalled search rows do not get an installed badge');
	assert(missingRow.includes('>install</button>'), 'uninstalled search rows keep the install action enabled');

	const instDetail = renderSearchPluginDetail(hit, null, ['@vesk/plugin-demo']);
	assert(instDetail.includes('__kp_pl_badge on') && instDetail.includes('installed'), 'installed search-result detail shows an installed badge');
	assert(instDetail.includes('>installed</button>') && instDetail.includes('disabled'), 'installed search-result detail disables the install button');
}

// --- log panel -----------------------------------------------------------------
{
	const html = renderLogPanel([{ type: 'update', ms: 5, time: 5, ts: 0 }]);
	assert(html.includes('&gt; LOG'), 'log tab has LOG section label');
	assert(html.includes('update'), 'log tab renders log rows');

	const empty = renderLogPanel([]);
	assert(empty.includes('no events yet'), 'log tab shows empty state');
}

// --- settings panel -------------------------------------------------------------
{
	const html = renderSettingsPanel({ theme: 'light', pos: 'right', pluginsView: 'cards', sidebarMode: 'expanded' });
	assert(html.includes('&gt; SETTINGS'), 'settings tab has SETTINGS section label');
	assert(html.includes('data-key="theme"'), 'settings tab exposes a theme control');
	assert(html.includes('data-key="pos"'), 'settings tab exposes a position control');
	for (const val of ['system', 'light', 'dark']) {
		assert(html.includes('data-val="' + val + '"'), 'settings tab offers theme option: ' + val);
	}
	for (const val of ['left', 'right']) {
		assert(html.includes('data-val="' + val + '"'), 'settings tab offers position option: ' + val);
	}
	assert(html.includes('data-key="pluginsView"'), 'settings tab exposes a plugin view control');
	assert(html.includes('data-val="cards"') && html.includes('data-val="list"'), 'settings tab offers cards/list plugin view options');
	assert(html.includes('data-key="sidebarMode"'), 'settings tab exposes a sidebar mode control');
	assert(html.includes('data-val="expanded"') && html.includes('data-val="rail"'), 'settings tab offers expanded/rail sidebar options');
	assert(html.includes('class="__kp_opt active" data-key="theme" data-val="light"'), 'active theme option is marked');
	assert(html.includes('class="__kp_opt active" data-key="pos" data-val="right"'), 'active position option is marked');
	assert(html.includes('class="__kp_opt active" data-key="pluginsView" data-val="cards"'), 'active plugin view option is marked');
	assert(html.includes('class="__kp_opt active" data-key="sidebarMode" data-val="expanded"'), 'active sidebar mode option is marked');
	assert(!html.includes('class="__kp_opt active" data-key="theme" data-val="dark"'), 'inactive theme options are not marked active');
	assert(!html.includes('class="__kp_opt active" data-key="pos" data-val="left"'), 'inactive position options are not marked active');
}

// --- Vesk Config panel (settings subtab) ---------------------------------------
{
	const loading = renderVeskConfigPanel(null);
	assert(loading.includes('VESK CONFIG'), 'vesk config panel has VESK CONFIG label when loading');
	assert(loading.includes('loading config'), 'vesk config shows loading state when null');
	assert(loading.includes('/__vesk/config'), 'vesk config loading hints at GET /__vesk/config');

	const errState: VeskConfigState = { path: null, exists: false, source: '', config: {}, loading: false, error: 'fetch failed', draftSource: '' };
	const errHtml = renderVeskConfigPanel(errState);
	assert(errHtml.includes('fetch failed'), 'vesk config surfaces load error');
	assert(errHtml.includes('data-cfg-reload'), 'vesk config error offers retry');

	const full: VeskConfigState = {
		path: '/proj/vesk.config.ts',
		exists: true,
		source: "import { defineConfig } from '@vesk/compiler'\nexport default defineConfig({ appDir: 'app' })\n",
		config: {
			appDir: 'app',
			outDir: '.vesk',
			publicDir: 'public',
			routeDataCache: 1500,
			md: { html: 'allowlist', allowTags: ['a', 'em', 'strong'] },
			security: {
				xFrameOptions: 'DENY',
				hsts: 'max-age=31536000; includeSubDomains',
				referrerPolicy: 'strict-origin-when-cross-origin',
				contentSecurityPolicy: "default-src 'self'",
				autoEscape: true,
				csrf: true,
				redactLogs: true,
				trustProxy: true,
				cors: { origin: '*', methods: 'GET, POST' },
				rateLimit: { windowMs: 60000, max: 100 },
			},
		},
		draftSource: "import { defineConfig } from '@vesk/compiler'\nexport default defineConfig({ appDir: 'app' })\n",
	};
	const html = renderVeskConfigPanel(full);
	assert(html.includes('VESK CONFIG'), 'vesk config panel has VESK CONFIG label');
	assert(html.includes('data-cfg-key="appDir"'), 'vesk config has appDir text input');
	assert(html.includes('data-cfg-key="outDir"'), 'vesk config has outDir text input');
	assert(html.includes('data-cfg-key="publicDir"'), 'vesk config has publicDir text input');
	assert(html.includes('data-cfg-key="routeDataCache"') && html.includes('type="number"'), 'vesk config has routeDataCache number input');
	assert(html.includes('data-cfg-md-html'), 'vesk config has md.html select');
	for (const v of ['escape', 'allow', 'allowlist']) assert(html.includes('value="' + v + '"'), 'vesk config md.html offers option ' + v);
	assert(html.includes('data-cfg-md-tags'), 'vesk config has allowTags multi-input');
	assert(html.includes('a, em, strong') || html.includes('a,em'), 'vesk config allowTags shows current tags');
	assert(html.includes('data-sec-key="xFrameOptions"'), 'vesk config has xFrameOptions input');
	assert(html.includes('data-sec-key="hsts"'), 'vesk config has hsts input');
	assert(html.includes('data-sec-key="referrerPolicy"'), 'vesk config has referrerPolicy input');
	assert(html.includes('data-sec-key="contentSecurityPolicy"') || html.includes('contentSecurityPolicy'), 'vesk config has csp input');
	assert(html.includes('data-sec-toggle="autoEscape"'), 'vesk config has autoEscape toggle');
	assert(html.includes('data-sec-toggle="csrf"'), 'vesk config has csrf toggle');
	assert(html.includes('data-sec-toggle="redactLogs"'), 'vesk config has redactLogs toggle');
	assert(html.includes('data-sec-toggle="trustProxy"') || html.includes('trustProxy'), 'vesk config has trustProxy control');
	assert(html.includes('data-sec-key="cors.origin"'), 'vesk config has cors.origin input');
	assert(html.includes('data-sec-key="rateLimit.windowMs"'), 'vesk config has rateLimit window');
	assert(html.includes('data-sec-key="rateLimit.max"'), 'vesk config has rateLimit max');
	assert(html.includes('data-cfg-source'), 'vesk config has raw textarea editor');
	assert(html.includes('data-cfg-save'), 'vesk config has save button');
	assert(html.includes('POST /__vesk/config {source}'), 'vesk config hints at POST {source} validation');
	// plugins must be excluded entirely
	assert(!html.includes('data-cfg-key="plugins"') && !html.toLowerCase().includes('> plugins</div>'), 'vesk config excludes plugins section');
	assert(!html.includes('plugins:') || html.includes('plugins excluded'), 'vesk config does not expose plugins field');
	// security toggles are present but not as plugins
	assert(html.includes('SECURITY'), 'vesk config renders security section');

	const withSaveOk: VeskConfigState = Object.assign({}, full, { saveOk: 'saved appDir', saving: false });
	const saveOkHtml = renderVeskConfigPanel(withSaveOk);
	assert(saveOkHtml.includes('saved appDir'), 'vesk config shows saveOk feedback');

	const withSaveErr: VeskConfigState = Object.assign({}, full, { saveError: 'invalid config', saving: false });
	const saveErrHtml = renderVeskConfigPanel(withSaveErr);
	assert(saveErrHtml.includes('invalid config'), 'vesk config shows saveError');

	const subPrefs = renderSettingsSubtabs('devtools');
	assert(subPrefs.includes('data-settings-subtab="devtools"'), 'settings subtabs has devtools/prefs');
	assert(subPrefs.includes('data-settings-subtab="vesk"'), 'settings subtabs has vesk/config');
	assert(subPrefs.includes('VESK CONFIG'), 'settings subtabs labels VESK CONFIG');

	const subCfg = renderSettingsSubtabs('vesk');
	assert(subCfg.includes('active') && subCfg.indexOf('data-settings-subtab="vesk"') < subCfg.indexOf('active') + 200, 'config subtab active is marked');

	const combinedPrefs = renderSettingsWithConfig({ theme: 'dark', pos: 'left', pluginsView: 'list', sidebarMode: 'rail' }, 'devtools', null);
	assert(combinedPrefs.includes('&gt; SETTINGS'), 'combined settings has SETTINGS label in prefs mode');
	assert(combinedPrefs.includes('VESK CONFIG'), 'combined settings always hints at VESK CONFIG subtab');

	const combinedCfg = renderSettingsWithConfig({ theme: 'dark', pos: 'left', pluginsView: 'list', sidebarMode: 'rail' }, 'vesk', full);
	assert(combinedCfg.includes('data-cfg-key="appDir"'), 'combined settings in config mode renders vesk config panel');
	assert(combinedCfg.includes('data-cfg-source'), 'combined settings config mode has raw editor');
}

// --- devtool state persistence ----------------------------------------------------
{
	const defaults = defaultDevtoolState();
	assert(defaults.theme === 'system', 'theme defaults to system');
	assert(defaults.pos === 'right', 'position defaults to right');
	assert(defaults.activeTab === 'overview', 'active tab defaults to overview');
	assert(defaults.open === false, 'panel starts closed');
	assert(defaults.w === 520 && defaults.h === 420, 'panel has a default size');
	assert(defaults.maxed === false, 'panel starts un-maximized');

	const stub = {
		data: '',
		getItem(k: string) { return k === DEV_STATE_KEY ? this.data : null; },
		setItem(_k: string, v: string) { this.data = v; },
		removeItem(_k: string) {},
		clear() { this.data = ''; },
		key(_i: number) { return null; },
		get length() { return this.data ? 1 : 0; },
	} as Storage;
	saveDevtoolState(stub, {
		theme: 'dark',
		pos: 'left',
		activeTab: 'settings',
		open: true,
		w: 640,
		h: 480,
		maxed: true,
	});
	const loaded = loadDevtoolState(stub);
	assert(loaded.theme === 'dark', 'persisted dark theme is restored');
	assert(loaded.pos === 'left', 'persisted left position is restored');
	assert(loaded.activeTab === 'settings', 'persisted active tab is restored');
	assert(loaded.open === true, 'persisted open state is restored');
	assert(loaded.w === 640 && loaded.h === 480, 'persisted panel size is restored');
	assert(loaded.maxed === true, 'persisted maximized state is restored');

	const corrupt = loadDevtoolState({ getItem() { return '{nope'; } } as Storage);
	assert(corrupt.theme === 'system', 'corrupt persisted state falls back to defaults');

	const tiny = loadDevtoolState({ getItem() { return JSON.stringify({ w: 10, h: 10 }); } } as Storage);
	assert(tiny.w === PANEL_MIN_W, 'persisted width below minimum is clamped up');
	assert(tiny.h === PANEL_MIN_H, 'persisted height below minimum is clamped up');

	const unknownTab = loadDevtoolState({ getItem() { return JSON.stringify({ activeTab: 'mx' }); } } as Storage);
	assert(unknownTab.activeTab === 'overview', 'persisted unknown tab falls back to overview');
}

// --- adapter-asserted literal substrings present in source -------------------
{
	const src = readFileSync(resolve(__dirname, 'hmr-client.ts'), 'utf-8');
	assert(src.includes('__vesk_dev'), 'source contains __vesk_dev');
	assert(src.includes('WebSocket'), 'source contains WebSocket');
	assert(src.includes("'update'") || src.includes('"update"'), 'source handles "update" messages');
	assert(src.includes("'reload'") || src.includes('"reload"'), 'source handles "reload" messages');
	assert(src.includes('nonce'), 'source captures/forwards the update nonce');
	assert(src.includes('__vesk_router'), 'source calls __vesk_router');
	assert(!src.includes('WS: '), 'source no longer renders a websocket status line');
	assert(!src.includes('__kp_statusdot'), 'source no longer renders the websocket status dot');
	assert(src.includes('__kp_tab'), 'source renders tabbed dev panel');
	assert(src.includes('__kp_max'), 'source supports panel expand/collapse');
	assert(src.includes('__kp_handle'), 'source renders a resize handle');
	assert(src.includes('__kp_pane'), 'source animates tab content panes');
	assert(src.includes('resizing'), 'source disables transitions while dragging to resize');
	assert(src.includes('cubic-bezier'), 'source uses eased transitions for a premium feel');
	assert(src.includes('maxed'), 'source supports the maximize state');
	assert(src.includes("querySelector('.__kp_tabs')"), 'tab clicks are wired to the tab bar element');
	assert(src.includes('min(480px,50vh)'), 'maximize targets half the viewport height, not the full screen');
	assert(src.includes('50vw'), 'maximized width is capped at half the viewport');
	assert(!src.includes('.__kp.maxed{width:calc(100vw'), 'maximized panel no longer fills the whole screen');
	assert(src.includes('PANEL_EDGE'), 'resize clamp accounts for the fixed side offset (no left overflow)');
	assert(src.includes('max-width:calc(100vw - 32px)'), 'panel width cap leaves a margin so it never overflows left');
	assert(src.includes('__kp_opt'), 'source renders theme/position option controls');
	assert(src.includes(`data-pos', ui.pos`), 'source applies the panel side via data-pos');
	assert(src.includes("pos: 'right'"), 'source defaults the panel to the right side');
	assert(src.includes('prefers-color-scheme'), 'source follows the system light/dark preference');
	assert(src.includes('data-theme'), 'source applies the selected theme to the dev tool');
 	assert(src.includes('saveDevtoolState'), 'source persists the full devtool UI state');
 	assert(src.includes('ui.open = false') && src.includes('persistUi()'), 'source persists closed state when the devtool panel is dismissed');
 	assert(src.includes('DEV_STATE_KEY'), 'source versions the persisted devtool state key');
	assert(src.includes('scrollbar-width:none'), 'source hides scrollbars across the devtools root');
	assert(src.includes('::-webkit-scrollbar'), 'source suppresses webkit scrollbars while keeping scrollable panes');
	assert(src.includes('data-sidebar="rail"'), 'source supports the rail sidebar mode');
	assert(src.includes('grid-template-areas:"head head" "tabs body"'), 'sidebar mode places tabs left of content as a real two-column layout');
	assert(src.includes('grid-area:tabs') && src.includes('grid-area:body'), 'sidebar mode assigns tabs and content to separate grid columns');
	assert(src.includes('width:52px') && src.includes('width:104px'), 'sidebar collapses to a thin rail (~90% content) and expands on hover (~80% content)');
	assert(src.includes('#__kp_content'), 'source bounds the content wrapper for vertical scrolling');
	assert(src.includes('min-height:0'), 'source lets the scrollable pane shrink below its content (restores scrolling)');
	assert(src.includes('overflow-y:auto'), 'source keeps the content pane vertically scrollable');
	assert(src.includes('renderSearchPluginDetail'), 'source renders a pre-install detail view for npm search results');
	assert(src.includes('data-search-pkg-open'), 'source wires a details action on npm search results');
	assert(src.includes('pluginInstalling'), 'source tracks an in-flight plugin install (loading state)');
	assert(src.includes('installing...'), 'source surfaces an install progress label');
	assert(src.includes('please wait'), 'source shows a wait hint while installing a plugin');
	assert(src.includes('__kp_pl_list'), 'source wraps search results in a scrollable list');
	assert(src.includes('__kp_pl_badge on'), 'source marks installed npm search results with an installed badge');
	assert(src.includes("isInstalled ? 'installed' : 'install'"), 'source disables install for already-installed search results');
	assert(src.includes('/__vesk/config'), 'source fetches GET /__vesk/config on settings open');
	assert(src.includes('renderVeskConfigPanel'), 'source has Vesk Config panel renderer');
	assert(src.includes('renderSettingsWithConfig') || src.includes('renderSettingsSubtabs'), 'source has settings subtab for Vesk Config');
	assert(src.includes('data-cfg-key="appDir"') || src.includes("data-cfg-key"), 'source has appDir/outDir/publicDir inputs');
	assert(src.includes('data-cfg-key="routeDataCache"'), 'source has routeDataCache number input');
	assert(src.includes('data-cfg-md-html'), 'source has md.html select');
	assert(src.includes('data-cfg-md-tags'), 'source has allowTags multi-input');
	assert(src.includes('data-sec-key="xFrameOptions"'), 'source has xFrameOptions security control');
	assert(src.includes('data-sec-toggle="autoEscape"'), 'source has autoEscape security toggle');
	assert(src.includes('data-sec-toggle="csrf"'), 'source has csrf security toggle');
	assert(src.includes('data-cfg-source'), 'source has raw vesk.config.ts textarea editor');
	assert(src.includes('data-cfg-save'), 'source has save + validation for config source');
	assert(src.includes('postVeskConfigKey') || src.includes("POST") && src.includes("/__vesk/config"), 'source posts {key,value} or {source} to /__vesk/config');
	assert(!src.includes('data-cfg-key="plugins"'), 'source excludes plugins from Vesk Config (plugins excluded entirely)');
	assert(src.includes('__kp_cfg_input'), 'source styles config inputs');
	assert(src.includes('__kp_cfg_textarea'), 'source styles raw editor textarea');
	assert(src.includes('__kp_cfg_select'), 'source styles config selects');

	// -- agentic send-time model fix: user-selected model wins, never a stale default
	assert(src.includes('agenticSelectedModel'), 'source tracks the user\u2019s explicitly selected model');
	assert(
		src.includes("if (!agenticSelectedModel) ui.agenticModel = model"),
		'source never clobbers the user-selected model with the persisted config default on load'
	);
	assert(
		src.includes("agenticSelectedModel = val") ,
		'source records the user\u2019s model pick in changePref(agenticModel)'
	);
	assert(
		src.includes('resolveAgenticModel'),
		'source resolves a send-time model rather than reading ui.agenticModel directly'
	);
	assert(
		src.includes('providerConfig: { provider: ui.agenticProvider, model: sendModel }'),
		'source sends the resolved model via providerConfig (user pick wins)'
	);
	assert(
		src.includes('agenticSelectedModel = \'\'') &&
			src.includes("key === 'agenticProvider'"),
		'source clears the model pick when the provider changes (model is provider-scoped)'
	);
	// no dead hardcoded gpt-4o-mini default that opencode rejects — anywhere in the client
	assert(!src.includes("'gpt-4o-mini'"), 'no gpt-4o-mini literal anywhere in the dev client (model names come from the per-provider fetch)');
	assert(
		src.includes("no model selected") || src.includes('no model to send'),
		'source guards against sending with no resolved model'
	);
	assert(
		src.includes('syncAgenticSlashPopup'),
		'source patches only the slash popup on keystrokes (no full re-render that destroys the textbox)'
	);
	assert(
		src.includes('Update only the slash popup, never re-render the whole panel'),
		'source documents why keystrokes must not re-render the panel (mobile keyboard dismiss)'
	);
	assert(
		src.includes('.__kp_ag_input_wrap{position:sticky;bottom:0'),
		'source pins the message textbox to the bottom of the panel (static bottom, no jump)'
	);
	assert(
		src.includes('wasAgenticInput') && src.includes('setSelectionRange(caret, caret)'),
		'source carries focus + caret across panel redraws so the keyboard stays up while typing'
	);
assert(
 		src.includes("if (wasAgenticInput)") && src.includes('nue.focus()'),
 		'source re-focuses the redrawn textbox only when it was the focused element'
 	);

 	// -- follow-up: no jumping UI, no premature stop (maxSteps), streaming progress
 	assert(src.includes('agenticMaxSteps'), 'source tracks a client-side max-steps budget');
 	assert(src.includes('agenticRunStep') && src.includes('agenticRunBudget'), 'source tracks live step/budget for the progress label');
 	assert(
 		src.includes('maxSteps: maxSteps'),
 		'source sends maxSteps with every agent chat send'
 	);
 	assert(
 		src.includes('stream: true'),
 		'source requests a streaming response from the agent endpoint'
 	);
 	assert(
 		src.includes("indexOf('text/event-stream')"),
 		'source detects the SSE response so it can stream rather than buffer'
 	);
 	assert(src.includes('consumeAgenticStream'), 'source streams the agent reply from the response body reader');
 	assert(src.includes('getReader'), 'source consumes a ReadableStream body for agent replies');
 	assert(src.includes('patchAgenticChat'), 'source patches the chat host in place (no full panel re-render)');
 	assert(
 		src.includes('const host = pane') &&
 			src.includes("pane.querySelector('.__kp_ag_messages')"),
 		'source resolves the persistent message host inside the existing pane'
 	);
 	assert(
 		src.includes('host.dataset.agentic =') || src.includes("data-agentic=\"messages\""),
 		'source tags a persistent messages host node'
 	);
 	assert(
 		src.includes('host.appendChild(buildAgenticMessageEl') && src.includes('host.removeChild(host.lastChild)'),
 		'source grows/shrinks only the persistent messages host child list (no pane re-creation)'
 	);
 	assert(
 		src.includes('agenticPaneNearBottom'),
 		'source keeps the scroll position unless the user is already near the bottom'
 	);
 	assert(
 		src.includes('agenticRunning') && src.includes('agenticPaneNearBottom(pane)'),
 		'source always keeps the newest content in view while a run is in flight'
 	);
 	assert(
 		src.includes('running step ') || src.includes("'running'") || src.includes('running step'),
 		'source labels the send button with live step/budget progress'
 	);
assert(
 		src.includes('steps per run (1-200)') || src.includes('(1-200)'),
 		'source documents the 200-step cap in the settings control'
 	);
 	assert(
 		src.includes('data-agentic-key="maxSteps"') && src.includes('max="200"'),
 		'source settings cap agent max-steps at 200'
 	);
 	assert(src.includes('let agenticMaxSteps = 25'), 'source defaults the step budget to 25');
 	assert(
 		src.includes('agenticMaxSteps = maxSteps'),
 		'source syncs the live budget from GET /__vesk/agent/config'
 	);
 	assert(
 		src.includes('agenticMaxSteps > 0 ? agenticMaxSteps : undefined'),
 		'source omits maxSteps when it has no valid budget rather than capping at the library default'
 	);
 	assert(
 		src.includes('patchAgenticHistorySection') && src.includes('data-agentic="history-block"'),
 		'source refreshes checkpoints into a stable history block instead of re-rendering the panel'
 	);
 	assert(
 		src.includes("host.appendChild(buildAgenticMessageEl") && src.includes('host.removeChild(host.lastChild)'),
 		'source grows/shrinks only the persistent messages host child list (no pane re-creation)'
 	);
	assert(
 		src.includes("const wrap = doc.createElement('div');") && src.includes('replaceChild(wrap, placeholder)'),
 		'source materializes the messages host in place when the chat starts empty (no pane re-render)'
 	);
 	{
 		const start = src.indexOf('function refreshAgenticHistory');
 		const histFn = src.slice(start, start + 1200);
 		assert(!histFn.includes('renderPanel'), 'refreshAgenticHistory never re-renders the whole panel (would jump)');
 		assert(histFn.includes('patchAgenticHistorySection'), 'refreshAgenticHistory patches only the history block');
 	}
 }

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
process.exit(failed > 0 ? 1 : 0);
