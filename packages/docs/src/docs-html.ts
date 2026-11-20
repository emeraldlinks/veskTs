import type { VeskDocsAuthConfig, VeskDocsSecuritySchemeConfig } from '@vesk/types';
import type { ProjectIntelligence } from '@vesk/docs/src/ir';
import { resolveDocsSessionAuth } from '@vesk/docs/src/auth-session';
import { generateOpenApi } from '@vesk/docs/src/openapi';

export interface DocsHtmlOptions {
  title?: string;
  docsPath: string;
  openApiJsonPath: string | null;
  openApiYamlPath: string | null;
  playground?: boolean;
  swaggerAssetsPath?: string;
  securitySchemes?: Record<string, VeskDocsSecuritySchemeConfig>;
  security?: Array<Record<string, string[]>>;
  auth?: VeskDocsAuthConfig;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function assetUrl(base: string, file: string): string {
  return `${base.replace(/\/+$/, '')}/${file}`;
}

export function generateDocsHtml(intelligence: ProjectIntelligence, options: DocsHtmlOptions): string {
  const title = options.title ?? 'Vesk API';
  const spec = generateOpenApi(intelligence, {
    title,
    version: '1.0.0',
    securitySchemes: options.securitySchemes,
    security: options.security,
    auth: options.auth,
  });
  const assetBase = options.swaggerAssetsPath ?? `${options.docsPath.replace(/\/+$/, '')}/swagger-ui`;
  const credentials = options.auth?.credentials ?? 'same-origin';
  const persistAuthorization = options.auth?.persistAuthorization !== false;
  const session = resolveDocsSessionAuth(options.auth);
  const config = {
    docsPath: options.docsPath,
    openApiJsonPath: options.openApiJsonPath,
    openApiYamlPath: options.openApiYamlPath,
    playground: options.playground !== false,
    auth: { credentials, persistAuthorization, ...(session ? { session } : {}) },
  };
  const source = options.openApiJsonPath
    ? `url: ${safeJson(options.openApiJsonPath)}`
    : 'spec: window.__VESK_SPEC__';
  const sessionRuntime = session
    ? `var veskSessionAuth = ${safeJson(session)};
var veskSessionToken = '';
function veskReadCookie(name) {
  var parts = document.cookie ? document.cookie.split(';') : [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var equals = part.indexOf('=');
    if (equals < 0) continue;
    if (part.slice(0, equals).trim() === name) return decodeURIComponent(part.slice(equals + 1).trim());
  }
  return '';
}
function veskReadSessionToken() {
  if (!veskSessionAuth) return '';
  if (veskSessionAuth.source === 'cookie') return veskReadCookie(veskSessionAuth.key);
  try {
    var store = veskSessionAuth.source === 'localStorage' ? window.localStorage : window.sessionStorage;
    return store.getItem(veskSessionAuth.key) || '';
  } catch (error) {
    return '';
  }
}
function veskHasHeader(request, name) {
  var target = name.toLowerCase();
  var headers = request.headers || {};
  for (var key of Object.keys(headers)) if (key.toLowerCase() === target) return true;
  return false;
}
function veskApplySessionAuthorization() {
  if (!window.ui || !veskSessionAuth || !veskSessionToken) return;
  if (typeof window.ui.preauthorizeApiKey !== 'function') return;
  window.ui.preauthorizeApiKey(${safeJson(session.scheme)}, veskSessionToken);
}
`
    : '';
  const sessionInterceptor = session
    ? `      veskSessionToken = veskReadSessionToken();
      if (veskSessionToken && veskSessionAuth.header && !veskHasHeader(request, veskSessionAuth.header)) {
        request.headers[veskSessionAuth.header] = veskSessionAuth.prefix + veskSessionToken;
      }
`
    : '';
  const sessionBootstrap = session ? '    veskApplySessionAuthorization();\n' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(assetUrl(assetBase, 'swagger-ui.css'))}">
<style>html,body{margin:0;background:#fff}.swagger-ui .topbar{background-color:#1b2436}.swagger-ui .info .title small{color:#3f5b86}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="${escapeHtml(assetUrl(assetBase, 'swagger-ui-bundle.js'))}"></script>
<script src="${escapeHtml(assetUrl(assetBase, 'swagger-ui-standalone-preset.js'))}"></script>
<script>
${sessionRuntime}window.__VESK_DOCS__=${safeJson({ spec, config })};
window.__VESK_SPEC__=${safeJson(spec)};
window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({
    ${source},
    dom_id: '#swagger-ui',
    deepLinking: true,
    filter: true,
    displayRequestDuration: true,
    requestInterceptor: function (request) {
      request.credentials = ${safeJson(credentials)};
      request.headers = request.headers || {};
${sessionInterceptor}      return request;
    },
    persistAuthorization: ${persistAuthorization ? 'true' : 'false'},
    tryItOutEnabled: ${config.playground ? 'true' : 'false'},
    validatorUrl: null,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    layout: 'StandaloneLayout'
  });
${sessionBootstrap}});
</script>
</body>
</html>
`;
}
