/**
 * @typedef {Object} VeskPlugin
 * @property {string} name - Unique plugin name
 * @property {Object<string, Function|*>} [provides] - Services this plugin exposes to middleware ctx (key = ctx property name, value = factory or value)
 * @property {(ctx: Object) => Promise<void>|void} [onRequest] - Called per-request with the middleware ctx, before user middleware
 * @property {(content: string, filePath: string) => Promise<string|null>|string|null} [onCSS]
 * @property {(filePath: string) => Promise<{handled: boolean}>|{handled: boolean}} [onFileWatch]
 * @property {(code: string, filePath: string) => Promise<string|null>|string|null} [onTransformJS]
 * @property {() => Promise<void>|void} [onBuildStart]
 * @property {() => Promise<void>|void} [onBuildEnd]
 */

/**
 * @typedef {Object} VeskCors
 * @property {string|string[]} origin - Allowed origins (required to enable CORS)
 * @property {string} [methods] - Allowed methods (default: 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
 * @property {string} [headers] - Allowed headers (default: 'Content-Type,Authorization,X-CSRF-Token')
 * @property {boolean} [credentials] - Allow credentials (default: true)
 * @property {number} [maxAge] - Preflight cache seconds (default: 86400)
 */
import { VeskError } from './errors.js';

/**
 * @typedef {Object} VeskRateLimit
 * @property {number} [windowMs] - Time window in milliseconds (default: 60000)
 * @property {number} [max] - Max requests per window (default: 100)
 */

/**
 * @typedef {'strict'|'default'|'minimal'|'off'} VeskSecurityPreset
 */

/**
 * @typedef {Object} VeskSecurity
 * @property {string} [xFrameOptions] - X-Frame-Options header value (default: 'DENY')
 * @property {string|boolean} [hsts] - Strict-Transport-Security value or false to disable (default: 'max-age=31536000; includeSubDomains')
 * @property {string} [referrerPolicy] - Referrer-Policy (default: 'strict-origin-when-cross-origin')
 * @property {boolean|string} [contentSecurityPolicy] - CSP header value, or false to disable (default: restrictive policy)
 * @property {boolean} [autoEscape] - Auto-escape all template expressions (default: true)
 * @property {boolean} [csrf] - Enable CSRF protection for forms and API routes (default: true)
 * @property {VeskCors} [cors] - CORS configuration (unset = CORS disabled)
 * @property {boolean|string} [trustProxy] - Trust X-Forwarded-* headers (true or specific proxy IP). Default: false
 * @property {VeskRateLimit} [rateLimit] - Rate limiting config (unset = no rate limit)
 * @property {boolean} [redactLogs] - Auto-redact secrets from console output (default: true)
 */

/**
 * @typedef {Object} VeskConfig
 * @property {string} [appDir]
 * @property {string} [outDir]
 * @property {string} [publicDir]
 * @property {{ getStaticPaths?: () => Promise<{ paths: Array<{ params: object }> }> }} [ssg]
 * @property {VeskPlugin[]} [plugins]
 * @property {VeskSecurity|VeskSecurityPreset|false|((preset: typeof preset) => VeskSecurity)} [security] - Security configuration
 */

const SECURITY_PRESETS = {
	strict: {
		autoEscape: true,
		csrf: true,
		xFrameOptions: 'DENY',
		hsts: 'max-age=31536000; includeSubDomains',
		referrerPolicy: 'strict-origin-when-cross-origin',
		contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
		redactLogs: true,
	},
	minimal: {
		autoEscape: true,
		csrf: false,
		xFrameOptions: 'SAMEORIGIN',
		hsts: false,
		referrerPolicy: false,
		contentSecurityPolicy: false,
		redactLogs: false,
	},
};

SECURITY_PRESETS.default = { ...SECURITY_PRESETS.strict };

/**
 * Return a preset security configuration for a given environment.
 * @param {'production'|'development'|string} name - Preset name
 * @param {VeskSecurity} [overrides] - Overrides merged on top of the preset
 * @returns {VeskSecurity}
 */
export function preset(name, overrides = {}) {
	const presets = {
		production: { ...SECURITY_PRESETS.strict },
		development: {
			...SECURITY_PRESETS.strict,
			contentSecurityPolicy: false,
		},
	};
	if (!presets[name]) {
		throw VeskError.configError(`Unknown security preset: "${name}".`, Object.keys(presets));
	}
	return { ...presets[name], ...overrides };
}

/**
 * Define a Vesk plugin with type-safe provides.
 * @param {VeskPlugin} plugin
 * @returns {VeskPlugin}
 */
export function definePlugin(plugin) {
	if (!plugin || typeof plugin !== 'object') {
		throw new Error('[vesk] definePlugin() requires a plugin object.');
	}
	if (typeof plugin.name !== 'string' || !plugin.name) {
		throw new Error('[vesk] definePlugin() requires a `name` property.');
	}
	return plugin;
}

export function defineConfig(config) {
	// Resolve security shorthand
	if (config.security === false || config.security === 'off') {
		config.security = {};
	} else if (typeof config.security === 'string') {
		const p = SECURITY_PRESETS[config.security];
		if (!p) throw VeskError.configError(`Unknown security preset string: "${config.security}".`, Object.keys(SECURITY_PRESETS));
		config.security = { ...p };
	} else if (typeof config.security === 'function') {
		config.security = config.security(preset);
	}

	// Apply security defaults
	if (!config.security) config.security = {};
	if (config.security.autoEscape !== false) config.security.autoEscape = true;
	if (config.security.csrf !== false) config.security.csrf = true;
	if (config.security.xFrameOptions === undefined) config.security.xFrameOptions = 'DENY';
	if (config.security.contentSecurityPolicy === undefined) config.security.contentSecurityPolicy =
		"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
	if (config.security.redactLogs !== false) config.security.redactLogs = true;
	return config;
}

export function validateConfig(config) {
	if (!config.plugins) return config;
	if (!Array.isArray(config.plugins)) {
		throw new Error('[vesk] config.plugins must be an array.');
	}
	for (const plugin of config.plugins) {
		if (!plugin || typeof plugin !== 'object') {
			throw new Error('[vesk] Each plugin must be an object returned by a plugin factory (e.g. tailwindcss()).');
		}
		if (typeof plugin.name !== 'string' || !plugin.name) {
			throw new Error(
				'[vesk] A plugin is missing a `name` property. Use a Vesk-native ' +
				'plugin factory (e.g. tailwindcss({...}) from @vesk/plugin-tailwind) ' +
				'that returns a plugin object with the correct shape.'
			);
		}
		const hasKnownHook =
			typeof plugin.onCSS === 'function' ||
			typeof plugin.onFileWatch === 'function' ||
			typeof plugin.onTransformJS === 'function' ||
			typeof plugin.onBuildStart === 'function' ||
			typeof plugin.onBuildEnd === 'function' ||
			typeof plugin.onRequest === 'function' ||
			(plugin.provides && typeof plugin.provides === 'object' && Object.keys(plugin.provides).length > 0);
		if (!hasKnownHook) {
			throw new Error(
				`[vesk] Plugin "${plugin.name}" implements none of the recognized ` +
				'hooks (onCSS, onFileWatch, onTransformJS, onBuildStart, onBuildEnd, onRequest) ' +
				'or provides — it will never be called. Check the plugin package version, or see ' +
				'/docu/cli/plugin-api.md for the current hook contract.'
			);
		}
	}
	return config;
}
