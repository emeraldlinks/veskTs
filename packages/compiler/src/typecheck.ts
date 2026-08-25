import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { parse } from '@vesk/compiler/src/parser';
import { vskToTsx, generateVskDts } from '@vesk/compiler/src/vsk-tsx';

export interface TypecheckOptions {
  strict?: boolean;
  appDir?: string;
}

export interface TypecheckError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

const SKIP_DIRS = new Set(['node_modules', '.vesk', '.git', 'dist', 'tarballs', '.next']);
const SKIP_FILES = new Set(['__vesk_ambient.d.ts', '__vesk_runtime_override.d.ts']);

export const AMBIENT = `
declare namespace JSX {
  type VeskEventHandler<E extends Event = Event> = (event: E) => void;
  interface VeskCommonAttributes {
    key?: string | number;
    class?: string;
    id?: string;
    style?: string;
    title?: string;
    hidden?: boolean | string;
    lang?: string;
    dir?: 'ltr' | 'rtl' | 'auto';
    tabIndex?: number;
    role?: string;
  }
  interface VeskEventAttributes {
    onClick?: VeskEventHandler<MouseEvent>;
    onDblClick?: VeskEventHandler<MouseEvent>;
    onMouseDown?: VeskEventHandler<MouseEvent>;
    onMouseUp?: VeskEventHandler<MouseEvent>;
    onMouseEnter?: VeskEventHandler<MouseEvent>;
    onMouseLeave?: VeskEventHandler<MouseEvent>;
    onMouseMove?: VeskEventHandler<MouseEvent>;
    onKeyDown?: VeskEventHandler<KeyboardEvent>;
    onKeyUp?: VeskEventHandler<KeyboardEvent>;
    onFocus?: VeskEventHandler<FocusEvent>;
    onBlur?: VeskEventHandler<FocusEvent>;
    onInput?: VeskEventHandler<InputEvent>;
    onChange?: VeskEventHandler<Event>;
    onSubmit?: VeskEventHandler<SubmitEvent>;
    onScroll?: VeskEventHandler<UIEvent>;
    onWheel?: VeskEventHandler<WheelEvent>;
    // Lowercase aliases — HTML attribute names are case-insensitive and real
    // code writes onclick=/oninput=. Keep in sync with the camelCase members.
    onclick?: VeskEventHandler<MouseEvent>;
    ondblclick?: VeskEventHandler<MouseEvent>;
    onmousedown?: VeskEventHandler<MouseEvent>;
    onmouseup?: VeskEventHandler<MouseEvent>;
    onmouseenter?: VeskEventHandler<MouseEvent>;
    onmouseleave?: VeskEventHandler<MouseEvent>;
    onmousemove?: VeskEventHandler<MouseEvent>;
    onkeydown?: VeskEventHandler<KeyboardEvent>;
    onkeyup?: VeskEventHandler<KeyboardEvent>;
    onfocus?: VeskEventHandler<FocusEvent>;
    onblur?: VeskEventHandler<FocusEvent>;
    oninput?: VeskEventHandler<InputEvent>;
    onchange?: VeskEventHandler<Event>;
    onsubmit?: VeskEventHandler<SubmitEvent>;
  }
  interface VeskGlobalAttributes extends VeskCommonAttributes, VeskEventAttributes {
    children?: unknown;
  }
  interface VeskAnchorAttributes extends VeskGlobalAttributes {
    href?: string;
    target?: string;
    rel?: string;
    download?: string | boolean;
    type?: string;
    hreflang?: string;
  }
  interface VeskMediaAttributes extends VeskGlobalAttributes {
    src?: string;
    width?: string | number;
    height?: string | number;
  }
  interface VeskInputAttributes extends VeskGlobalAttributes {
    type?: string;
    name?: string;
    value?: string | number | readonly string[];
    placeholder?: string;
    checked?: boolean | string;
    disabled?: boolean | string;
    readOnly?: boolean | string;
    required?: boolean | string;
    min?: string | number;
    max?: string | number;
    step?: string | number;
    pattern?: string;
    autoComplete?: string;
    autoFocus?: boolean | string;
    multiple?: boolean | string;
    accept?: string;
    size?: number;
    list?: string;
  }
  interface IntrinsicElements {
    html?: VeskGlobalAttributes & { manifest?: string };
    head?: VeskGlobalAttributes;
    body?: VeskGlobalAttributes;
    div?: VeskGlobalAttributes;
    span?: VeskGlobalAttributes;
    p?: VeskGlobalAttributes;
    h1?: VeskGlobalAttributes;
    h2?: VeskGlobalAttributes;
    h3?: VeskGlobalAttributes;
    h4?: VeskGlobalAttributes;
    h5?: VeskGlobalAttributes;
    h6?: VeskGlobalAttributes;
    a?: VeskAnchorAttributes;
    nav?: VeskGlobalAttributes;
    header?: VeskGlobalAttributes;
    footer?: VeskGlobalAttributes;
    main?: VeskGlobalAttributes;
    section?: VeskGlobalAttributes;
    article?: VeskGlobalAttributes;
    aside?: VeskGlobalAttributes;
    button?: VeskGlobalAttributes & {
      type?: 'button' | 'submit' | 'reset';
      disabled?: boolean | string;
      name?: string;
      value?: string | number;
    };
    form?: VeskGlobalAttributes & {
      action?: string;
      method?: 'get' | 'post';
      target?: string;
      encType?: string;
      noValidate?: boolean | string;
      name?: string;
      autoComplete?: string;
    };
    input?: VeskInputAttributes;
    textarea?: VeskGlobalAttributes & {
      rows?: number;
      cols?: number;
      placeholder?: string;
      value?: string | number;
      disabled?: boolean | string;
      readOnly?: boolean | string;
      required?: boolean | string;
      name?: string;
    };
    select?: VeskGlobalAttributes & {
      name?: string;
      value?: string | number | readonly string[];
      disabled?: boolean | string;
      required?: boolean | string;
      multiple?: boolean | string;
      size?: number;
      autoComplete?: string;
    };
    option?: VeskGlobalAttributes & {
      value?: string | number;
      selected?: boolean | string;
      disabled?: boolean | string;
      label?: string;
    };
    optgroup?: VeskGlobalAttributes & { label?: string; disabled?: boolean | string };
    label?: VeskGlobalAttributes & { htmlFor?: string };
    fieldset?: VeskGlobalAttributes & { disabled?: boolean | string; name?: string; form?: string };
    legend?: VeskGlobalAttributes;
    datalist?: VeskGlobalAttributes;
    img?: VeskGlobalAttributes & {
      src?: string;
      alt?: string;
      width?: string | number;
      height?: string | number;
      srcSet?: string;
      sizes?: string;
      loading?: 'eager' | 'lazy';
      decoding?: 'sync' | 'async' | 'auto';
    };
    picture?: VeskGlobalAttributes;
    source?: VeskGlobalAttributes & { src?: string; srcSet?: string; sizes?: string; media?: string; type?: string };
    video?: VeskMediaAttributes & {
      controls?: boolean | string;
      autoPlay?: boolean | string;
      loop?: boolean | string;
      muted?: boolean | string;
      preload?: 'none' | 'metadata' | 'auto' | '';
      poster?: string;
      playsInline?: boolean | string;
    };
    audio?: VeskGlobalAttributes & {
      src?: string;
      controls?: boolean | string;
      autoPlay?: boolean | string;
      loop?: boolean | string;
      muted?: boolean | string;
      preload?: 'none' | 'metadata' | 'auto' | '';
    };
    track?: VeskGlobalAttributes & {
      src?: string;
      kind?: string;
      srclang?: string;
      label?: string;
      default?: boolean | string;
    };
    canvas?: VeskGlobalAttributes & { width?: number; height?: number };
    iframe?: VeskGlobalAttributes & {
      src?: string;
      srcDoc?: string;
      width?: string | number;
      height?: string | number;
      allow?: string;
      loading?: 'eager' | 'lazy';
      sandbox?: string;
      allowFullScreen?: boolean | string;
      referrerPolicy?: string;
    };
    embed?: VeskGlobalAttributes & { src?: string; type?: string; width?: string | number; height?: string | number };
    object?: VeskGlobalAttributes & { data?: string; type?: string; name?: string; width?: string | number; height?: string | number };
    table?: VeskGlobalAttributes;
    caption?: VeskGlobalAttributes;
    thead?: VeskGlobalAttributes;
    tbody?: VeskGlobalAttributes;
    tfoot?: VeskGlobalAttributes;
    tr?: VeskGlobalAttributes;
    th?: VeskGlobalAttributes & { colSpan?: number; rowSpan?: number; scope?: string; headers?: string };
    td?: VeskGlobalAttributes & { colSpan?: number; rowSpan?: number; headers?: string };
    col?: VeskGlobalAttributes & { span?: number };
    colgroup?: VeskGlobalAttributes & { span?: number };
    ul?: VeskGlobalAttributes;
    ol?: VeskGlobalAttributes & { start?: number; reversed?: boolean | string; type?: string };
    li?: VeskGlobalAttributes & { value?: number };
    dl?: VeskGlobalAttributes;
    dt?: VeskGlobalAttributes;
    dd?: VeskGlobalAttributes;
    br?: VeskGlobalAttributes;
    hr?: VeskGlobalAttributes;
    pre?: VeskGlobalAttributes;
    code?: VeskGlobalAttributes;
    blockquote?: VeskGlobalAttributes & { cite?: string };
    q?: VeskGlobalAttributes & { cite?: string };
    strong?: VeskGlobalAttributes;
    em?: VeskGlobalAttributes;
    small?: VeskGlobalAttributes;
    s?: VeskGlobalAttributes;
    cite?: VeskGlobalAttributes;
    dfn?: VeskGlobalAttributes;
    abbr?: VeskGlobalAttributes & { title?: string };
    time?: VeskGlobalAttributes & { dateTime?: string };
    data?: VeskGlobalAttributes & { value?: string | number };
    mark?: VeskGlobalAttributes;
    del?: VeskGlobalAttributes & { cite?: string; dateTime?: string };
    ins?: VeskGlobalAttributes & { cite?: string; dateTime?: string };
    sub?: VeskGlobalAttributes;
    sup?: VeskGlobalAttributes;
    u?: VeskGlobalAttributes;
    kbd?: VeskGlobalAttributes;
    samp?: VeskGlobalAttributes;
    var?: VeskGlobalAttributes;
    figure?: VeskGlobalAttributes;
    figcaption?: VeskGlobalAttributes;
    details?: VeskGlobalAttributes & { open?: boolean | string };
    summary?: VeskGlobalAttributes;
    dialog?: VeskGlobalAttributes & { open?: boolean | string };
    menu?: VeskGlobalAttributes;
    address?: VeskGlobalAttributes;
    b?: VeskGlobalAttributes;
    i?: VeskGlobalAttributes;
    ruby?: VeskGlobalAttributes;
    rt?: VeskGlobalAttributes;
    rp?: VeskGlobalAttributes;
    bdi?: VeskGlobalAttributes;
    bdo?: VeskGlobalAttributes;
    wbr?: VeskGlobalAttributes;
    area?: VeskGlobalAttributes & {
      coords?: string;
      shape?: string;
      href?: string;
      target?: string;
      alt?: string;
    };
    map?: VeskGlobalAttributes & { name?: string };
    noscript?: VeskGlobalAttributes;
    template?: VeskGlobalAttributes;
    slot?: VeskGlobalAttributes & { name?: string };
    meta?: VeskGlobalAttributes & { name?: string; content?: string; charSet?: string; httpEquiv?: string };
    title?: VeskGlobalAttributes;
    base?: VeskGlobalAttributes & { href?: string; target?: string };
    link?: VeskGlobalAttributes & {
      rel?: string;
      href?: string;
      sizes?: string;
      media?: string;
      as?: string;
      crossOrigin?: string;
      integrity?: string;
      type?: string;
    };
    style?: VeskGlobalAttributes & { media?: string };
    script?: VeskGlobalAttributes & {
      src?: string;
      async?: boolean | string;
      defer?: boolean | string;
      type?: string;
      crossOrigin?: string;
      integrity?: string;
      nonce?: string;
      noModule?: boolean | string;
    };
    svg?: VeskGlobalAttributes & {
      viewBox?: string;
      xmlns?: string;
      width?: string | number;
      height?: string | number;
      fill?: string;
      stroke?: string;
      strokeWidth?: string | number;
    };
    g?: VeskGlobalAttributes & { transform?: string; fill?: string; stroke?: string; strokeWidth?: string | number };
    path?: VeskGlobalAttributes & {
      d?: string;
      fill?: string;
      stroke?: string;
      strokeWidth?: string | number;
      fillRule?: string;
      clipRule?: string;
    };
    circle?: VeskGlobalAttributes & {
      cx?: string | number;
      cy?: string | number;
      r?: string | number;
      fill?: string;
      stroke?: string;
      strokeWidth?: string | number;
    };
    ellipse?: VeskGlobalAttributes & {
      cx?: string | number;
      cy?: string | number;
      rx?: string | number;
      ry?: string | number;
      fill?: string;
    };
    rect?: VeskGlobalAttributes & {
      x?: string | number;
      y?: string | number;
      width?: string | number;
      height?: string | number;
      rx?: string | number;
      ry?: string | number;
      fill?: string;
    };
    line?: VeskGlobalAttributes & {
      x1?: string | number;
      y1?: string | number;
      x2?: string | number;
      y2?: string | number;
      stroke?: string;
      strokeWidth?: string | number;
    };
    polyline?: VeskGlobalAttributes & { points?: string; fill?: string; stroke?: string };
    polygon?: VeskGlobalAttributes & { points?: string; fill?: string; stroke?: string };
    text?: VeskGlobalAttributes & { x?: string | number; y?: string | number; fill?: string; fontSize?: string | number };
    defs?: VeskGlobalAttributes;
    linearGradient?: VeskGlobalAttributes;
    radialGradient?: VeskGlobalAttributes;
    stop?: VeskGlobalAttributes & { offset?: string | number; stopColor?: string; stopOpacity?: string | number };

    // Unknown/custom tags stay permissive — components and web components
    // resolve through the index signature, known tags get the typed members.
    [elemName: string]: unknown;
  }
}
declare const Head: (props: { children?: unknown }) => unknown;
declare class Cell<T> {
  get(): T;
  set(value: T): void;
  peek(): T;
  update(fn: (current: T) => T): boolean;
  unsubscribe(effect: unknown): void;
}
declare function track<T>(initialValue: T): Cell<T>;
declare function derived<T>(fn: () => T): Cell<T>;
declare function effect(fn: () => void): unknown;
declare function untrack<T>(fn: () => T): T;
declare function peek<T>(fn: () => T): T;
declare function tick(): Promise<void>;
declare function flushSync(fn: () => void): void;
declare function on_destroy(fn: () => void): void;
declare function createContext<T>(defaultValue?: T): { id: symbol; defaultValue: T | undefined };
// useFetch returns a THENABLE resource, not the data itself. In async
// components you must \`await\` it before reading/iterating the payload;
// passing \`into: <tracked cell>\` writes the payload into the cell and makes
// awaiting unnecessary (the return value can be ignored).
interface VeskResource<T> {
  loading: boolean;
  error: unknown;
  data: T | undefined;
  refresh(): void;
  abort(): void;
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): PromiseLike<TResult1 | TResult2>;
}
interface VeskUseFetchOptions<T> {
  /** Cache/SSR key — defaults to the URL string. */
  key?: string;
  /** Target tracked cell (from track<T>()) — the payload is written into it, so awaiting is unnecessary. */
  into?: Cell<T>;
  staleTime?: number;
  keepPreviousData?: boolean;
  retry?: number;
  retryDelay?: number;
  timeout?: number;
  enabled?: boolean;
  dedupe?: boolean;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: 'omit' | 'same-origin' | 'include';
  signal?: { readonly aborted: boolean };
}
declare function useFetch<T = unknown>(
  urlOrFn: string | (() => Promise<T>),
  options?: VeskUseFetchOptions<T>,
): VeskResource<T>;
declare function useRouter(): unknown;
declare function useParams(): Record<string, string>;
declare function usePathname(): string;
declare function useSearchParams(): URLSearchParams;
declare function useNavigate(): (to: string) => void;
declare function defineAction(...args: unknown[]): unknown;
declare const Form: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Field: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare function required(...args: unknown[]): unknown;
declare function email(...args: unknown[]): unknown;
declare function minLength(...args: unknown[]): unknown;
declare function maxLength(...args: unknown[]): unknown;
declare function pattern(...args: unknown[]): unknown;
declare function custom(...args: unknown[]): unknown;
declare const Link: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const NavLink: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Outlet: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Image: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Portal: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Experiment: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const JsonLd: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const ArticleSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const ProductSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const FAQPageSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const BreadcrumbListSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const OrganizationSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const LocalBusinessSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const VideoSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare function redirect(...args: unknown[]): unknown;
declare function permanentRedirect(...args: unknown[]): unknown;
declare function notFound(...args: unknown[]): never;
declare class NotFoundError extends Error {}
declare function createResource(...args: unknown[]): unknown;
declare function getAction(...args: unknown[]): unknown;
declare function validateActionInput(...args: unknown[]): unknown;
declare function issuesToFieldMap(...args: unknown[]): unknown;
declare function isFormAction(...args: unknown[]): unknown;
`;

