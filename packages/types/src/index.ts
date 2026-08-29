/**
 * @vesk/types — single source of truth for every public Vesk framework type.
 *
 * This package is a pure leaf: no imports from other framework packages, no
 * runtime values. Framework packages re-export these types for backward
 * compatibility, but new code should import from '@vesk/types' directly.
 */

// ────────────────────────────────────────────────────────────────────────────
// Routing
// ────────────────────────────────────────────────────────────────────────────

export interface RouteNode {
  path: string;
  fullPath: string;
  isGroup: boolean;
  isDynamic: boolean;
  isCatchAll: boolean;
  page: string | null;
  layout: string | null;
  loading: string | null;
  error: string | null;
  notFound: string | null;
  offline: string | null;
  network: string | null;
  hasMiddleware: boolean;
  children: RouteNode[];
  sourceDir: string;
  segmentCount: number;
  /** ISR: seconds after which the cached page may be revalidated. */
  _revalidate?: number;
  _isrTags?: string[];
  _pageName?: string;
  _layoutName?: string;
  _errorName?: string;
  _notFoundName?: string;
  /** Client-bundle chunk URL for this node (code-split dev/prod builds). */
  chunk?: string;
  chunkError?: string;
}

export interface ApiRouteNode {
  path: string;
  fullPath: string;
  isDynamic: boolean;
  isCatchAll: boolean;
  filePath: string | null;
  children: ApiRouteNode[];
}

// ────────────────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────────────────

export interface MiddlewareContext {
  request: Request;
  params: Record<string, string>;
  url: URL;
  locals: Record<string, unknown>;
  cookies: Record<string, string>;
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  [key: string]: unknown;
}

export interface MiddlewareEntry {
  sourcePath: string;
  node: RouteNode;
}

export interface MiddlewareChainOptions {
  onLast?: (rewriteUrl: string | null, ctx?: MiddlewareContext) => Response | Promise<Response | null> | null;
  plugins?: VeskPlugin[];
}

export interface MiddlewareChainItem {
  sourcePath: string;
  node: RouteNode;
}

