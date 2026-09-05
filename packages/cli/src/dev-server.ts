import { readFileSync, watch, statSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { stripCodeTypes } from '@vesk/compiler/src/strip-ts';
import { renderPage, renderFullPage, renderPageStream, buildDataScripts, securityHeaders, corsHeaders, corsPreflight, createRateLimiter, applyTrustProxy, prettifyHtml, resolveComponentName, getClientProtocol, randomToken, DEFAULT_MAX_BODY_BYTES } from '@vesk/compiler/src/server-codegen';
import { withSsrStore, ssrSink } from '@vesk/compiler/src/ssr-store';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { scanRoutes, matchUrl, collectSources } from '@vesk/compiler/src/router';
import { scanApiRoutes, matchApiUrl, buildWebRequest, executeApiRoute } from '@vesk/compiler/src/api-routes';
import { collectMiddlewareChain, executeMiddlewareChain } from '@vesk/compiler/src/middleware';
import { generateClientBundle, buildTreeShakenRuntime, runtimeExportNames, buildHmrEvalSnippet } from '@vesk/adapter/src/client-bundle';
import { resolveWithin, isAllowedWsUpgrade, installMdReadHook } from '@vesk/adapter/src/paths';
import { createDevApiRouter } from '@vesk/adapter/src/dev-api';
import type { DevPanelResponse, DiagnosticFinding } from '@vesk/adapter/src/dev-api';
import type { DevHmrState } from '@vesk/adapter/src/dev-server';
import { produceDiagnostics } from './dev-diagnostics';
// @vesk/agentic — optional AI plugin; gated by active state if installed
import { createAgentRouter } from '@vesk/agentic/src/dev-api';
import { CheckpointManager } from '@vesk/agentic/src/checkpoints';
import { AgentCapabilityTable } from '@vesk/agentic/src/permissions';
import { openAiProvider } from '@vesk/agentic/src/providers/openai';
import { anthropicProvider } from '@vesk/agentic/src/providers/anthropic';
import { Agent } from '@vesk/agentic/src/loop';
import { getApiKey, loadAgenticConfig, SUPPORTED_PROVIDERS } from '@vesk/agentic/src/config';
import { createVeskTools } from '@vesk/agentic/src/tools/vesk';
import { createWebTools } from '@vesk/agentic/src/tools/web';
import { createBrowserTools } from '@vesk/agentic/src/tools/browser';
import type { ChunkEntry, ClientBundleCache } from '@vesk/adapter/src/types';
import type { RouteNode, VeskPlugin } from '@vesk/compiler/src/types';
import { getPluginRecords, filterActivePlugins } from '@vesk/adapter/src/plugins';
import { ensurePackagesBuilt } from './build-packages';
import { handleActionRequest } from './action-handler';

// Shared @vesk/agentic checkpoint manager — module singleton so history persists across requests
const agenticCheckpointManager = new CheckpointManager();

function resolveRuntimeDir(projectDir: string): string | null {
  const candidates = [
    // installed app layout
    resolve(projectDir, 'node_modules', '@vesk', 'runtime'),
    // monorepo checkout (tests/probes run from the repo root)
    resolve(import.meta.dirname ?? '.', '..', '..', 'runtime', 'dist'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'ripple-runtime.js'))) return dir;
    const distDir = join(dir, 'dist');
    if (existsSync(join(distDir, 'ripple-runtime.js'))) return distDir;
  }
  return null;
}

const LOG = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  dim: '\x1b[2m',
  method(m: string) {
    const colors: Record<string, string> = { GET: '\x1b[32m', POST: '\x1b[34m', PUT: '\x1b[33m', PATCH: '\x1b[33m', DELETE: '\x1b[31m', HEAD: '\x1b[90m', OPTIONS: '\x1b[36m' };
    return (colors[m] || '\x1b[37m') + m + '\x1b[0m';
  },
  status(s: number) {
    if (s < 300) return '\x1b[32m' + s + '\x1b[0m';
    if (s < 400) return '\x1b[36m' + s + '\x1b[0m';
    if (s < 500) return '\x1b[33m' + s + '\x1b[0m';
    return '\x1b[31m' + s + '\x1b[0m';
  },
  info(...args: unknown[]) { console.log('\x1b[2mvesk:\x1b[0m', ...args); },
  ok(...args: unknown[]) { console.log('\x1b[32mvesk:\x1b[0m', ...args); },
  warn(...args: unknown[]) { console.log('\x1b[33mvesk:\x1b[0m', ...args); },
  err(...args: unknown[]) { console.log('\x1b[31mvesk:\x1b[0m', ...args); },
  request(method: string, pathname: string, status: number, ms?: number) {
    const m = LOG.method(method);
    const s = LOG.status(status);
    const t = ms !== undefined ? ` \x1b[2m${ms}ms\x1b[0m` : '';
    console.log(`  ${m} ${pathname} ${s}${t}`);
  },
};

/**
 * Dev script pair injected before `</body>` in every served dev page shape
 * (layout, minimal, not-found, error). Parts are exact and order-sensitive:
 * the client bundle mounts/runs before the HMR client attaches listeners.
 */
export const DEV_SCRIPTS =
  '\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>';

/** Inject the dev script pair at the first `</body>`. No-op when absent. */
export function injectDevScripts(html: string): string {
  if (!html.includes('</body>')) return html;
  return html.replace('</body>', DEV_SCRIPTS + '\n</body>');
}

/**
 * DevTools panel HTTP handler — delegates every `/__vesk/*` request to the
 * shared adapter `createDevApiRouter` and writes the resulting response.
 * Pure-ish (no socket/listener): callers pass a URL + body reader.
 */