export const RUNTIME_OVERRIDE = `
import '@vesk/runtime';
declare module '@vesk/runtime' {
  export function track<T>(initialValue: T): Cell<T>;
  export function derived<T>(fn: () => T): Cell<T>;
}
`;

function walkProjectFiles(projectRoot: string): { code: string[]; js: string[] } {
  const code: string[] = [];
  const js: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(e)) continue;
        walk(p);
      } else if (e.endsWith('.vsk')) {
        code.push(p);
      } else if (e.endsWith('.ts') || e.endsWith('.tsx')) {
        if (SKIP_FILES.has(e) || e.endsWith('.vsk.d.ts')) continue;
        code.push(p);
      } else if (e.endsWith('.js')) {
        if (e.endsWith('.vsk.js')) continue;
        js.push(p);
      }
    }
  };
  walk(projectRoot);
  return { code, js };
}

function isUnder(dir: string, file: string): boolean {
  const base = resolve(dir);
  const abs = resolve(file);
  return abs === base || abs.startsWith(base + sep);
}

function structureWarning(rel: string, message: string): TypecheckError {
  return { file: rel, line: 1, column: 1, code: 'vesk-structure', message };
}

function checkStructureFile(appDir: string, file: string): TypecheckError | null {
  const rel = relative(appDir, file);
  const parts = rel.split('\\').join('/').split('/');
  const name = parts[parts.length - 1] ?? '';
  const isApi = parts.includes('api');
  if (name === 'middleware.vsk') {
    return structureWarning(
      rel,
      'middleware must live in a TypeScript file and was skipped: rename middleware.vsk to middleware.ts.'
    );
  }
  if (name === 'middleware.js') {
    return structureWarning(
      rel,
      'middleware must live in a TypeScript file: rename middleware.js to middleware.ts.'
    );
  }
  if (isApi && name === 'route.vsk') {
    return structureWarning(
      rel,
      'API routes must live in a TypeScript file and was skipped: rename route.vsk to route.ts.'
    );
  }
  if (isApi && name === 'route.js') {
    return structureWarning(
      rel,
      'API routes must be TypeScript (.ts): convert route.js to route.ts for typed request/response handling. Route was ignored.'
    );
  }
  return null;
}