export interface MiddlewareExtractResult {
  params: string;
  body: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Plugins
// ────────────────────────────────────────────────────────────────────────────

export interface VeskPlugin {
  name: string;
  provides?: Record<string, (() => unknown | Promise<unknown>) | unknown>;
  onRequest?: (ctx: MiddlewareContext) => void | Promise<void>;
  onCSS?: (content: string, filePath: string) => string | null | Promise<string | null>;
  onFileWatch?: (filePath: string) => { handled: boolean } | Promise<{ handled: boolean }>;
  onTransformJS?: (code: string, filePath: string) => string | null | Promise<string | null>;
  onBuildStart?: () => void | Promise<void>;
  onBuildEnd?: () => void | Promise<void>;
  [key: string]: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Security
// ────────────────────────────────────────────────────────────────────────────

export interface VeskCors {
  origin: string | string[];
  methods?: string;
  headers?: string;
  credentials?: boolean;
  maxAge?: number;
}

export interface VeskRateLimit {
  windowMs?: number;
  max?: number;
}

export type VeskSecurityPreset = 'strict' | 'default' | 'minimal' | 'off';

export interface VeskSecurity {
  xFrameOptions?: string | false;
  hsts?: string | false;
  referrerPolicy?: string | false;
  contentSecurityPolicy?: boolean | string;
  autoEscape?: boolean;
  csrf?: boolean;
  cors?: VeskCors;
  trustProxy?: boolean | string;
  rateLimit?: VeskRateLimit;
  redactLogs?: boolean;
  [key: string]: unknown;
}

/** Adapter-side alias kept for the prod server / platform handlers. */
export interface SecurityConfig {
  security?: VeskSecurity;
  trustProxy?: boolean;
  rateLimit?: VeskRateLimit;
}

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

/** Raw-HTML handling policy for the `<Md>` renderer.
 * - `'escape'` (default): every HTML-ish construct renders as visible text.
 * - `'allow'`: raw HTML passes through verbatim — only use with trusted content.
 * - `'allowlist'`: only `allowTags` pass through; event-handler attributes are
 *   dropped and `href`/`src` go through URL sanitization. */
export type MdHtmlMode = 'escape' | 'allow' | 'allowlist';

export interface MdConfig {
  /** Raw-HTML policy for Markdown rendering. Default 'escape'. */
  html?: MdHtmlMode;
  /** Tag allowlist for `html: 'allowlist'`. Lowercased during validation. */
  allowTags?: string[];
}

export interface VeskConfig {
  appDir?: string;
  outDir?: string;
  publicDir?: string;
  ssg?: { getStaticPaths?: () => Promise<{ paths: Array<{ params: Record<string, string> }> }> };
  plugins?: VeskPlugin[];
  security?: VeskSecurity | VeskSecurityPreset | false | ((preset: (name: string, overrides?: VeskSecurity) => VeskSecurity) => VeskSecurity);
  /** Client router route-data freshness TTL in milliseconds. The SPA router
   * refetches a route's server data when it is older than this. Default 0 =
   * always fetch fresh data on every SPA visit. */
  routeDataCache?: number;
  /** Markdown (`<Md>`) rendering options. */
  md?: MdConfig;
}

// ────────────────────────────────────────────────────────────────────────────
// Build pipeline
// ────────────────────────────────────────────────────────────────────────────

export interface AncestorLayout {
  sourceDir: string;
  layoutCompName: string;
}

export interface BuildOptions {
  outDir?: string;
  publicDir?: string;
  plugins?: VeskPlugin[];
  seo?: boolean;
  strictSeo?: boolean;
  siteUrl?: string;
  ssg?: boolean;
  codeSplit?: boolean;
  hmr?: boolean;
  target?: 'node' | 'edge';
  platform?: 'node' | 'vercel' | 'netlify' | 'cloudflare' | 'deno' | 'aws' | 'edge' | 'coxmos';
  /** Client router route-data freshness TTL (ms). Default 0 = always refetch. */
  routeDataCache?: number;
  /** Markdown policy applied for the build (SSG prerender warnings). */
  md?: MdConfig;
}

export interface DevServerOptions {
  port?: number;
  /** Bind address. Defaults to 127.0.0.1 (loopback) — pass '0.0.0.0' to expose. */
  host?: string;
  publicDir?: string;
  block?: boolean;
  /** Request body size cap in bytes. Default 1 MiB. */
  maxBodyBytes?: number;
}

export interface ProdServerOptions {
  port?: number;
  /** Bind address. Defaults to 127.0.0.1 (loopback) — pass '0.0.0.0' to expose. */
  host?: string;
  /** Request body size cap in bytes. Default 1 MiB. */
  maxBodyBytes?: number;
}

export interface SsrFunctionOptions {
  ancestorLayouts?: AncestorLayout[];
  middlewareCode?: string | null;
}

export interface ApiFunctionOptions {
  middlewareCode?: string | null;
}

export interface ClientBundleFileEntry {
  mtimeMs: number;
  size: number;
  compCode: string;
  hydCode: string;
  actualName: string | null;
  runtimeNames: string[];
  /** Absolute paths of this file's .vsk imports, in emission order. */
  imports: string[];
}

export interface ClientBundleCache {
  files: Map<string, ClientBundleFileEntry>;
  mainBundle?: { key: string; code: string };
}

export interface ClientBundleOptions {
  codeSplit?: boolean;
  hmr?: boolean;
  importRuntime?: boolean;
  routeDataCache?: number;
  /**
   * Incremental compile cache for dev rebuilds. Pass the same object across
   * calls; unchanged files (matched by mtime + size) reuse their previously
   * compiled output instead of re-running compileClient, and the main bundle
   * is reused when its inputs (route tree + runtime import names) are
   * unchanged.
   */
  cache?: ClientBundleCache;
  /**
   * Hot-path restriction for dev rebuilds: only these absolute paths are
   * checked against the filesystem; every other cached file is reused
   * WITHOUT a stat call.
   */
  only?: string[];
  /**
   * When set together with `only`, the result carries the raw compiled
   * component source for each restricted path (imports/wrappers stripped),
   * so callers building HMR fnSources don't need a second compileClient
   * pass.
   */
  returnEditedSources?: boolean;
}

export interface ChunkEntry {
  name: string;
  code: string;
}

export interface MonolithicBundleParts {
  componentLines: string[];
  hydratorLines: string[];
  aliasLines: string[];
  hydratorAliasLines: string[];
}

export interface ClientBundleResult {
  main: string;
  chunks: ChunkEntry[];
  /** Present when a cache was passed: files served from the incremental cache. */
  cachedFileHits?: number;
  /** Present when a cache was passed: files actually recompiled this call. */
  compiledFiles?: number;
  /** Present when a cache was passed: true when the main bundle was reused. */
  mainFromCache?: boolean;
  /** Present when returnEditedSources was set: path → stripped component source. */
  editedSources?: Map<string, string>;
  /** Present when returnEditedSources was set: path → resolved component name. */
  editedNames?: Map<string, string | null>;
}

export interface ManifestRouteEntry {
  path: string;
  type: 'ssr' | 'api';
  function: string;
  revalidate?: number;
  tags?: string[];
}

export interface ManifestActionEntry {
  id: string;
  function: string;
}

export interface ManifestPrerenderedEntry {
  path: string;
  file: string;
}

export interface Manifest {
  version: number;
  middleware: boolean;
  routes: ManifestRouteEntry[];
  prerendered: ManifestPrerenderedEntry[];
  static: {
    prefix: string;
    dir: string;
  };
  actions?: ManifestActionEntry[];
}

export interface SsgRouteResult {
  path: string;
  html: string;
  static: boolean;
  params?: Record<string, string>;
}

export interface BuildResult {
  routeTree: RouteNode[];
  apiTree: ApiRouteNode[];
  ssrRoutes: RouteNode[];
  apiRoutes: ApiRouteNode[];
  manifest: Manifest;
}

export interface ImageRef {
  source: string;
  src: string;
}

export interface ImageResult {
  src: string;
  baseName: string;
  files: string[];
  widths: number[];
}

export interface SeoCheckIssue {
  severity: 'warn' | 'error';
  message: string;
}

export interface SeoAuditResult {
  passed: number;
  errors: number;
  warnings: number;
}

export interface CombinedPageInfo {
  path: string;
  src: string;
  hasLayout: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Server rendering
// ────────────────────────────────────────────────────────────────────────────

export interface RenderPageResult {
  body: string;
  head: string;
  props: Record<string, unknown>;
}

export interface SSGResult {
  html: string;
  body: string;
  head: string;
  props: string;
  clientCode: string;
  static: boolean;
  staticLists: boolean;
}

export interface DataScriptPayload {
  props?: Record<string, unknown>;
  ssrData?: Record<string, unknown>;
}

/**
 * When provided, hydration data (serialized props + useFetch SSR data) is
 * served as an external classic script (`<script src="...">`) instead of an
 * inline `<script>globalThis.__vsk_ssr_data = ...</script>`. Inline data
 * scripts are blocked by strict Content-Security-Policy headers
 * (`script-src 'self'` without `'unsafe-inline'`), so servers must deliver
 * the payload through an origin-served file. The callback stores the payload
 * server-side and returns the script src URL (or null to fall back to inline).
 */
export type ExternalDataScript = (payload: DataScriptPayload) => string | null;

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renderable component content. Text values, arrays of them (what `{list.map(...)}`
 * produces), or nothing — this is the type of `children` and of any JSX-expression
 * container's value.
 */
export type Component = string | number | boolean | null | undefined | Component[];

/**
 * Props shape for layouts: they receive their child tree as `children`.
 */
export interface LayoutProps {
	children?: Component;
}

// ────────────────────────────────────────────────────────────────────────────
// Requests & responses (structural shapes — @vesk/runtime provides classes)
// ────────────────────────────────────────────────────────────────────────────

export interface CookieStore {
  get(name: string): string | undefined;
  getAll(): Array<{ name: string; value: string }>;
  toString(): string;
  [name: string]: unknown;
}

export interface ServerRequest extends Request {
  cookies: CookieStore | Record<string, string>;
  params: Record<string, string>;
  locals: Record<string, unknown>;
}

export interface VeskRequest extends ServerRequest {
  readonly query: Record<string, string>;
  ip: string;
  protocol: string;
  hostname: string;
  parsedUrl: URL;
  getBody(): Promise<unknown>;
}

export interface SetCookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  domain?: string;
}

export interface VeskResponse extends Response {
  setStatus(code: number): VeskResponse;
  build(): VeskResponse;
  setCookie(name: string, value: string, opts?: SetCookieOptions): VeskResponse;
  clearCookie(name: string, opts?: { path?: string; domain?: string }): VeskResponse;
  setCsp(policy: string | false): VeskResponse;
  setSecurityHeader(name: string, value: string | false): VeskResponse;
  cache(ttlSeconds: number): VeskResponse;
  noCache(): VeskResponse;
  cors(opts?: { origin?: string; methods?: string; headers?: string; credentials?: boolean }): VeskResponse;
}

export declare namespace VeskResponse {
  /**
   * Create a chunked streaming response from a `ReadableStream` body.
   *
   * The stream is piped verbatim to the client with `Transfer-Encoding: chunked`
   * and no `Content-Length`, so the browser can start rendering before the
   * producer has finished. On the dev/prod servers the response is delivered
   * via `deliverResponse` (async `getReader()` loop → `res.write()`), with a
   * text fallback when no `body.getReader` is present.
   *
   * @param readable - Source stream (e.g. from `fs.createReadStream`, an API
   *   route's `ReadableStream`, or an SSE generator). The runtime coerces it to
   *   `BodyInit` (`as unknown as BodyInit`).
   * @param init - Standard `ResponseInit` (`status`, `statusText`, `headers`).
   *   Defaults to `200` + `Content-Type` from the producer; callers typically
   *   set `Content-Type: text/markdown; charset=utf-8` or `text/event-stream`.
   * @returns A `VeskResponse` whose `body` is the supplied stream.
   * @example
   * ```ts
   * // app/api/docs/[...path]/route.ts
   * export async function GET(req: Request) {
   *   const md = await readFile(join(publicDir, path), 'utf8');
   *   const stream = new ReadableStream({
   *     start(c) { c.enqueue(new TextEncoder().encode(md.slice(0, 400))); c.close(); }
   *   });
   *   return VeskResponse.stream(stream, { headers: { 'Content-Type': 'text/markdown' } });
   * }
   * ```
   */
  export function stream(readable: ReadableStream, init?: ResponseInit): VeskResponse;
}

// ────────────────────────────────────────────────────────────────────────────
// Resources — useFetch / createResource (canonical shapes for @vesk/runtime)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Opaque reactive cell — structural shape of `Tracked<T>` from
 * `@vesk/runtime/src/ripple-runtime.ts`.
 *
 * A `Tracked` is the primitive of Vesk's fine-grained reactivity: a container
 * that holds a value (`__v`), carries ripple flags (`f`), and notifies its
 * owning `Block` on `set`. Component code never constructs one directly;
 * `track(v)` / `const &[x] = track(0)` does. Resource `into` targets and
 * `Md`'s `content` cell both use this shape.
 *
 * **Two call-sites:**
 * - Plain JS: `const count = track(0)` → `get(count)` / `set(count, 1)` / `peek(count)`.
 * - `.vsk` TrackDecl: `const &[count] = track(0)` → read/write `count` directly
 *   (`count`, `count = 1`, `count++`); the compiler inserts `get`/`set`. With
 *   `const &[count, rawCell] = track(0)` you get both the auto-tracked `count`
 *   and the underlying `rawCell: Tracked<number>`.
 *
 * @typeParam T - Cell value type.
 * @example
 * ```ts
 * // plain JS
 * const count = track(0);          // Tracked<number>
 * get(count); // 0  (subscribes)
 * set(count, 1);
 * peek(count); // 1 (read without subscribing)
 * ```
 * @example
 * ```vsk
 * component Counter {
 *   const &[count] = track(0)
 *   <button onClick={() => count++}>{count}</button>
 * }
 * ```
 */
export interface Tracked<T = unknown> {
  /** Read the value and register a dependency when inside a reactive context. */
  get(): T;
  /** Write a new value; no-ops when `===` the old value, otherwise schedules an update. */
  set(value: T): void;
  /** Internal ripple flags — present on every ripple object (`Tracked` | `Derived`). */
  f?: number;
  /** Internal current value (raw). `peek` reads this without subscribing. */
  __v?: T;
}

/**
 * Reactive resource returned by `createResource` / `useFetch` and its
 * variants. It is *thenable* (`await resource` resolves to `data`) and
 * exposes live `loading` / `error` / `data` state that the compiler can read
 * in `if (res.loading)` branches.
 *
 * On the **server** the fetcher is deduped by `key`, run through
 * `runFetcher` (retry + timeout), and stashed via `setSsrData(key, data)` into
 * `globalThis.__vsk_ssr_data`; the HTML ships with that payload. On the
 * **client** `getSsrData(key)` settles instantly (no refetch); otherwise the
 * client honours `staleTime`, `dedupe`, and the `__vsk_fetch_inflight` map.
 *
 * @typeParam T - Unwrapped payload type (e.g. `string` for `.text()` / `.stream()`).
 * @example
 * ```ts
 * const posts = useFetch<Post[]>('/api/posts'); // Resource<Post[]>
 * if (posts.loading) return <p>Loading…</p>;
 * if (posts.error) return <p>{String(posts.error)}</p>;
 * return <ul>{posts.data!.map(p => <li>{p.title}</li>)}</ul>;
 * await posts; // also thenable
 * posts.refresh(); // revalidate all handles for the key
 * ```
 */
export interface Resource<T> extends PromiseLike<T> {
  /** `true` while the fetcher (or a `refresh()`) is in flight. */
  loading: boolean;
  /** Last fetch error (an `HttpError`, `TimeoutError`, `AbortError`, or thrown value). */
  error: unknown;
  /** Last successfully fetched payload, or `undefined` before the first success. */
  data: T | undefined;
  /** Reactive cell that mirrors `{ loading, error, data }` for `if (res.loading)` compiler patterns. */
  _state?: Tracked<{ loading: boolean; error: unknown; data: T | undefined }>;
  /** Re-run the fetcher for every handle registered under the same `key` (aborts inflight first). */
  refresh(): void;
  /** Abort the in-flight request (client only; no-op on the server). */
  abort(): void;
  /** When `into` was supplied, the target cell — progressive writes go here for `.stream`. */
  into?: Tracked<T>;
}

/**
 * Options for `useFetch` / `createResource`. Extends `RequestInit` (`method`,
 * `headers`, `credentials`, `cache`, `mode`, `redirect`, `referrer`,
 * `integrity`, `keepalive`, `signal`, …) with Vesk-specific resource controls.
 * `body` is `unknown` (objects are auto-`JSON.stringify`'d with
 * `Content-Type: application/json` unless already a `BodyInit`).
 *
 * @typeParam T - Payload type.
 */
export interface UseFetchOptions<T> extends Omit<RequestInit, 'body'> {
  /**
   * Dedupe / SSR-handoff key. Defaults to the URL string (or the fetcher's
   * `toString().slice(0,64)` for function fetchers). Handles sharing a key are
   * co-located in `__vsk_fetch_registry` and all refresh together.
   */
  key?: string;
  /**
   * Target tracked cell — the fetched payload is written into it via `set(into, data)`.
   * When present the component can render `get(into)` / `{into}` directly without
   * awaiting the resource. Required for `useFetch.stream` progressive rendering.
   */
  into?: Tracked<T>;
  /** Request body. Plain objects become JSON; `string`/`FormData`/`Blob`/`ArrayBuffer` pass through. */
  body?: unknown;
  /**
   * Client cache TTL in ms. While `Date.now() - fetchedAt < staleTime` the
   * cached `data` is reused and no network request is issued. Default `0`
   * (always fetch).
   */
  staleTime?: number;
  /** Keep the previous `data` visible while `loading` is `true` on refresh. Default `false`. */
  keepPreviousData?: boolean;
  /** Number of retries for `GET` (only) on failure. Default `0`. */
  retry?: number;
  /** Base delay in ms for exponential backoff (`delay * 2^attempt`). Default `1000`. */
  retryDelay?: number;
  /**
   * Abort-escalating timeout in ms. `0` disables it. Implemented as
   * `Promise.race(fetcher, setTimeout(..., TimeoutError))` with an
   * `AbortController` linked to any user `signal`.
   */
  timeout?: number;
  /** When `false` the resource is created in `loading:false` idle state and no fetch is issued until `refresh()`. */
  enabled?: boolean;
  /** Deduplicate inflight requests sharing the same `key` (`__vsk_fetch_inflight`). Default `true`. */
  dedupe?: boolean;
}

/**
 * Options for `useFetch.stream` — a text-streaming fetch whose decoded chunks
 * are written progressively into `into`.
 *
 * `urlOrFn` may be a provider `() => string` that is re-evaluated on every
 * fetch (including `refresh()`), so switching a tracked path propagates without
 * recreating the resource. `key` should be set when the URL is dynamic so
 * handles co-locate correctly.
 *
 * **`.vsk` TrackDecl is auto-tracked — do not use `get()` / `set()` with `&`:**
 * `const &[docPath] = track('welcome')` → read/write `docPath` directly. `get`/`set`
 * are only for plain `const x = track(0)` outside `&`.
 *
 * Note the two path kinds:
 * - API route param for `useFetch.stream` has **no file extension** — e.g.
 *   `'/api/docs/' + docPath` where `docPath = 'welcome'` (the API handler
 *   decides the file). 
 * - `<Md>` public file path **must have `.md` / `.markdown` + leading `/`** —
 *   e.g. `'/game.md'`, `'/welcome.md'`, `'/docs/guide.md'` under `public/`.
 *   `'/welcome'` or `'game.md'` without `/` render as literal markdown, not a file.
 *
 * @example
 * ```vsk
 * component Docs {
 *   const &[docPath] = track('welcome')   // API param — no .md needed
 *   const &[doc] = track('')
 *   const res = useFetch.stream(() => '/api/docs/' + docPath, { into: doc, key: 'doc' })
 *   // later: docPath = 'guide/getting-started'; res.refresh() // provider re-reads without recreating
 *   <Md content={doc} />
 *
 *   const &[pubPath] = track('/game.md')  // Md public file — needs .md + leading /
 *   <Md content={pubPath} css />
 *   <Md content="/welcome.md" css />
 * }
 * ```
 * @example
 * ```ts
 * // plain JS (no &): use get/set
 * const docPath = track('welcome');
 * const doc = track('');
 * const res = useFetch.stream(() => '/api/docs/' + get(docPath), { into: doc, key: 'doc' });
 * // later: set(docPath, 'guide'); res.refresh();
 * ```
 */
export interface UseFetchStreamOptions extends Omit<UseFetchOptions<string>, 'body'> {
  /** Target cell that receives the cumulative text after each chunk (`set(into, total)`). */
  into?: Tracked<string>;
  /**
   * Per-chunk callback invoked as `(chunk, total)` after each `set(into, total)`.
   * Useful for progress logging or custom chunk handling without adding another effect.
   */
  onChunk?: (chunk: string, total: string) => void;
}

/**
 * Thrown when `fetch` receives a non-2xx response. Mirrors the runtime's
 * `HttpError` in `@vesk/runtime/src/resource.ts`.
 */
export declare class HttpError extends Error {
  /** HTTP status code (e.g. `404`). Alias of `statusCode`. */
  status: number;
  /** HTTP status code — same as `status`. */
  statusCode: number;
  /**
   * @param status - HTTP status code.
   * @param statusText - HTTP status text (e.g. `"Not Found"`).
   */
  constructor(status: number, statusText: string);
}

/**
 * Thrown when a fetch exceeds `UseFetchOptions.timeout`. The underlying
 * `AbortController` is aborted at the same time.
 */
export declare class TimeoutError extends Error {
  /**
   * @param timeout - Configured timeout in ms.
   */
  constructor(timeout: number);
}

/**
 * SSR data sink that the server renderer and the client handoff share.
 * The server writes via `setSsrData` / `setSsrSink`; the client reads via
 * `getSsrData`; `resolveSsrResources` snapshots and clears it.
 */
export interface SsrDataSink {
  /** Persist `value` under `key` (server: `globalThis.__vsk_ssr_data[key] = value`). */
  set(key: string, value: unknown): void;
  /** Read a previously stashed entry, or `undefined` when absent. */
  get(key: string): unknown | undefined;
  /** Shallow copy of the entire sink (what `resolveSsrResources` returns). */
  snapshot(): Record<string, unknown>;
  /** Clear the sink (called after snapshotting). */
  clear(): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Markdown — Md (canonical props for @vesk/runtime/src/md.ts)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Props for `<Md>` (`@vesk/runtime/src/md.ts`). The renderer is
 * tokenizer-based (no regex) and safe-by-default (raw HTML escaped).
 *
 * `content` is polymorphic:
 * - `string` — literal markdown, e.g. `"# Hello"`.
 * - `Tracked<string>` — a reactive cell (compiler emits the cell itself for
 *   `<Md content={live} />`); the component unwraps with `get` and subscribes
 *   via `effect`, so keystrokes re-render live.
 * - `Resource<string>` / `useFetch.stream` handle — unwrapped to its `into`
 *   cell via `streamCellFrom` when present, otherwise to the string itself.
 * - Absolute public path with extension (`"/…/*.md"` or `"/…/*.markdown"`) —
 *   runtime-loaded: server reads through the adapter-installed
 *   `__vsk_md_read_file` hook (constrained to the app's `publicDir` +
 *   `.md`/`.markdown` suffixes, `//`/`?`/`#`/`\` rejected) and stashes the file
 *   in `__vsk_ssr_data` for hydration; client `fetch(path)` with a per-path
 *   cache cell (`mdPathCache`/`mdPathCells`/`mdPathInflight`); while loading or
 *   when the file is missing the path itself is rendered as literal markdown
 *   (so `/missing.md` is visible, never a blank).
 *
 * Public-path examples (note the required `.md` extension):
 * `"/welcome.md"`, `"/notes.md"`, `"/game.md"`, `"/docs/guide.md"` — all
 * resolved under the app's `public/` dir. `"/welcome"` (no extension) or
 * `"welcome.md"` (no leading `/`) are **not** treated as paths and render as
 * literal markdown text.
 *
 * @example
 * ```vsk
 * component Page {
 *   const &[live] = track('# Live')
 *   const &[doc] = track('')
 *   const &[pubPath] = track('/game.md')   // ← public file, needs .md + leading /
 *   // streaming API route (param has no extension — route decides)
 *   const res = useFetch.stream(() => '/api/docs/' + docPath, { into: doc })
 *   <Md content="# Hello" />
 *   <Md content={live} css />
 *   <Md content={doc} css />                // streams chunk-by-chunk
 *   <Md content={pubPath} css />            // loads /public/game.md at runtime
 *   <Md content="/welcome.md" css />        // static public file
 *   <Md content="/missing.md" css />        // not found → renders "/missing.md" literally
 * }
 * ```
 */
export interface MdProps {
  /** Markdown source — plain string, tracked cell, streamed resource, or absolute public path (`/…/*.md`). */
  content?: string | Tracked<string> | Resource<string>;
  /** Default background for all code blocks (CSS color or `'none'`). Fence-level `bg=` wins. */
  codeBg?: string;
  /** Default code text color. Fence-level `fg=` wins. */
  codeFg?: string;
  /** Code theme preset: `'light'` (default) or `'dark'`. Per-fence `bg=`/`fg=` still win. */
  theme?: 'light' | 'dark';
  /** Extra class for the outer `<div class="vesk-md …">` wrapper. */
  class?: string;
  /** Alias of `class`. */
  className?: string;
  /** Inline style for the outer wrapper. */
  style?: string;
  /**
   * Inject `MD_BASE_CSS` (`true`), a custom stylesheet string, or nothing
   * (`false`/default). The CSS is emitted as `<style data-vesk-md-css>` before
   * the rendered HTML and covers code chrome, tables, task lists, anchors, etc.
   */
  css?: boolean | string;
  /** Per-line spans for CSS-counter line numbers in code chrome. Default `false`. */
  lineNumbers?: boolean;
  /** Copy buttons on code blocks (client-wired when hydrated). Default `true`. */
  copy?: boolean;
  /** Syntax-highlight code blocks. Default `true`. */
  highlight?: boolean;
  /** Emit `id` anchors on headings (slugified). Default `true`. */
  ids?: boolean;
  /** Autolink bare URLs / emails and `<https://…>` angle links. Default `true`. */
  autolink?: boolean;
  /** Render single line breaks as `<br>` (GFM hard breaks). Default `false`. */
  hardBreaks?: boolean;
  /** Per-instance raw-HTML policy — overrides the global `md.html` config. */
  html?: MdHtmlMode | string;
  /** Per-instance tag allowlist — overrides the global `md.allowTags` config. */
  allowTags?: string[];
  [k: string]: unknown;
}

/**
 * Options for `renderMarkdown(md, opts?)` / `renderMarkdownEx`.
 * Mirrors the global `MdConfig` plus per-render toggles.
 */
export interface MarkdownOptions {
  /** Raw-HTML policy. Default `'escape'` (every HTML-ish construct as visible text). */
  html?: MdHtmlMode;
  /** Tag allowlist for `html: 'allowlist'`. Lowercased during validation. */
  allowTags?: string[];
  /** Autolink bare URLs / emails. Default `true`. */
  autolink?: boolean;
  /** Emit heading `id` anchors. Default `true`. */
  ids?: boolean;
  /** Syntax-highlight fenced code. Default `true`. */
  highlight?: boolean;
  /** GFM hard breaks. Default `false`. */
  hardBreaks?: boolean;
}

/**
 * One passthrough warning produced when `html` is `'allow'` / `'allowlist'`
 * and a raw tag was emitted. Collected per-render and drained via
 * `drainMdHtmlWarnings()` (printed once per `vesk build`) and surfaced by
 * the LSP (`vesk-md-html` diagnostics + hover).
 */
export interface MdHtmlWarning {
  /** Lowercased tag name that passed through (e.g. `"div"`). */
  tag: string;
  /** Up-to-60-char sample of the raw source that was emitted. */
  sample: string;
}
