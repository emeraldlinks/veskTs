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
 * @typedef {Object} VeskConfig
 * @property {string} [appDir]
 * @property {string} [outDir]
 * @property {string} [publicDir]
 * @property {{ getStaticPaths?: () => Promise<{ paths: Array<{ params: object }> }> }} [ssg]
 * @property {VeskPlugin[]} [plugins]
 */

export function defineConfig(config) {
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
