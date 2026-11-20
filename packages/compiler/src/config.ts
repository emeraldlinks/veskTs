import type {
  VeskConfig,
  VeskPlugin,
  VeskSecurity,
  VeskSecurityPreset,
  MdConfig,
  VeskDocsConfig,
  VeskDocsSecuritySchemeConfig,
} from '@vesk/compiler/src/types';
import { VeskError } from '@vesk/compiler/src/errors';

/** Tags allowed by default when md.html = 'allowlist' and no allowTags given. */
export const MD_DEFAULT_ALLOW_TAGS = [
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'i', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
];

const MD_HTML_MODES = ['escape', 'allow', 'allowlist'];

function normalizeTag(tag: string): string {
  let out = '';
  const text = String(tag).toLowerCase();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === '-') out += ch;
  }
  return out;
}

function isValidDocsPath(value: string): boolean {
  if (value.length < 2 || value[0] !== '/' || value.endsWith('/')) return false;
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === '?' || ch === '#' || ch === '[' || ch === ']' || ch === '*' || ch === '\\' || ch === ' ' || ch === '\t') return false;
  }
  return true;
}

function validateConfiguredPath(value: string, suffix: string, label: string): void {
  if (!isValidDocsPath(value) || !value.endsWith(suffix)) {
    throw VeskError.configError(`${label} must be an absolute static path ending in ${suffix}.`, [`/openapi${suffix}`]);
  }
}

const DOC_CREDENTIAL_MODES = ['omit', 'same-origin', 'include'];
const DOC_AUTH_SESSION_SOURCES = ['cookie', 'localStorage', 'sessionStorage'];

function validateSecuritySchemes(value: VeskDocsSecuritySchemeConfig[] | Record<string, VeskDocsSecuritySchemeConfig> | undefined): void {
  if (value === undefined) return;
  if (typeof value !== 'object' || Array.isArray(value)) throw VeskError.configError('docs.securitySchemes must be an object.');
  for (const [id, scheme] of Object.entries(value)) {
    if (!id) throw VeskError.configError('docs.securitySchemes contains an empty scheme name.');
    if (!scheme || typeof scheme !== 'object') throw VeskError.configError(`docs.securitySchemes.${id} must be an object.`);
    if (scheme.type === 'apiKey') {
      if (scheme.in !== 'header' && scheme.in !== 'query' && scheme.in !== 'cookie') {
        throw VeskError.configError(`docs.securitySchemes.${id}.in must be "header", "query", or "cookie".`);
      }
      if (typeof scheme.name !== 'string' || !scheme.name) {
        throw VeskError.configError(`docs.securitySchemes.${id}.name must be a non-empty string.`);
      }
    } else if (scheme.type === 'http') {
      if (scheme.scheme !== 'bearer' && scheme.scheme !== 'basic') {
        throw VeskError.configError(`docs.securitySchemes.${id}.scheme must be "bearer" or "basic".`);
      }
    } else {
      throw VeskError.configError(`docs.securitySchemes.${id}.type must be "apiKey" or "http".`);
    }
    if (scheme.description !== undefined && typeof scheme.description !== 'string') {
      throw VeskError.configError(`docs.securitySchemes.${id}.description must be a string.`);
    }
    if (scheme.type === 'http' && scheme.bearerFormat !== undefined && typeof scheme.bearerFormat !== 'string') {
      throw VeskError.configError(`docs.securitySchemes.${id}.bearerFormat must be a string.`);
    }
  }
}

function validateSecurityRequirements(value: Array<Record<string, string[]>> | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw VeskError.configError('docs.security must be an array.');
  for (const requirement of value) {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw VeskError.configError('docs.security entries must be objects.');
    }
    for (const [scheme, scopes] of Object.entries(requirement)) {
      if (!scheme) throw VeskError.configError('docs.security contains an empty scheme name.');
      if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
        throw VeskError.configError(`docs.security.${scheme} must be an array of scope strings.`);
      }
    }
  }
}

function validateDocsAuth(value: VeskDocsConfig['auth']): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw VeskError.configError('docs.auth must be an object.');
  if (value.credentials !== undefined && !DOC_CREDENTIAL_MODES.includes(value.credentials)) {
    throw VeskError.configError('docs.auth.credentials must be "omit", "same-origin", or "include".');
  }
  if (value.persistAuthorization !== undefined && typeof value.persistAuthorization !== 'boolean') {
    throw VeskError.configError('docs.auth.persistAuthorization must be a boolean.');
  }
  if (value.defaultScheme !== undefined && (typeof value.defaultScheme !== 'string' || !value.defaultScheme)) {
    throw VeskError.configError('docs.auth.defaultScheme must be a non-empty string.');
  }
  if (value.loginPath !== undefined && (typeof value.loginPath !== 'string' || !value.loginPath.startsWith('/'))) {
    throw VeskError.configError('docs.auth.loginPath must be an absolute path.');
  }
  const session = value.session;
  if (session !== undefined) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      throw VeskError.configError('docs.auth.session must be an object.');
    }
    if (!DOC_AUTH_SESSION_SOURCES.includes(session.source)) {
      throw VeskError.configError('docs.auth.session.source must be "cookie", "localStorage", or "sessionStorage".');
    }
    if (typeof session.key !== 'string' || !session.key) {
      throw VeskError.configError('docs.auth.session.key must be a non-empty string.');
    }
    for (const field of ['scheme', 'header'] as const) {
      const fieldValue = session[field];
      if (fieldValue !== undefined && (typeof fieldValue !== 'string' || !fieldValue)) {
        throw VeskError.configError(`docs.auth.session.${field} must be a non-empty string.`);
      }
    }
    if (session.prefix !== undefined && typeof session.prefix !== 'string') {
      throw VeskError.configError('docs.auth.session.prefix must be a string.');
    }
  }
}