function createTypecheckHost(projectRoot: string, appDir: string, vskFiles: Map<string, string>): ts.CompilerHost {
  const ambientPath = join(appDir, '__vesk_ambient.d.ts');
  const overridePath = join(appDir, '__vesk_runtime_override.d.ts');
  const cached = new Map<string, ts.SourceFile>();
  const scriptKindFor = (file: string): ts.ScriptKind =>
    file.endsWith('.vsk') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const host: ts.CompilerHost = {
    getSourceFile(file, langVersion, onError, shouldCreateNewSourceFile) {
      if (!shouldCreateNewSourceFile && cached.has(file)) return cached.get(file)!;
      let content: string | undefined;
      if (file === ambientPath) {
        content = AMBIENT;
      } else if (file === overridePath) {
        content = RUNTIME_OVERRIDE;
      } else if (file.endsWith('.vsk.d.ts')) {
        const vskPath = file.slice(0, -'.d.ts'.length);
        const src = vskFiles.get(vskPath) ?? (ts.sys.fileExists(vskPath) ? ts.sys.readFile(vskPath) : undefined);
        content = src !== undefined ? generateVskDts(src) : undefined;
      } else if (file.endsWith('.css.d.ts')) {
        content = '';
      } else if (vskFiles.has(file)) {
        content = vskToTsx(vskFiles.get(file)!);
      } else if (ts.sys.fileExists(file)) {
        content = ts.sys.readFile(file);
      }
      if (content === undefined) {
        if (onError) onError(`File not found: ${file}`);
        return undefined;
      }
      const sf = ts.createSourceFile(file, content, langVersion, true, scriptKindFor(file));
      cached.set(file, sf);
      return sf;
    },
    fileExists(file) {
      if (file === ambientPath) return true;
      if (file === overridePath) return true;
      if (file.endsWith('.vsk.d.ts')) {
        const vskPath = file.slice(0, -'.d.ts'.length);
        return vskFiles.has(vskPath) || ts.sys.fileExists(vskPath);
      }
      if (file.endsWith('.css.d.ts')) return true;
      if (vskFiles.has(file)) return true;
      return ts.sys.fileExists(file);
    },
    readFile(file) {
      if (file === ambientPath) return AMBIENT;
      if (file === overridePath) return RUNTIME_OVERRIDE;
      if (file.endsWith('.vsk.d.ts')) {
        const vskPath = file.slice(0, -'.d.ts'.length);
        const src = vskFiles.get(vskPath) ?? (ts.sys.fileExists(vskPath) ? ts.sys.readFile(vskPath) : undefined);
        return src !== undefined ? generateVskDts(src) : undefined;
      }
      if (file.endsWith('.css.d.ts')) return '';
      if (vskFiles.has(file)) return vskToTsx(vskFiles.get(file)!);
      return ts.sys.readFile(file);
    },
    writeFile: () => {},
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    directoryExists: (dir) => ts.sys.directoryExists(dir),
    getDirectories: (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => join(dir, d.name));
      } catch {
        return [];
      }
    },
    getCanonicalFileName: (f) => normalize(f),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n',
    resolveModuleNameLiterals(moduleLiterals, containingFile, redirectedReference, options) {
      return moduleLiterals.map(({ text }) => {
        if (text.endsWith('.vsk')) {
          const abs = normalize(join(dirname(containingFile), text));
          return {
            resolvedModule: {
              resolvedFileName: abs + '.d.ts',
              extension: ts.Extension.Dts,
              isExternalLibraryImport: false,
            },
            failedLookupLocations: [],
          };
        }
        if (text.endsWith('.css')) {
          const abs = normalize(join(dirname(containingFile), text));
          return {
            resolvedModule: {
              resolvedFileName: abs + '.d.ts',
              extension: ts.Extension.Dts,
              isExternalLibraryImport: false,
            },
            failedLookupLocations: [],
          };
        }
        const res = ts.resolveModuleName(text, containingFile, options, host);
        return { resolvedModule: res.resolvedModule, failedLookupLocations: [] };
      });
    },
  };
  return host;
}

