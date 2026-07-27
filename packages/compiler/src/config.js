/**
 * @typedef {Object} VeskPlugin
 * @property {string} name - Unique plugin name
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

/**
 * @typedef {Object} VeskSecurity
 * @property {string} [xFrameOptions] - X-Frame-Options header value (default: 'DENY')
 * @property {string|boolean} [hsts] - Strict-Transport-Security value or false to disable (default: 'max-age=31536000; includeSubDomains')
 * @property {string} [referrerPolicy] - Referrer-Policy (default: 'strict-origin-when-cross-origin')
 * @property {boolean} [autoEscape] - Auto-escape all template expressions (default: true)
 * @property {boolean} [csrf] - Enable CSRF protection for forms and API routes (default: true)
 * @property {VeskCors} [cors] - CORS configuration (unset = CORS disabled)
 */

/**
 * @typedef {Object} VeskConfig
 * @property {string} [appDir]
 * @property {string} [outDir]
 * @property {string} [publicDir]
 * @property {{ getStaticPaths?: () => Promise<{ paths: Array<{ params: object }> }> }} [ssg]
 * @property {VeskPlugin[]} [plugins]
 * @property {VeskSecurity} [security] - Security configuration
 */

export function defineConfig(config) {
	// Apply security defaults
	if (!config.security) config.security = {};
	if (config.security.autoEscape !== false) config.security.autoEscape = true;
	if (config.security.csrf !== false) config.security.csrf = true;
	if (config.security.xFrameOptions === undefined) config.security.xFrameOptions = 'DENY';
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
			typeof plugin.onBuildEnd === 'function';
		if (!hasKnownHook) {
			throw new Error(
				`[vesk] Plugin "${plugin.name}" implements none of the recognized ` +
				'hooks (onCSS, onFileWatch, onTransformJS, onBuildStart, onBuildEnd) ' +
				'— it will never be called. Check the plugin package version, or see ' +
				'/docu/cli/plugin-api.md for the current hook contract.'
			);
		}
	}
	return config;
}
