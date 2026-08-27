import type { VeskConfig, VeskPlugin, VeskSecurity, VeskSecurityPreset, MdConfig } from '@vesk/compiler/src/types';
import { VeskError } from '@vesk/compiler/src/errors';

/** Tags allowed by default when md.html = 'allowlist' and no allowTags given. */
export const MD_DEFAULT_ALLOW_TAGS = [
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'i', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
];

const MD_HTML_MODES = ['escape', 'allow', 'allowlist'];

function normalizeMdConfig(md: MdConfig | undefined): MdConfig | undefined {
  if (!md || typeof md !== 'object') return md;
  if (md.html !== undefined && !MD_HTML_MODES.includes(md.html)) {
    throw VeskError.configError(
      `Unknown md.html mode: "${md.html}".`,
      MD_HTML_MODES,
    );
  }
  const out: MdConfig = { ...md };
  if (out.allowTags) {
    if (!Array.isArray(out.allowTags)) {
      throw VeskError.configError('md.allowTags must be an array of tag names.', []);
    }
    out.allowTags = out.allowTags.map((t: string) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean);
  }
  return out;
}

const SECURITY_PRESETS: Record<string, VeskSecurity> = {
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

SECURITY_PRESETS['default'] = { ...SECURITY_PRESETS['strict'] };

export function preset(name: string, overrides: VeskSecurity = {}): VeskSecurity {
  const presets: Record<string, VeskSecurity> = {
    production: { ...SECURITY_PRESETS['strict'] },
    development: {
      ...SECURITY_PRESETS['strict'],
      contentSecurityPolicy: false,
    },
  };
  if (!presets[name]) {
    throw VeskError.configError(`Unknown security preset: "${name}".`, Object.keys(presets));
  }
  return { ...presets[name], ...overrides };
}

export function definePlugin<P extends VeskPlugin>(plugin: P): P {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('[vesk] definePlugin() requires a plugin object.');
  }
  if (typeof (plugin as Record<string, unknown>).name !== 'string' || !(plugin as Record<string, unknown>).name) {
    throw new Error('[vesk] definePlugin() requires a `name` property.');
  }
  return plugin;
}

export function defineConfig(config: VeskConfig): VeskConfig {
  if ((config.security as VeskSecurityPreset | false | undefined) === false || config.security === 'off') {
    config.security = {};
  } else if (typeof config.security === 'string') {
    const p = SECURITY_PRESETS[config.security as string];
    if (!p) throw VeskError.configError(`Unknown security preset string: "${config.security}".`, Object.keys(SECURITY_PRESETS));
    config.security = { ...p };
  } else if (typeof config.security === 'function') {
    config.security = (config.security as (p: typeof preset) => VeskSecurity)(preset);
  }

  if (!config.security) config.security = {};
  const sec = config.security as VeskSecurity;
  if (sec.autoEscape !== false) sec.autoEscape = true;
  if (sec.csrf !== false) sec.csrf = true;
  if (sec.xFrameOptions === undefined) sec.xFrameOptions = 'DENY';
  if (sec.contentSecurityPolicy === undefined) sec.contentSecurityPolicy =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
  if (sec.redactLogs !== false) sec.redactLogs = true;
  if (config.routeDataCache === undefined) config.routeDataCache = 0;
  const md = normalizeMdConfig(config.md);
  if (md !== undefined) config.md = md;
  return config;
}

export function validateConfig(config: VeskConfig): VeskConfig {
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