export interface TypecheckResult {
  errors: TypecheckError[];
  warnings: TypecheckError[];
}

export function typecheckProject(projectRoot: string, opts: TypecheckOptions = {}): TypecheckResult {
  const appDir = opts.appDir ?? join(projectRoot, 'app');
  const vskFiles = new Map<string, string>();
  const parseErrors: TypecheckError[] = [];
  const warnings: TypecheckError[] = [];
  const walked = walkProjectFiles(projectRoot);
  const rootNames: string[] = [];
  for (const f of walked.js) {
    if (!isUnder(appDir, f)) continue;
    const warn = checkStructureFile(appDir, f);
    if (warn) warnings.push(warn);
  }
  for (const f of walked.code) {
    if (isUnder(appDir, f)) {
      const warn = checkStructureFile(appDir, f);
      if (warn) {
        warnings.push(warn);
        continue;
      }
    }
    if (f.endsWith('.vsk')) {
      const src = readFileSync(f, 'utf-8');
      try {
        parse(src);
      } catch (e) {
        parseErrors.push({
          file: relative(projectRoot, f),
          line: 1,
          column: 1,
          code: 'vesk-parse',
          message: `could not parse .vsk file: ${(e as Error).message}`,
        });
        continue;
      }
      vskFiles.set(f, src);
    }
    rootNames.push(f);
  }

  const ambientPath = join(appDir, '__vesk_ambient.d.ts');
  const overridePath = join(appDir, '__vesk_runtime_override.d.ts');
  rootNames.push(ambientPath);
  rootNames.push(overridePath);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: opts.strict !== false,
    jsx: ts.JsxEmit.Preserve,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    allowImportingTsExtensions: true,
    allowNonTsExtensions: true,
    resolveJsonModule: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
    allowJs: false,
  };

  const host = createTypecheckHost(projectRoot, appDir, vskFiles);
  const program = ts.createProgram({ rootNames, options, host });

  const rootSet = new Set(rootNames.map(normalize));
  const vskSet = new Set<string>();
  for (const p of vskFiles.keys()) vskSet.add(normalize(p));

  const errors: TypecheckError[] = [...parseErrors];
  for (const diag of ts.getPreEmitDiagnostics(program)) {
    const file = diag.file;
    if (!file) continue;
    let filePath = normalize(file.fileName);
    if (filePath.endsWith('.vsk.d.ts')) {
      filePath = filePath.slice(0, -'.d.ts'.length);
    }
    if (!rootSet.has(filePath) && !vskSet.has(filePath)) continue;
    const pos = file.getLineAndCharacterOfPosition(diag.start ?? 0);
    const code = typeof diag.code === 'number' ? `TS${diag.code}` : String(diag.code);
    errors.push({
      file: relative(projectRoot, filePath),
      line: pos.line + 1,
      column: pos.character + 1,
      code,
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
    });
  }

  return { errors, warnings };
}

export function formatTypecheckErrors(errors: TypecheckError[]): string {
  return errors
    .map((e) => `${e.file}(${e.line},${e.column}): ${e.code}: ${e.message}`)
    .join('\n');
}

export function formatTypecheckWarnings(warnings: TypecheckError[]): string {
  return warnings
    .map((w) => `${w.file}: ${w.code}: ${w.message}`)
    .join('\n');
}