export async function routeDevPanel(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: {
    projectDir: string;
    veskDir: string;
    appDir?: string;
    configNames: () => string[];
    getHmrState: () => Record<string, unknown>;
    maxBodyBytes?: number;
    rebuild?: () => Promise<{ ok: boolean; error?: string; ms?: number }>;
    getDiagnostics?: () => { severity: 'error' | 'warning' | 'info'; code: string; message: string }[];
  },
): Promise<void> {
  if (!url.pathname.startsWith('/__vesk/')) return;

  const chunks: Buffer[] = [];
  let total = 0;
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  for await (const chunk of req) {
    total += (chunk as Buffer).byteLength;
    if (total > maxBodyBytes) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Request body exceeds limit (${maxBodyBytes} bytes)` }));
      return;
    }
    chunks.push(chunk as Buffer);
  }
  let body: unknown;
  if (chunks.length > 0) {
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { body = undefined; }
  }

  const veskDir = deps.veskDir;
  const appDir = deps.appDir || resolve(deps.projectDir, 'app');
  const configPluginNames = deps.configNames();
  // ── @vesk/agentic — chain createAgentRouter BEFORE createDevApiRouter ─────
  // Uses CheckpointManager + AgentCapabilityTable + Provider via
  // openAiProvider/anthropicProvider; API keys per-provider from .env.local
  // VK_{PROVIDER}_KEY.
  // Gate: expose /__vesk/agent/* when @vesk/agentic is installed+active OR any
  // provider key (VK_*_KEY) is configured in .env.local.
  try {
    const records = getPluginRecords(appDir, veskDir, configPluginNames);
    const rec = records.find((r) => r.name === '@vesk/agentic' || r.package === '@vesk/agentic');
    const hasProviderKey = SUPPORTED_PROVIDERS.some((p) => !!getApiKey(deps.projectDir, p));
    // Gate: plugin active OR any provider key present
    const isAgenticActive = (!!rec && rec.active) || hasProviderKey;
    if (isAgenticActive) {
      const getPermissions = (): AgentCapabilityTable => {
        const rawMode = (process.env.VESK_AGENTIC_MODE as string) || 'explore';
        const valid = ['explore', 'debug', 'agent'];
        const mode = (valid.includes(rawMode) ? rawMode : 'explore') as 'explore' | 'debug' | 'agent';
        return new AgentCapabilityTable(mode);
      };
      const runAgent = async (prompt: string, mode: string, providerConfig: unknown): Promise<import('@vesk/agentic/src/loop').AgentResult> => {
        const { provider, providerName } = await buildAgenticProvider(deps.projectDir, (providerConfig ?? {}) as Record<string, unknown>);
        const veskTools = createVeskTools({ projectDir: deps.projectDir, appDir, veskDir });
        const webTools = createWebTools();
        const browserTools = createBrowserTools();
        const allTools = [...veskTools, ...webTools, ...browserTools];
        // Filter by permissions table for the requested mode (server-enforced)
        const modeTable = new (await import('@vesk/agentic/src/permissions')).AgentCapabilityTable(providerName === 'opencode' || providerName === 'opencode-go' ? 'agent' : (mode as 'explore' | 'debug' | 'agent') || 'explore');
        const filtered = allTools.filter(t => {
          // web and browser are read-only, allow for explore+
          if (t.name.startsWith('web.') || t.name.startsWith('browser.')) return modeTable.allows('readFiles');
          return true;
        });
        const budget = resolveAgenticStepBudget(deps.projectDir, (providerConfig ?? {}) as Record<string, unknown>);
        const agent = new Agent({ provider, tools: filtered, maxSteps: budget.maxSteps, autoExtend: budget.autoExtend, hardMaxSteps: budget.hardMaxSteps });
        return agent.run(prompt);
      };
      const runAgentStream = async function* (prompt: string, mode: string, providerConfig: unknown): AsyncGenerator<import('@vesk/agentic/src/loop').AgentStreamEvent> {
        const { provider, providerName } = await buildAgenticProvider(deps.projectDir, (providerConfig ?? {}) as Record<string, unknown>);
        const veskTools = createVeskTools({ projectDir: deps.projectDir, appDir, veskDir });
        const webTools = createWebTools();
        const browserTools = createBrowserTools();
        const allTools = [...veskTools, ...webTools, ...browserTools];
        const modeTable = new (await import('@vesk/agentic/src/permissions')).AgentCapabilityTable(providerName === 'opencode' || providerName === 'opencode-go' ? 'agent' : (mode as 'explore' | 'debug' | 'agent') || 'explore');
        const filtered = allTools.filter(t => {
          if (t.name.startsWith('web.') || t.name.startsWith('browser.')) return modeTable.allows('readFiles');
          return true;
        });
        const budget = resolveAgenticStepBudget(deps.projectDir, (providerConfig ?? {}) as Record<string, unknown>);
        const agent = new Agent({ provider, tools: filtered, maxSteps: budget.maxSteps, autoExtend: budget.autoExtend, hardMaxSteps: budget.hardMaxSteps });
        yield* agent.runStream(prompt);
      };
      const agentRouter = createAgentRouter({
        projectDir: deps.projectDir,
        appDir,
        veskDir,
        getPermissions: getPermissions as unknown as () => import('@vesk/agentic/src/permissions').AgentCapabilityTable,
        runAgent: runAgent as unknown as (prompt: string, mode: import('@vesk/agentic/src/permissions').AgentMode, providerConfig?: unknown) => Promise<import('@vesk/agentic/src/loop').AgentResult>,
        runAgentStream: runAgentStream as unknown as (prompt: string, mode: import('@vesk/agentic/src/permissions').AgentMode, providerConfig?: unknown) => AsyncIterable<import('@vesk/agentic/src/loop').AgentStreamEvent>,
        listCheckpoints: () => agenticCheckpointManager.listNewestFirst(),
        rollback: (id: string) => agenticCheckpointManager.get(id) ?? null,
        createCheckpoint: (...args: unknown[]) => {
          const first = args[0] as Record<string, unknown> | string | undefined;
          if (first && typeof first === 'object' && ('label' in first || 'message' in first)) {
            return agenticCheckpointManager.create(first as unknown as import('@vesk/agentic/src/checkpoints').CreateCheckpointOptions);
          }
          const msg = typeof first === 'string' ? first : 'checkpoint';
          return agenticCheckpointManager.create({ label: msg, message: msg });
        },
      });
      const agentRes = await agentRouter.route(req.method || 'GET', url.pathname, body, url.search);
      if (agentRes) {
        writeDevPanelResponse(res, agentRes);
        return;
      }
    }
  } catch {
    // agentic wiring is best-effort; fall through to core dev API
  }
  const router = createDevApiRouter({
    appDir,
    veskDir,
    configPluginNames,
    projectDir: deps.projectDir,
    getHmrState: deps.getHmrState as unknown as () => DevHmrState,
    rebuild: deps.rebuild,
    getDiagnostics: deps.getDiagnostics,
  });

  const response = await router.route(req.method || 'GET', url.pathname, body, url.search);
  if (!response) return;
  writeDevPanelResponse(res, response);
}

async function readBodyJson(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).byteLength;
    if (total > maxBodyBytes) throw new DevBodyTooLargeError(`body exceeds ${maxBodyBytes} bytes`);
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { return undefined; }
}

class DevBodyTooLargeError extends Error {}

function defaultAgenticModel(providerName: string): string {
  return providerName === 'anthropic' ? 'claude-sonnet-4-6'
    : providerName === 'google' ? 'gemini-2.0-flash'
    : providerName === 'ollama' ? 'llama3.1'
    : providerName === 'opencode' ? 'claude-sonnet-4-6'
    : providerName === 'opencode-go' ? 'opencode-go/kimi-k3'
    : providerName === 'openrouter' ? 'openrouter/auto'
    : 'gpt-4o-mini';
}

/** Build the agentic provider from a request providerConfig (request wins),
    falling back to the project's agentic config file. Shared by run + stream. */
async function buildAgenticProvider(projectDir: string, providerConfig: Record<string, unknown> | null | undefined): Promise<{ provider: import('@vesk/agentic/src/loop').Provider; providerName: string }> {
  const cfg = (providerConfig || {}) as Record<string, unknown>;
  const providerName = String((cfg.provider as string) || loadAgenticConfig(projectDir).provider || 'openai');
  const apiKey = (cfg.apiKey as string) || getApiKey(projectDir, providerName) || '';
  const model = (cfg.model as string) || (loadAgenticConfig(projectDir).model as string) || defaultAgenticModel(providerName);
  const baseUrl = (cfg.baseUrl as string) || (loadAgenticConfig(projectDir).baseUrl as string) || undefined;
  const maxTokens = typeof cfg.maxTokens === 'number' ? (cfg.maxTokens as number) : undefined;
  let provider: import('@vesk/agentic/src/loop').Provider;
  if (providerName === 'anthropic') provider = anthropicProvider({ apiKey, model, baseUrl, maxTokens });
  else if (providerName === 'google') { const { googleProvider } = await import('@vesk/agentic/src/providers/google'); provider = googleProvider({ apiKey, model, baseUrl }); }
  else if (providerName === 'ollama') { const { ollamaProvider } = await import('@vesk/agentic/src/providers/ollama'); provider = ollamaProvider({ model, baseUrl }); }
  else if (providerName === 'opencode') provider = openAiProvider({ apiKey, model, baseUrl: baseUrl || 'https://opencode.ai/zen/v1' });
  else if (providerName === 'opencode-go') provider = openAiProvider({ apiKey, model, baseUrl: baseUrl || 'https://opencode.ai/zen/go/v1' });
  else if (providerName === 'openrouter') provider = openAiProvider({ apiKey, model, baseUrl: baseUrl || 'https://openrouter.ai/api/v1' });
  else if (providerName === 'loopers') provider = openAiProvider({ apiKey, model, baseUrl: baseUrl || 'http://localhost:8080' });
  else provider = openAiProvider({ apiKey, model, baseUrl });
  return { provider, providerName };
}

/** Step budget for an agent run. Request `maxSteps` wins; then the project's
    agentic config; else 25. Auto-extension is on so multi-step tasks aren't cut
    off before the model reaches a final answer, with a 200-step hard ceiling. */
function resolveAgenticStepBudget(projectDir: string, providerConfig: Record<string, unknown> | null | undefined): { maxSteps: number; autoExtend: boolean; hardMaxSteps: number } {
  const cfg = (providerConfig || {}) as Record<string, unknown>;
  const fileCfg = loadAgenticConfig(projectDir);
  const requestVal = typeof cfg.maxSteps === 'number' && Number.isFinite(cfg.maxSteps as number) ? (cfg.maxSteps as number) : NaN;
  const fileVal = typeof fileCfg.maxSteps === 'number' && fileCfg.maxSteps > 0 ? fileCfg.maxSteps : NaN;
  const maxSteps = Number.isFinite(requestVal) ? Math.max(1, Math.floor(requestVal)) : Number.isFinite(fileVal) ? Math.floor(fileVal) : 25;
  return { maxSteps, autoExtend: true, hardMaxSteps: 200 };
}

function writeDevPanelResponse(res: ServerResponse, response: DevPanelResponse): void {
  const headers: Record<string, string | number> = { ...response.headers };
  if (response.stream) {
    // Streaming response (e.g. SSE agent progress): no Content-Length, pipe the
    // already-framed chunks through until the generator finishes.
    res.writeHead(response.status, headers);
    res.flushHeaders?.();
    void (async () => {
      try {
        for await (const chunk of response.stream!) {
          if (!res.writableEnded) res.write(chunk);
        }
      } catch {
        /* stream aborted — nothing to relay */
      } finally {
        if (!res.writableEnded) res.end();
      }
    })();
    return;
  }
  if (response.encoding === 'base64') {
    res.writeHead(response.status, { ...headers, 'Content-Length': Buffer.byteLength(response.body, 'base64') });
    res.end(Buffer.from(response.body, 'base64'));
  } else {
    res.writeHead(response.status, { ...headers, 'Content-Length': Buffer.byteLength(response.body) });
    res.end(response.body);
  }
}

type SsrDataPayload = { props?: Record<string, unknown>; ssrData?: Record<string, unknown> };
const ssrDataStore = new Map<string, SsrDataPayload>();

// HMR settle window: small enough to feel instant, large enough to coalesce
// editor multi-write bursts (write + chmod, atomic-save renames).
const HMR_DEBOUNCE_MS = 12;

function storeDataScript(payload: SsrDataPayload): string | null {
  if (!payload.props && !payload.ssrData) return null;
  if (ssrDataStore.size >= 100) {
    const oldest = ssrDataStore.keys().next().value as string | undefined;
    if (oldest) ssrDataStore.delete(oldest);
  }
  // CSPRNG token — this URL gates access to the page's hydration payload
  const token = randomToken(12);
  ssrDataStore.set(token, payload);
  return '/_vesk/ssr-data.js?t=' + token;
}

function countPages(nodes: RouteNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.page) n++;
    if (node.children.length > 0) n += countPages(node.children);
  }
  return n;
}

function collectRoutePaths(nodes: RouteNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.page && node.fullPath) out.push(node.fullPath);
    if (node.children.length > 0) collectRoutePaths(node.children, out);
  }
  return out;
}

function countFilesNamed(dir: string, name: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) n += countFilesNamed(p, name);
    else if (entry.name === name) n++;
  }
  return n;
}

export async function startDevServer(port: number, projectDir: string, config: Record<string, unknown>, host?: string): Promise<void> {

  const bindHost = host || '127.0.0.1';
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';
  const secCfg = (config.security || {}) as Record<string, unknown>;
  const maxBodyBytes = (typeof secCfg.maxBodyBytes === 'number' ? secCfg.maxBodyBytes : undefined) || DEFAULT_MAX_BODY_BYTES;
  const appDirPath = join(projectDir, 'app');
  const publicDir = join(projectDir, 'public');
  installMdReadHook([publicDir]);

  try {
    ensurePackagesBuilt();
  } catch (e) {
    LOG.warn('package auto-build failed:', (e as Error).message);
  }
  const runtimeDirUnchecked = resolveRuntimeDir(projectDir);
  if (!runtimeDirUnchecked) {
    console.error('vesk dev: @vesk/runtime not found — run "npm install" in the project (or build packages/runtime in the monorepo)');
    process.exit(1);
  }
  const runtimeDir: string = runtimeDirUnchecked;
  const veskStateDir = join(projectDir, '.vesk');
  const configPluginsRaw = (config.plugins || []) as Array<unknown>;
  const configPluginNames = configPluginsRaw
    .map((p) => (typeof p === 'string' ? p : (p as { name?: string } | null)?.name))
    .filter((n): n is string => !!n);
  const rawDevPlugins = (config.plugins || []) as (VeskPlugin & { onBuildStart?: () => Promise<void>; onCSS?: (css: string, path: string) => Promise<string | null> })[];

  function getActiveDevPlugins(): typeof rawDevPlugins {
    try {
      const records = getPluginRecords(appDirPath, veskStateDir, configPluginNames);
      return filterActivePlugins(rawDevPlugins as unknown[], records) as typeof rawDevPlugins;
    } catch {
      return rawDevPlugins;
    }
  }
  function isTailwindActive(): boolean {
    return getActiveDevPlugins().some((p) => String(p.name).toLowerCase().includes('tailwind'));
  }
  function activeCssUrls(): string[] {
    const urls: string[] = [];
    if (isTailwindActive()) urls.push('/_vesk/static/_tailwind.css');
    urls.push('/_vesk/static/global.css');
    return urls;
  }
  function cssLinkTags(): string {
    return activeCssUrls().map((u) => `\t<link rel="stylesheet" href="${u}" />`).join('\n') + '\n';
  }

  let devUserCssContent = '';
  let devTailwindCssContent = '';
  let lastServedCssGlobal = '';
  let lastServedCssTailwind = '';
  const srcDir = join(projectDir, 'src');
  const cssPath = join(srcDir, 'global.css');
  const altCssPath = join(srcDir, 'app.css');
  let rawCss = '';
  if (existsSync(cssPath)) {
    rawCss = readFileSync(cssPath, 'utf-8');
  } else if (existsSync(altCssPath)) {
    rawCss = readFileSync(altCssPath, 'utf-8');
  }
  if (rawCss) {
    const activeAtStart = getActiveDevPlugins();
    for (const plugin of activeAtStart) {
      if (typeof plugin.onBuildStart === 'function') {
        await plugin.onBuildStart();
      }
    }
    devUserCssContent = stripTailwindDirectives(rawCss);
    if (!isTailwindActive()) {
      devTailwindCssContent = '';
    } else {
      devTailwindCssContent = rawCss;
      for (const plugin of activeAtStart) {
        if (typeof plugin.onCSS === 'function') {
          const result = await plugin.onCSS(rawCss, cssPath);
          if (result !== null && typeof result === 'string') {
            devTailwindCssContent = result;
          }
        }
      }
      if (devUserCssContent === devTailwindCssContent || devUserCssContent === rawCss) {
        devTailwindCssContent = devUserCssContent;
      }
    }
    lastServedCssGlobal = devUserCssContent;
    lastServedCssTailwind = devTailwindCssContent;
  }

  let routeTree: RouteNode[] = scanRoutes(appDirPath);
  let clientBundle = '';
  let clientChunks = new Map<string, string>();
  let runtimeBundle = '';
  let devBundleBytes = 0;
  const bundleCache: ClientBundleCache = { files: new Map() };

  function runtimeImportNamesFrom(clientJs: string): string[] | null {
    const m = clientJs.match(/^import\s*\{([^}]*)\}\s*from\s*['"]\/_vesk\/runtime\.js['"];?\s*$/m);
    if (!m) return null;
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    return names.length > 0 ? names : null;
  }

  async function bundleRuntime() {
    try {
      const used = runtimeImportNamesFrom(clientBundle) ?? [...runtimeExportNames(runtimeDir)].filter((n): n is string => !!n);
      runtimeBundle = await buildTreeShakenRuntime(runtimeDir, used);
    } catch (e) {
      LOG.err(`runtime bundle error:`, (e as Error).message);
    }
  }

  function storeChunks(chunks: ChunkEntry[]): void {
    const next = new Map<string, string>();
    for (const c of chunks) next.set(`/_vesk/static/${c.name}`, c.code);
    clientChunks = next;
  }

  async function buildClientBundle() {
    try {
      const { main, chunks } = await generateClientBundle(routeTree, appDirPath, new Map(), {
        importRuntime: true,
        hmr: true,
        codeSplit: true,
        cache: bundleCache,
        ...(config.routeDataCache !== undefined ? { routeDataCache: config.routeDataCache as number } : {}),
      });
      clientBundle = main;
      devBundleBytes = Buffer.byteLength(main, 'utf8');
      storeChunks(chunks);
    } catch (e) {
      LOG.err(`client build error:`, (e as Error).message);
      throw e;
    }
  }

  /**
   * Targeted hot-path rebuild: regenerates route chunks with the incremental
   * cache, stat-checking ONLY the edited file and reusing every other cached
   * file without filesystem access. Also returns the compiled component
   * source for the edited file so callers can build HMR fnSources without a
   * second compileClient pass.
   */
  async function buildClientChunks(fullPath: string): Promise<{ err: Error | null; editedSource: string | null; actualName: string | null }> {
    try {
      const { chunks, editedSources, editedNames } = await generateClientBundle(routeTree, appDirPath, new Map(), {
        importRuntime: true,
        hmr: true,
        codeSplit: true,
        cache: bundleCache,
        only: [fullPath],
        returnEditedSources: true,
        ...(config.routeDataCache !== undefined ? { routeDataCache: config.routeDataCache as number } : {}),
      });
      storeChunks(chunks);
      return { err: null, editedSource: editedSources?.get(fullPath) ?? null, actualName: editedNames?.get(fullPath) ?? null };
    } catch (e) {
      LOG.err(`client chunks build error:`, (e as Error).message);
      return { err: e as Error, editedSource: null, actualName: null };
    }
  }

  await buildClientBundle();
  await bundleRuntime();

  const sourceToComponents = new Map<string, string[]>();

  function updateSourceMapping() {
    sourceToComponents.clear();
    for (const [compName, sourcePath] of collectSources(routeTree)) {
      const existing = sourceToComponents.get(sourcePath) || [];
      existing.push(compName);
      sourceToComponents.set(sourcePath, existing);
    }
  }
  updateSourceMapping();

  // DevTools panel router — the single `/__vesk/*` surface shared with the
  // adapter. `onPluginChange`/`rebuild` reuse the dev loop, and
  // `getDiagnostics` surfaces the newest build findings.
  // veskStateDir, configPluginsRaw and configPluginNames are defined at the top
  // of startDevServer for the active-plugin helpers (getActiveDevPlugins).

  let devLastBuildMs: number | null = null;
  let devLastError: { message: string; file?: string; line?: number; column?: number } | null = null;
  const devDiagnostics: DiagnosticFinding[] = [];

  function recordDiagnostic(finding: DiagnosticFinding): void {
    devDiagnostics.unshift(finding);
    if (devDiagnostics.length > 50) devDiagnostics.length = 50;
  }

  async function fullRebuild(): Promise<{ ok: boolean; error?: string; ms?: number }> {
    const t0 = Date.now();
    try {
      routeTree = scanRoutes(appDirPath);
      updateSourceMapping();
      await buildClientBundle();
      await bundleRuntime();
      await rebuildTailwindCss();
      devLastBuildMs = Date.now() - t0;
      devLastError = null;
      if (typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
        ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (m: Record<string, unknown>) => void)({ type: 'reload' });
      }
      return { ok: true, ms: devLastBuildMs ?? 0 };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      devLastError = { message: err.message };
      recordDiagnostic({ severity: 'error', code: 'BUILD', file: null, message: err.message, hint: 'Fix the failing file; HMR will reload on save.' });
      return { ok: false, error: err.message, ms: Date.now() - t0 };
    }
  }

  const devRouter = createDevApiRouter({
    appDir: appDirPath,
    veskDir: veskStateDir,
    configPluginNames,
    projectDir,
    getHmrState: () => ({
      status: devLastError ? ('error' as const) : ('up' as const),
      lastCompileMs: devLastBuildMs,
      error: devLastError,
      hasError: !!devLastError,
      componentCount: countPages(routeTree),
      nonce: (globalThis as Record<string, unknown>).__vesk_hmr_nonce as string | undefined,
      agenticAvailable: isAgenticActiveMain(),
    }),
    getDiagnostics: () => produceDiagnostics({ bundleBytes: devBundleBytes, configPluginNames, findings: devDiagnostics }),
    rebuild: () => fullRebuild(),
    onPluginChange: async () => {
      try { await rebuildTailwindCss(); } catch {}
      if (typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
        ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (m: Record<string, unknown>) => void)({ type: 'reload' });
      }
    },
  });

  // ── @vesk/agentic — agent router for startDevServer (per-provider .env.local keys)
  const agenticCheckpointManagerMain = new CheckpointManager();
  function isAgenticActiveMain(): boolean {
    try {
      if (SUPPORTED_PROVIDERS.some((p) => !!getApiKey(projectDir, p))) return true;
    } catch {}
    try {
      const recs = getPluginRecords(appDirPath, veskStateDir, configPluginNames);
      const rec = recs.find((r) => r.name === '@vesk/agentic' || r.package === '@vesk/agentic');
      return !!rec && rec.active;
    } catch { return false; }
  }
  function getAgenticPermissionsMain(): AgentCapabilityTable {
    const rawMode = (process.env.VESK_AGENTIC_MODE as string) || 'explore';
    const valid = ['explore', 'debug', 'agent'];
    const mode = (valid.includes(rawMode) ? rawMode : 'explore') as 'explore' | 'debug' | 'agent';
    return new AgentCapabilityTable(mode);
  }
  async function runAgenticAgentMain(prompt: string, _mode: string, providerConfig: unknown): Promise<import('@vesk/agentic/src/loop').AgentResult> {
    const { provider } = await buildAgenticProvider(projectDir, (providerConfig || {}) as Record<string, unknown>);
    const tools = createVeskTools({ projectDir, appDir: appDirPath, veskDir: veskStateDir });
    const budget = resolveAgenticStepBudget(projectDir, (providerConfig || {}) as Record<string, unknown>);
    const agent = new Agent({ provider, tools, maxSteps: budget.maxSteps, autoExtend: budget.autoExtend, hardMaxSteps: budget.hardMaxSteps });
    return agent.run(prompt);
  }
  const runAgentStreamMain = async function* (prompt: string, _mode: string, providerConfig: unknown): AsyncGenerator<import('@vesk/agentic/src/loop').AgentStreamEvent> {
    const { provider } = await buildAgenticProvider(projectDir, (providerConfig || {}) as Record<string, unknown>);
    const tools = createVeskTools({ projectDir, appDir: appDirPath, veskDir: veskStateDir });
    const budget = resolveAgenticStepBudget(projectDir, (providerConfig || {}) as Record<string, unknown>);
    const agent = new Agent({ provider, tools, maxSteps: budget.maxSteps, autoExtend: budget.autoExtend, hardMaxSteps: budget.hardMaxSteps });
    yield* agent.runStream(prompt);
  }
  let agentRouterMain: ReturnType<typeof createAgentRouter> | null = null;
  if (isAgenticActiveMain()) {
    try {
      agentRouterMain = createAgentRouter({
        projectDir,
        appDir: appDirPath,
        veskDir: veskStateDir,
        getPermissions: getAgenticPermissionsMain as unknown as () => import('@vesk/agentic/src/permissions').AgentCapabilityTable,
        runAgent: runAgenticAgentMain as unknown as (prompt: string, mode: import('@vesk/agentic/src/permissions').AgentMode, providerConfig?: unknown) => Promise<import('@vesk/agentic/src/loop').AgentResult>,
        runAgentStream: runAgentStreamMain as unknown as (prompt: string, mode: import('@vesk/agentic/src/permissions').AgentMode, providerConfig?: unknown) => AsyncIterable<import('@vesk/agentic/src/loop').AgentStreamEvent>,
        listCheckpoints: () => agenticCheckpointManagerMain.listNewestFirst(),
        rollback: (id: string) => agenticCheckpointManagerMain.get(id) ?? null,
        createCheckpoint: (...args: unknown[]) => {
          const first = args[0] as Record<string, unknown> | string | undefined;
          if (first && typeof first === 'object' && ('label' in first || 'message' in first)) return agenticCheckpointManagerMain.create(first as unknown as import('@vesk/agentic/src/checkpoints').CreateCheckpointOptions);
          const msg = typeof first === 'string' ? first : 'checkpoint';
          return agenticCheckpointManagerMain.create({ label: msg, message: msg });
        },
      });
    } catch { agentRouterMain = null; }
  }

  async function rebuildTailwindCss(): Promise<boolean> {
    if (!rawCss) return false;
    try {
      const nextUser = stripTailwindDirectives(rawCss);
      let nextTailwind: string;
      if (!isTailwindActive()) {
        nextTailwind = '';
      } else {
        const active = getActiveDevPlugins();
        nextTailwind = rawCss;
        for (const plugin of active) {
          if (typeof plugin.onCSS === 'function') {
            const result = await plugin.onCSS(rawCss, cssPath);
            if (result !== null && typeof result === 'string') {
              nextTailwind = result;
            }
          }
        }
        if (nextUser === nextTailwind || nextUser === rawCss) {
          nextTailwind = nextUser;
        }
      }
      const changed = nextUser !== lastServedCssGlobal || nextTailwind !== lastServedCssTailwind;
      devUserCssContent = nextUser;
      devTailwindCssContent = nextTailwind;
      lastServedCssGlobal = nextUser;
      lastServedCssTailwind = nextTailwind;
      return changed;
    } catch (e) {
      LOG.err(`CSS rebuild error:`, (e as Error).message);
      return false;
    }
  }

  const apiWatchCache = new Map<string, number>();
  try {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let cssDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watchDirs = [appDirPath];
    if (existsSync(srcDir)) watchDirs.push(srcDir);
    for (const watchDir of watchDirs) {
      watch(watchDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const isVsk = filename.endsWith('.vsk') || filename.endsWith('.md') || filename.endsWith('.markdown');
        const isCss = filename.endsWith('.css');
        const isApiRoute = filename.endsWith('.ts') || filename.endsWith('.js') || filename.endsWith('.tsx');
        if (!isVsk && !isCss && !isApiRoute) return;

        const fullPath = filename.startsWith('/') ? filename : join(watchDir, filename);
        const fileExists = existsSync(fullPath);

        if (isVsk) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            const t0 = Date.now();
            try {
              if (typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
                ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'compiling' });
              }

              const stripAnnots = (t: unknown): string =>
                JSON.stringify(t, (k, v) => (k === 'chunk' || k === 'chunkError') ? undefined : v);
              const prevTree = stripAnnots(routeTree);
              routeTree = scanRoutes(appDirPath);
              updateSourceMapping();
              const changedComponents = sourceToComponents.get(fullPath) || [];
              const treeChanged = prevTree !== stripAnnots(routeTree);

              // CSS rescan runs concurrently with the JS build (a .vsk edit
              // cannot change src/global.css) so the hot-swap broadcast is
              // not queued behind a second compile pass.
              const cssPromise = rebuildTailwindCss();

              let bundleError: Error | null = null;
              let hotEditedSource: string | null = null;
              let hotActualName: string | null = null;
              try {
                if (treeChanged) {
                  await buildClientBundle();
                  await bundleRuntime();
                } else {
                  const hot = await buildClientChunks(fullPath);
                  bundleError = hot.err;
                  hotEditedSource = hot.editedSource;
                  hotActualName = hot.actualName;
                }
              } catch (e) {
                bundleError = e as Error;
                LOG.err(`client build error:`, (e as Error).message);
              }

              if (typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
                if (changedComponents.length > 0) {
                  let fnSources: Record<string, string> | undefined;
                  let errorMessage = bundleError ? bundleError.message : '';
                  if (!treeChanged && !bundleError && hotEditedSource !== null) {
                    // Fast path: the targeted chunk rebuild already produced
                    // the stripped component source — just add route-name
                    // aliases.
                    let compCode = hotEditedSource;
                    for (const cname of changedComponents) {
                      if (hotActualName && hotActualName !== cname) {
                        compCode += `\nObject.defineProperty(__components, ${JSON.stringify(cname)}, { get: () => __components[${JSON.stringify(hotActualName)}], configurable: true });\n`;
                      }
                    }
                    if (compCode.trim()) fnSources = { _raw: compCode };
                  } else if (fileExists && !bundleError) {
                    try {
                      const src = readFileSync(fullPath, 'utf-8');
                      // Eval-safe snippet (same builder as the adapter path):
                      // full file scope without imports/exports or the
                      // registry preamble, block-wrapped so repeated evals
                      // cannot redeclare the file's top-level consts.
                      let compCode = buildHmrEvalSnippet(
                        compileClient(src, null, { forceClient: true, sourcePath: fullPath, mdRoots: [projectDir] }),
                      );
                      const actualName = extractCompName(src);
                      for (const cname of changedComponents) {
                        if (actualName && actualName !== cname) {
                          compCode += `\nObject.defineProperty(__components, ${JSON.stringify(cname)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });\n`;
                        }
                      }
                      if (compCode.trim()) fnSources = { _raw: compCode };
                    } catch (e) {
                      errorMessage = (e as Error).message;
                      LOG.err(`HMR compile error for ${filename}:`, (e as Error).message);
                    }
                  } else if (!fileExists) {
                    LOG.warn(`HMR source not found: ${fullPath}`);
                  }
                  if (fnSources) {
                    devLastError = null;
                    ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({
                      type: 'update',
                      time: Date.now() - t0,
                      components: Object.fromEntries(changedComponents.map(name => [name, true])),
                      fnSources
                    });
                  } else if (errorMessage) {
                    const err = bundleError;
                    let line = 0, col = 0, file = '';
                    const suggestions: string[] = [];
                    const nextSteps: string[] = [];
                    let tip = '';
                    const errDetails = err ? (err as unknown as Record<string, unknown>) : undefined;
                    if (errDetails?.name === 'VeskError') {
                      line = (errDetails.line as number) || 0;
                      col = (errDetails.column as number) || 0;
                      file = (errDetails.file as string) || fullPath.replace(projectDir, '').replace(/^\//, '') || filename || '';
                      if (errDetails.suggestions) suggestions.push(...(errDetails.suggestions as string[]));
                      if (errDetails.nextSteps) nextSteps.push(...(errDetails.nextSteps as string[]));
                      tip = (errDetails.tip as string) || '';
                    } else {
                      const lineMatch = errorMessage.match(/(?:line|at\s+line)\s*(\d+)/i);
                      const colMatch = errorMessage.match(/(?:column|col)\s*(\d+)/i);
                      const fileMatch = errorMessage.match(/(?:in|at)\s+['"]?([^'":\s]+(?:\.[a-z]+))['"]?/i);
                      line = lineMatch ? parseInt(lineMatch[1]) : 0;
                      col = colMatch ? parseInt(colMatch[1]) : 0;
                      file = fullPath.replace(projectDir, '').replace(/^\//, '') || filename || '';
                      if (fileMatch) file = fileMatch[1];
                    }
                    let code = '';
                    // Prefer the compiler's rich code frame (5 lines before/after + ^ pointer) if available
                    if (errDetails?.code && typeof errDetails.code === 'string' && (errDetails.code as string).trim()) {
                      code = errDetails.code as string;
                    } else if (line > 0 && fileExists) {
                      try {
                        const src = readFileSync(fullPath, 'utf-8');
                        const lines = src.split('\n');
                        const start = Math.max(0, line - 6);
                        const end = Math.min(lines.length, line + 5);
                        const width = String(end).length;
                        const out: string[] = [];
                        for (let i = start; i < end; i++) {
                          const ln = String(i + 1).padStart(width, ' ');
                          out.push(`${ln} | ${lines[i] ?? ''}`);
                          if (i + 1 === line) {
                            const pointerCol = Math.max(0, col - 1);
                            out.push(`${' '.repeat(width)} | ${' '.repeat(pointerCol)}^`);
                          }
                        }
                        code = out.join('\n');
                      } catch {}
                    }
                    const tips: string[] = [];
                    if (tip) tips.push(tip);
                    if (errorMessage.toLowerCase().includes('unexpected token')) tips.push('Check for missing or extra brackets, parentheses, or quotes.');
                    if (errorMessage.toLowerCase().includes('unexpected identifier')) tips.push('A keyword or identifier is in an unexpected position.');
                    if (errorMessage.toLowerCase().includes('expected')) tips.push('Check the syntax around the reported line.');
                    if (errorMessage.toLowerCase().includes('not defined') || errorMessage.toLowerCase().includes('is not defined')) tips.push('The variable or component may not be imported or declared.');
                    if (errorMessage.toLowerCase().includes('invalid')) tips.push('Check the expression syntax.');
                    if (errorMessage.toLowerCase().includes('component') && errorMessage.toLowerCase().includes('not')) tips.push('Ensure the component is properly defined.');
                    if (nextSteps.length) tips.push(...nextSteps);
                    if (tips.length === 0) tips.push('Review the code around the reported line.');
                    devLastError = { message: errorMessage, file, line, column: col };
                    recordDiagnostic({ severity: 'error', code: 'HMR_COMPILE', file: file || null, line: line || null, column: col || null, message: errorMessage, hint: tips[0] || null });
                    ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({
                      type: 'error',
                      message: errorMessage,
                      file,
                      line,
                      column: col,
                      code,
                      stack: err?.stack || '',
                      tips,
                      suggestions,
                      nextSteps,
                    });
                  } else {
                    devLastError = null;
                    ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'reload' });
                  }
                } else {
                  devLastError = null;
                  ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'reload' });
                }
              }
              const cssChanged = await cssPromise;
              if (cssChanged && typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
                ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'css-update' });
              }
              LOG.info(`rebuilt (${filename}) — ${Date.now() - t0}ms`);
            } catch (e) {
              LOG.err(`rebuild error:`, (e as Error).message);
            }
          }, HMR_DEBOUNCE_MS);
        } else if (isCss) {
          if (cssDebounceTimer) clearTimeout(cssDebounceTimer);
          cssDebounceTimer = setTimeout(async () => {
            try {
              if (fileExists) {
                rawCss = readFileSync(fullPath, 'utf-8');
              }
              const cssChanged = await rebuildTailwindCss();
              if (cssChanged && typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
                ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'css-update' });
              }
              LOG.info('CSS rebuilt');
            } catch (e) {
              LOG.err(`CSS rebuild error:`, (e as Error).message);
            }
          }, HMR_DEBOUNCE_MS);
        } else if (isApiRoute) {
          const isInApi = fullPath.includes('/api/');
          if (isInApi && fileExists) {
            apiWatchCache.set(fullPath, Date.now());
          }
        }
      });
    }
  } catch (e) {
    LOG.warn('file watching unavailable, serving without auto-rebuild');
  }

  const MIME: Record<string, string> = {
    '.svg': 'image/svg+xml', '.css': 'text/css', '': 'application/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    '.html': 'text/html', '.json': 'application/json',
  };

  const hmrJsPath = join(runtimeDir, 'hmr-client.js');
  const hmrTsPath = join(runtimeDir, 'hmr-client.ts');
  const hmrClientPath = existsSync(hmrJsPath) ? hmrJsPath : (existsSync(hmrTsPath) ? hmrTsPath : null);

  function extractCompName(src: string): string | null {
    return resolveComponentName(src);
  }

  function relaxCspForDev(sec: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!sec || sec.contentSecurityPolicy === false || sec.contentSecurityPolicy === 'off') return sec;
    let csp = sec.contentSecurityPolicy;
    if (csp === true) {
      csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
    }
    if (typeof csp === 'string' && csp.includes("script-src 'self'")) {
      csp = csp.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");
    }
    return { ...sec, contentSecurityPolicy: csp };
  }

  let rateLimiter: { check: (ip: string) => boolean } | null = null;
  const security = relaxCspForDev(config.security as Record<string, unknown> | undefined);
  if (security?.rateLimit) {
    const rlConfig = security.rateLimit as Record<string, unknown>;
    rateLimiter = createRateLimiter({ windowMs: (rlConfig.windowMs as number) || 60000, max: (rlConfig.max as number) || 100 });
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const reqStart = Date.now();
    const reqHost = req.headers.host || `localhost:${port}`;
    (globalThis as Record<string, unknown>).__vesk_ssr_base_url = `http://127.0.0.1:${port}`;

    const logRequest = (status: number) => {
      if (url.pathname.startsWith('/_vesk')) return;
      LOG.request(req.method || 'GET', url.pathname, status, Date.now() - reqStart);
    };
    const errorStatusCode = (e: unknown): number => {
      const s = (e as { statusCode?: unknown } | null)?.statusCode ?? (e as { status?: unknown } | null)?.status;
      return typeof s === 'number' && s >= 100 && s < 600 ? s : 500;
    };

    const rawCtx = buildRequestContext(req);
    if (security?.trustProxy) {
      applyTrustProxy(rawCtx, security.trustProxy as boolean | string);
    }

    if (rateLimiter) {
      const clientIp = (rawCtx.ip as string) || req.socket?.remoteAddress || 'unknown';
      if (!rateLimiter.check(clientIp)) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(((security?.rateLimit as Record<string, unknown>)?.windowMs as number || 60000) / 1000)),
        });
        res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: Math.ceil(((security?.rateLimit as Record<string, unknown>)?.windowMs as number || 60000) / 1000) }));
        return;
      }
    }

    const reqOrigin = req.headers['origin'] || '';
    const corsAllowed = corsHeaders(security || {}, reqOrigin, reqHost);
    if (corsAllowed['Access-Control-Allow-Origin'] && req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsAllowed, 'Content-Length': '0' });
      res.end();
      return;
    }
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = ((statusCode: number, headers?: Record<string, string | number | string[]>) => {
      return origWriteHead(statusCode, { ...headers, ...corsAllowed } as Record<string, string | number | string[]>);
    }) as typeof res.writeHead;

    if (url.pathname === '/_vesk/runtime' || url.pathname === '/_vesk/runtime.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(runtimeBundle);
      return;
    }
    if (url.pathname === '/_vesk/client' || url.pathname === '/_vesk/client.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(clientBundle);
      return;
    }
    if (url.pathname.startsWith('/_vesk/static/') && url.pathname.endsWith('.js')) {
      const code = clientChunks.get(url.pathname);
      if (code !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
        res.end(code);
        return;
      }
    }
    if (url.pathname === '/_vesk/ssr-data.js') {
      const token = url.searchParams.get('t') || '';
      const payload = ssrDataStore.get(token);
      if (payload) ssrDataStore.delete(token);
      const lines: string[] = [];
      if (payload?.props) lines.push(`globalThis.__vesk_props = ${JSON.stringify(payload.props)};`);
      if (payload?.ssrData) lines.push(`globalThis.__vsk_ssr_data = ${JSON.stringify(payload.ssrData)};`);
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      res.end(lines.join('\n') || '// no ssr data');
      return;
    }
    if (url.pathname === '/_vesk/static/global.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(devUserCssContent);
      return;
    }
    if (url.pathname === '/_vesk/static/_tailwind.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(isTailwindActive() ? devTailwindCssContent : '');
      return;
    }
    if (url.pathname === '/_vesk/hmr' || url.pathname === '/_vesk/hmr.js') {
      if (hmrClientPath) {
        let hmrContent = readFileSync(hmrClientPath, 'utf-8');
        if (hmrClientPath.endsWith('.ts')) {
          hmrContent = stripCodeTypes(hmrContent);
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(hmrContent);
        return;
      }
    }

    if (url.pathname.startsWith('/__vesk/')) {
      let body: unknown;
      try {
        body = await readBodyJson(req, maxBodyBytes);
      } catch (e) {
        if (e instanceof DevBodyTooLargeError) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
          return;
        }
        throw e;
      }
      if (agentRouterMain) {
        const agentRes = await agentRouterMain.route(req.method || 'GET', url.pathname, body, url.search);
        if (agentRes) { writeDevPanelResponse(res, agentRes); return; }
      }
      const devResponse = await devRouter.route(req.method || 'GET', url.pathname, body, url.search);
      if (devResponse) {
        writeDevPanelResponse(res, devResponse);
        return;
      }
    }

    if (await handleActionRequest(req, res, { url, appDirPath, routeTree, security, maxBodyBytes: maxBodyBytes })) {
      return;
    }

    if (url.pathname !== '/') {
      const staticPath = url.pathname.length > 1 ? resolveWithin(publicDir, url.pathname.slice(1)) : null;
      if (staticPath && existsSync(staticPath) && statSync(staticPath).isFile()) {
        const ext = extname(staticPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(staticPath));
        return;
      }
    }

    const mwChain = collectMiddlewareChain(routeTree, url.pathname, appDirPath);

    const apiDirPath = join(appDirPath, 'api');
    if (url.pathname.startsWith('/api') && existsSync(apiDirPath)) {
      const apiRoutes = await scanApiRoutes(apiDirPath);
      const apiMatch = matchApiUrl(apiRoutes, req.url || url.pathname);
      if (apiMatch) {
        const bodyChunks: Buffer[] = [];
        let bodyTotal = 0;
        let tooLarge = false;
        for await (const chunk of req) {
          bodyTotal += (chunk as Buffer).byteLength;
          if (bodyTotal > maxBodyBytes) { tooLarge = true; break; }
          bodyChunks.push(chunk as Buffer);
        }
        if (tooLarge) {
          logRequest(413);
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Request body exceeds limit (${maxBodyBytes} bytes)` }));
          return;
        }
        const bodyBuffer = Buffer.concat(bodyChunks);
        const requestUrl = req.url ? `http://localhost:${port}${req.url.startsWith('/') ? req.url : '/' + req.url}` : url.href;
        const rawHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          rawHeaders[k] = Array.isArray(v) ? v.join(', ') : (v || '');
        }

        let apiLocals: Record<string, unknown> = {};
        if (mwChain.length > 0) {
          const mwReq = new Request(requestUrl, { headers: rawHeaders, method: req.method || 'GET' });
          try {
            const mwResult = await executeMiddlewareChain(mwChain, mwReq, apiMatch.params, {
              plugins: getActiveDevPlugins() as VeskPlugin[],
              onLast: async () => null,
            });
            if (mwResult.response) {
              logRequest(mwResult.response.status);
              res.writeHead(mwResult.response.status, Object.fromEntries(mwResult.response.headers));
              res.end(await mwResult.response.text());
              return;
            }
            apiLocals = mwResult.locals || {};
            // Propagate rewrite if any
            if (mwResult.rewriteUrl) {
              url.pathname = mwResult.rewriteUrl;
            }
          } catch (e) {
            const err = e as Error & { name: string };
            if (err.name === 'NotFoundError') {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not Found' }));
              return;
            }
            throw e;
          }
        }

        const webRequest = buildWebRequest(req, req.url || url.pathname, bodyBuffer.length ? bodyBuffer : null);
        const response = await executeApiRoute(apiMatch.node.filePath!, (req.method || 'GET').toUpperCase(), webRequest, apiMatch.params, apiLocals, apiWatchCache);
        if (!response) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('API route returned no response');
          return;
        }
        logRequest(response.status);
        const body = await response.text();
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(body);
        return;
      }
    }

    const ctx = rawCtx;

    const match = matchUrl(routeTree, url.pathname);

    if (!match) {
      const rootNode = routeTree.find(n => (n.fullPath as string) === '/');
      let notFoundHtml: string | null = null;
      if (rootNode && rootNode.notFound) {
        const nfPath = resolve(appDirPath, rootNode.sourceDir as string, 'not-found.vsk');
        if (existsSync(nfPath)) {
          try {
            const nfSrc = readFileSync(nfPath, 'utf-8');
            const nfCompName = extractCompName(nfSrc) || (rootNode.notFound as string);
            notFoundHtml = await renderFullPage(nfSrc, nfCompName, { params: {}, url: url.pathname }, new Map(), { hydrate: true, cssUrls: activeCssUrls(), security, externalDataScript: storeDataScript, sourcePath: nfPath });
          } catch {}
        }
      }
      logRequest(404);
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(notFoundHtml || `<!DOCTYPE html><html><body><h1>404</h1><p>${url.pathname}</p></body></html>`);
      return;
    }

    const urlParts = url.pathname.split('/').filter(Boolean);
    const cleanChain: RouteNode[] = [];
    let segIdx = 0;
    for (const node of match.nodes) {
      if (node.fullPath === '/') {
        cleanChain.push(node);
      } else if (!node.isGroup && (node.segmentCount as number) > 0) {
        if (segIdx < urlParts.length) {
          cleanChain.push(node);
          segIdx++;
        }
      } else {
        cleanChain.push(node);
      }
    }
    const matched = match;
    const forData = req.headers['x-vesk-data'] === '1';

    async function renderSSR() {
      return withSsrStore(async () => {
      const chain = cleanChain;
      let body = '';
      let head = '';
      let props: Record<string, unknown> | undefined;

      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const pageFilePath = resolve(appDirPath, node.sourceDir as string, 'page.vsk');
        const layoutFilePath = resolve(appDirPath, node.sourceDir as string, 'layout.vsk');

        if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
          const src = readFileSync(pageFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.page as string);
          const result = await renderPage(src, compName, { params: matched.params }, new Map(), { hydrate: true, sourcePath: pageFilePath });
          body = result.body;
          head = result.head || '';
          props = result.props;
        }

        if (node.layout && existsSync(layoutFilePath)) {
          const src = readFileSync(layoutFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.layout as string);
          const result = await renderPage(src, compName, { children: body }, new Map(), { hydrate: true, sourcePath: layoutFilePath });
          body = result.body;
          head = (result.head || '') + head;
        }
      }

      if (forData) {
        return { html: '', props: props || { params: matched.params }, head };
      }

      const hasLayout = chain.some(n => n.layout && existsSync(resolve(appDirPath, n.sourceDir as string, 'layout.vsk')));
      let html: string;
      if (hasLayout) {
        const ssrData = ssrSink.snapshot();
        const dataScripts = buildDataScripts(props, ssrData || {}, storeDataScript);
        const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') + '\n' : '';
        let secMeta = '';
        if (security) {
          if (security.referrerPolicy !== false) secMeta += `\t<meta name="referrer" content="${(security.referrerPolicy as string) || 'strict-origin-when-cross-origin'}" />\n`;
          if (security.contentSecurityPolicy !== false) secMeta += `\t<meta http-equiv="Content-Security-Policy" content="${((security.contentSecurityPolicy as string) || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
          if (security.autoEscape !== false) secMeta += '\t<!-- vesk: auto-escape enabled -->\n';
        }
        html = `<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n${cssLinkTags()}${secMeta}${head ? '\t' + head.split('\n').join('\n\t') + '\n' : ''}</head>\n<body>\n<div id="root">\n${prettifyHtml(body)}\n</div>${dataScriptBlock}\n</body>\n</html>`;
        html = injectDevScripts(html);
      } else {
        const leaf = chain.find(n => n.page);
        if (leaf) {
          const src = readFileSync(resolve(appDirPath, leaf.sourceDir as string, 'page.vsk'), 'utf-8');
          const compName = extractCompName(src) || (leaf.page as string);
          html = await renderFullPage(src, compName, { params: matched.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: activeCssUrls(), security, externalDataScript: storeDataScript, sourcePath: resolve(appDirPath, leaf.sourceDir as string, 'page.vsk') });
          html = html.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
        } else {
          throw new Error('No page or layout matched');
        }
      }
      return { html, props: props || { params: matched.params }, head };
      });
    }

    function renderSSRStream() {
      async function* raw() {
      const chain = cleanChain;
      const hasLayout = chain.some(n => n.layout && existsSync(resolve(appDirPath, n.sourceDir as string, 'layout.vsk')));

      if (!hasLayout) {
        const leaf = chain.find(n => n.page);
        if (leaf) {
          const src = readFileSync(resolve(appDirPath, leaf.sourceDir as string, 'page.vsk'), 'utf-8');
          const compName = extractCompName(src) || (leaf.page as string);
          yield* renderPageStream(src, compName, { params: matched.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: activeCssUrls(), security, externalDataScript: storeDataScript, sourcePath: resolve(appDirPath, leaf.sourceDir as string, 'page.vsk') });
        } else {
          throw new Error('No page or layout matched');
        }
        return;
      }

      let body = '';
      let head = '';
      let props: Record<string, unknown> | undefined;

      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const pageFilePath = resolve(appDirPath, node.sourceDir as string, 'page.vsk');
        const layoutFilePath = resolve(appDirPath, node.sourceDir as string, 'layout.vsk');

        if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
          const src = readFileSync(pageFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.page as string);
          const result = await renderPage(src, compName, { params: matched.params }, new Map(), { hydrate: true, sourcePath: pageFilePath });
          body = result.body;
          head = result.head || '';
          props = result.props;
        }

        if (node.layout && existsSync(layoutFilePath)) {
          const src = readFileSync(layoutFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.layout as string);
          const result = await renderPage(src, compName, { children: body }, new Map(), { hydrate: true, sourcePath: layoutFilePath });
          body = result.body;
          head = (result.head || '') + head;
        }
      }

      yield '<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n' + cssLinkTags();
      if (security) {
        if (security.referrerPolicy !== false) yield `\t<meta name="referrer" content="${(security.referrerPolicy as string) || 'strict-origin-when-cross-origin'}" />\n`;
        if (security.contentSecurityPolicy !== false) yield `\t<meta http-equiv="Content-Security-Policy" content="${((security.contentSecurityPolicy as string) || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
        if (security.autoEscape !== false) yield '\t<!-- vesk: auto-escape enabled -->\n';
      }
      if (head) yield '\t' + head.split('\n').join('\n\t') + '\n';
      yield '</head>\n<body>\n<div id="root">\n';
      yield prettifyHtml(body);
      yield '\n</div>\n';
      const ssrData = ssrSink.snapshot();
      const dataScripts = buildDataScripts(props, ssrData || {}, storeDataScript);
      if (dataScripts.length > 0) yield dataScripts.join('\n') + '\n';
      // The streamed document must carry the client bundle (mirrors the
      // buffered renderSSR path via injectDevScripts) or the page can never
      // hydrate — the sender below only appends hmr.js.
      yield '\t<script type="module" src="/_vesk/client.js"></script>\n</body>\n</html>';
      }

      const gen = raw();
      async function* scoped() {
        let result: IteratorResult<string, void>;
        do {
          result = (await withSsrStore(() => gen.next())) as IteratorResult<string, void>;
          if (!result.done) yield result.value;
        } while (!result.done);
      }
      return scoped();
    }

    let mwLocals: Record<string, unknown> = {};
    try {
      if (mwChain.length > 0) {
        const mwReq = new Request(`http://localhost${url.pathname}${url.search}`, {
          headers: req.headers as Record<string, string>,
          method: req.method || 'GET',
        });
        const mwResult = await executeMiddlewareChain(mwChain, mwReq, match.params, {
          plugins: getActiveDevPlugins() as VeskPlugin[],
          onLast: async (rewrite: string | null, mwCtx: any) => {
            if (rewrite) url.pathname = rewrite;
            // mwCtx is the middleware context with correct locals/cookies/url.
            // executeMiddlewareChain already sets globalThis.__vesk_request to mwCtx
            // during the call, so we just render without overriding it.
            // Fall back to ctx only if mwCtx is missing (backward compat).
            const prev = (globalThis as Record<string, unknown>).__vesk_request;
            if (mwCtx && !(prev as any)?.locals) {
              (globalThis as Record<string, unknown>).__vesk_request = mwCtx;
            }
            try {
              try {
                const rendered = await renderSSR();
                const secHeaders = security ? securityHeaders({ security }) : {};
                if (forData) {
                  return new Response(JSON.stringify({ path: url.pathname, params: match.params, props: rendered.props, head: rendered.head }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data', ...secHeaders } });
                }
                return new Response(rendered.html, { headers: { 'Content-Type': 'text/html', ...secHeaders } });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (forData) {
                  const code = errorStatusCode(e);
                  return new Response(JSON.stringify({ error: msg, statusCode: code }), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' } });
                }
                throw e;
              }
            } finally {
              (globalThis as Record<string, unknown>).__vesk_request = prev;
            }
          },
        });
        mwLocals = mwResult.locals;
        if (mwResult.response) {
          const respRecord = mwResult.response as unknown as Record<string, unknown>;
          if (typeof respRecord.build === 'function') (respRecord.build as () => void)();
          logRequest(mwResult.response.status);
          res.writeHead(mwResult.response.status, Object.fromEntries(mwResult.response.headers));
          res.end(await mwResult.response.text());
          return;
        }
      } else {
        const prev = (globalThis as Record<string, unknown>).__vesk_request;
        (globalThis as Record<string, unknown>).__vesk_request = ctx;
        try {
          const secHeaders = security ? securityHeaders({ security }) : {};
          if (forData) {
            try {
              const rendered = await renderSSR();
              logRequest(200);
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data', ...secHeaders });
              res.end(JSON.stringify({ path: url.pathname, params: match.params, props: rendered.props, head: rendered.head }));
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              logRequest(500);
              res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data', ...secHeaders });
              res.end(JSON.stringify({ error: msg }));
            }
            return;
          }
          const stream = renderSSRStream();
          logRequest(200);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Transfer-Encoding': 'chunked', ...secHeaders });
          for await (const chunk of stream) {
            if (chunk.includes('</body>')) {
              res.write(chunk.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>'));
            } else {
              res.write(chunk);
            }
          }
          res.end();
        } finally {
          (globalThis as Record<string, unknown>).__vesk_request = prev;
        }
        return;
      }
    } catch (e) {
      const err = e as Error & { name: string; status?: number; url?: string; stack?: string };
      if (err.name === 'Redirect') {
        const status = err.status || 302;
        logRequest(status);
        res.writeHead(status, { Location: err.url });
        res.end(`<!DOCTYPE html><html><body><a href="${err.url}">Redirect</a></body></html>`);
      } else if (err.name === 'NotFoundError') {
        let notFoundHtml: string | null = null;
        if (match && match.nodes) {
          for (let i = match.nodes.length - 1; i >= 0; i--) {
            const node = match.nodes[i];
            if (node.notFound) {
              const nfPath = resolve(appDirPath, node.sourceDir as string, 'not-found.vsk');
              if (existsSync(nfPath)) {
                try {
                  const nfSrc = readFileSync(nfPath, 'utf-8');
                  const nfCompName = extractCompName(nfSrc) || (node.notFound as string);
                  const html = await renderFullPage(nfSrc, nfCompName, { params: match.params, url: url.pathname }, new Map(), { hydrate: true, cssUrls: activeCssUrls(), security, externalDataScript: storeDataScript, sourcePath: nfPath });
                  notFoundHtml = injectDevScripts(html);
                } catch {}
              }
              break;
            }
          }
        }
        logRequest(404);
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(notFoundHtml || '<!DOCTYPE html><html><body><h1>404 — Not Found</h1></body></html>');
      } else {
        let errorHtml: string | null = null;
        if (match && match.nodes) {
          for (let i = match.nodes.length - 1; i >= 0; i--) {
            const node = match.nodes[i];
            if (node.error) {
              const errPath = resolve(appDirPath, node.sourceDir as string, 'error.vsk');
              if (existsSync(errPath)) {
                try {
                  const errSrc = readFileSync(errPath, 'utf-8');
                  const errCompName = extractCompName(errSrc) || (node.error as string);
                  const errProps = { error: err.message, stack: err.stack, statusCode: errorStatusCode(err), url: url.pathname };
                  const html = await renderFullPage(errSrc, errCompName, errProps, new Map(), { hydrate: true, cssUrls: activeCssUrls(), security, externalDataScript: storeDataScript, sourcePath: errPath });
                  errorHtml = injectDevScripts(html);
                } catch (e2) {
                  LOG.err(`error page render failed:`, (e2 as Error).message);
                }
              }
              break;
            }
          }
        }
        const errCode = errorStatusCode(err);
        logRequest(errCode);
        res.writeHead(errCode, { 'Content-Type': 'text/html' });
        res.end(injectSsrErrorMarker(errorHtml || `<!DOCTYPE html><html><body><h1>${errCode}</h1><pre>${err.message}\n${err.stack}</pre></body></html>`, err));
      }
    }
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      LOG.err(`port ${port} is already in use — is another vesk dev server running?`);
      process.exit(1);
    }
    throw e;
  });

  server.listen(port, bindHost, () => {
    LOG.ok(`dev server at http://localhost:${port} (listening on ${bindHost})`);
    const routes = collectRoutePaths(routeTree);
    const pageCount = countPages(routeTree);
    const apiCount = countFilesNamed(join(appDirPath, 'api'), 'route.ts');
    LOG.info(`${projectDir}`);
    LOG.info(`${pageCount} page${pageCount === 1 ? '' : 's'}: ${routes.join(', ') || '(none)'}`);
    if (apiCount > 0) LOG.info(`${apiCount} api route${apiCount === 1 ? '' : 's'} (app/api)`);
    LOG.info('hmr enabled — edit app/ to hot reload');
  });

  updateSourceMapping();

  const hmrClients = new Set<import('ws').WebSocket>();
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    hmrClients.add(ws);
    ws.on('close', () => hmrClients.delete(ws));
  });
  server.on('upgrade', (req, socket, head) => {
    // Origin-checked: cross-site pages always attach Origin to WS handshakes
    if (req.url === '/_vesk/hmr' && isAllowedWsUpgrade(req.headers as Record<string, unknown>)) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Nonce gating the client-side HMR eval hook (see appendHmrGlobals) — the
  // nonce is broadcast with every update and checked before eval runs.
  const hmrNonce = randomToken(16);
  (globalThis as Record<string, unknown>).__vesk_hmr_nonce = hmrNonce;

  (globalThis as Record<string, unknown>).__vesk_broadcastHmr = (update: Record<string, unknown>) => {
    const msg = JSON.stringify({ ...update, nonce: hmrNonce });
    for (const ws of hmrClients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  };

  await new Promise(() => {});
}

const TAILWIND_BLOCK = /^\s*@(theme\s*\{|layer\s+(components|utilities)\s*\{|utility\s+\w+\s*\{)/;
const LAYER_BASE = /^\s*@layer\s+base\s*\{/;

/**
 * Bake the `vesk-ssr-error` marker into a dev error page so hmr-client can
 * pop the error overlay on load (the HMR channel only reports compile
 * errors — an SSR failure served as a page would otherwise stay silent).
 * Mirrors the marker convention in adapter hmr/ssr-function SSR paths.
 */
function injectSsrErrorMarker(html: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const marker = `<!--vesk-ssr-error:${encodeURIComponent(msg || 'Internal Server Error')}-->`;
  const bodyIdx = html.indexOf('<body');
  if (bodyIdx >= 0) {
    const end = html.indexOf('>', bodyIdx);
    if (end >= 0) return html.slice(0, end + 1) + marker + html.slice(end + 1);
  }
  return marker + html;
}

function stripTailwindDirectives(css: string): string {
  const lines = css.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("@import 'tailwindcss'") || line.startsWith('@import "tailwindcss"')) {
      i++;
      continue;
    }
    if (line.startsWith('@source ')) {
      i++;
      continue;
    }
    if (TAILWIND_BLOCK.test(line)) {
      let braceCount = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      i++;
      while (i < lines.length && braceCount > 0) {
        braceCount += (lines[i].match(/\{/g) || []).length;
        braceCount -= (lines[i].match(/\}/g) || []).length;
        i++;
      }
      continue;
    }
    result.push(lines[i]);
    i++;
  }
  return result.join('\n').trim();
}

function buildRequestContext(req: IncomingMessage): {
  headers: Record<string, string>;
  url: string | undefined;
  method: string;
  cookies: Record<string, string>;
  locals: Record<string, unknown>;
  ip?: string;
} {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v.join(', ') : (v || '');
  }
  const cookies: Record<string, string> = {};
  const raw = req.headers.cookie || '';
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) cookies[k] = v;
  }
  return { headers, url: req.url, method: req.method || 'GET', cookies, locals: {}, ip: undefined };
}