function validateDocsConfig(docs: false | VeskDocsConfig | undefined): void {
  if (docs === undefined || docs === false) return;
  if (typeof docs !== 'object') throw VeskError.configError('docs must be false or an object.', ['docs: false', 'docs: { path: "/docs" }']);
  const booleans: Array<keyof VeskDocsConfig> = ['enabled', 'dev', 'prod', 'playground'];
  for (const key of booleans) {
    const value = docs[key];
    if (value !== undefined && typeof value !== 'boolean') {
      throw VeskError.configError(`docs.${key} must be a boolean.`);
    }
  }
  if (docs.path !== undefined) {
    if (typeof docs.path !== 'string' || !isValidDocsPath(docs.path)) {
      throw VeskError.configError('docs.path must be an absolute static path such as "/docs".', ['/docs']);
    }
  }
  if (docs.openapi !== undefined && docs.openapi !== false) {
    if (typeof docs.openapi !== 'object') throw VeskError.configError('docs.openapi must be false or an object.');
    if (docs.openapi.jsonPath !== undefined) validateConfiguredPath(docs.openapi.jsonPath, '.json', 'docs.openapi.jsonPath');
    if (docs.openapi.yamlPath !== undefined) validateConfiguredPath(docs.openapi.yamlPath, '.yaml', 'docs.openapi.yamlPath');
  }
  validateSecuritySchemes(docs.securitySchemes);
  validateSecurityRequirements(docs.security);
  validateDocsAuth(docs.auth);
}

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
    out.allowTags = out.allowTags.map((t: string) => normalizeTag(t)).filter(Boolean);
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
    // `strict` is the real name of the production preset; both resolve to it.
    strict: { ...SECURITY_PRESETS['strict'] },
    development: {
      ...SECURITY_PRESETS['strict'],
      contentSecurityPolicy: false,
    },
    // autoEscape only, SAMEORIGIN framing, no CSRF/HSTS/CSP.
    minimal: { ...SECURITY_PRESETS['minimal'] },
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
  // `security: false` (or 'off') is an explicit opt-out: no CSRF, no CSP, no
  // HSTS, no framing policy, no log redaction. It used to be rewritten to `{}`
  // and then re-filled with the strict defaults below, so a project that asked
  // for no security silently got all of it. `autoEscape` stays on — escaping
  // untrusted text is not an optional header, so 'off' means "no ambient
  // protections", not "render unescaped HTML".
  if ((config.security as VeskSecurityPreset | false | undefined) === false || config.security === 'off') {
    config.security = { autoEscape: true } as VeskSecurity;
    if (config.routeDataCache === undefined) config.routeDataCache = 0;
    const mdOff = normalizeMdConfig(config.md);
    if (mdOff !== undefined) config.md = mdOff;
    return config;
  }
  if (typeof config.security === 'string') {
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
  if (config.intelligence !== undefined) {
    const intelligence = config.intelligence;
    if (typeof intelligence !== 'object') throw VeskError.configError('intelligence must be an object.');
    if (intelligence.enabled !== undefined && typeof intelligence.enabled !== 'boolean') {
      throw VeskError.configError('intelligence.enabled must be a boolean.');
    }
    if (intelligence.cacheDir !== undefined && typeof intelligence.cacheDir !== 'string') {
      throw VeskError.configError('intelligence.cacheDir must be a string.');
    }
    if (intelligence.exclude !== undefined) {
      if (!Array.isArray(intelligence.exclude) || intelligence.exclude.some((entry) => typeof entry !== 'string')) {
        throw VeskError.configError('intelligence.exclude must be an array of strings.');
      }
    }
  }
  validateDocsConfig(config.docs);
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
      typeof plugin.onStart === 'function' ||
      typeof plugin.onStop === 'function' ||
      typeof plugin.onHead === 'function' ||
      typeof plugin.onHtml === 'function' ||
      (plugin.provides && typeof plugin.provides === 'object' && Object.keys(plugin.provides).length > 0);
    if (!hasKnownHook) {
      throw new Error(
        `[vesk] Plugin "${plugin.name}" implements none of the recognized ` +
        'hooks (onCSS, onFileWatch, onTransformJS, onBuildStart, onBuildEnd, onRequest, onStart, onStop, onHead, onHtml) ' +
        'or provides — it will never be called. Check the plugin package version, or see ' +
        '/docu/cli/plugin-api.md for the current hook contract.'
      );
    }
  }
  return config;
}
