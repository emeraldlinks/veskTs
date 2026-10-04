export function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= bn; i++) matrix[i] = [i];
  for (let j = 0; j <= an; j++) matrix[0][j] = j;
  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[bn][an];
}

export function didYouMean(name: string, candidates: string[], maxDistance: number = 3): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = levenshtein(name.toLowerCase(), c.toLowerCase());
    if (dist < bestDist && dist <= maxDistance) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

function extractLineColumn(message: string): { line: number; column: number } {
  return {
    line: findKeywordNumber(message, ['at line', 'line']),
    column: findKeywordNumber(message, ['column', 'col']),
  };
}

/**
 * Finds `<keyword><whitespace>*<digits>` in `message`, trying longer keyword
 * variants first so 'column' is not matched as 'col' + 'umn'. Char-scan only.
 */
function findKeywordNumber(message: string, keywords: string[]): number {
  const lower = message.toLowerCase();
  for (const kw of keywords) {
    let from = 0;
    while (from <= lower.length - kw.length) {
      const idx = lower.indexOf(kw, from);
      if (idx === -1) break;
      // word boundary before the keyword
      const before = idx > 0 ? lower[idx - 1] : ' ';
      if (!(before >= 'a' && before <= 'z')) {
        let j = idx + kw.length;
        while (j < message.length && (message[j] === ' ' || message[j] === '\t')) j++;
        if (message[j] >= '0' && message[j] <= '9') {
          let end = j;
          while (end < message.length && message[end] >= '0' && message[end] <= '9') end++;
          return parseInt(message.slice(j, end));
        }
      }
      from = idx + 1;
    }
  }
  return 0;
}

export function codeFrame(source: string, line: number, column: number, before = 5, after = 5): string {
  if (line <= 0) return '';
  const lines = source.split('\n');
  const start = Math.max(1, line - before);
  const end = Math.min(lines.length, line + after);
  const width = String(end).length;
  let out = '';
  for (let i = start; i <= end; i++) {
    const text = lines[i - 1] ?? '';
    const ln = String(i).padStart(width, ' ');
    out += `${ln} | ${text}\n`;
    if (i === line) {
      const pointerCol = Math.max(0, column - 1);
      const prefix = ' '.repeat(width) + ' | ';
      out += prefix + ' '.repeat(pointerCol) + '^\n';
    }
  }
  return out.trimEnd();
}

export interface VeskErrorOptions {
  file?: string;
  line?: number;
  column?: number;
  suggestions?: string[];
  nextSteps?: string[];
  tip?: string;
  code?: string;
  /** Rendered code frame (see `codeFrame`). Never a V-code. */
  frame?: string;
  [key: string]: unknown;
}

const VESK_BUILTINS = [
  'useFetch', 'useRouter', 'useParams', 'usePathname', 'useSearchParams',
  'useNavigate', 'useHead', 'useTitle',
  'Form', 'Field', 'Link', 'NavLink', 'Outlet',
  'Image', 'Portal',
  'Experiment',
  'LoadingIndicator', 'useLoadingIndicator',
  'required', 'email', 'minLength', 'maxLength', 'pattern', 'custom',
  'track', 'get', 'set', 'derived', 'effect', 'batch', 'untrack',
  'cookies', 'headers', 'locals',
  'VeskResponse', 'VeskRequest', 'ServerRequest', 'ServerResponse',
  'redirect', 'permanentRedirect', 'notFound',
];

export class VeskError extends Error {
  name: string;
  file: string;
  line: number;
  column: number;
  suggestions: string[];
  nextSteps: string[];
  tip: string;
  /** The V-diagnostic code, e.g. `V0501`. */
  code?: string;
  /** The rendered code frame. Used to be written into `code`, which silently replaced the V-code. */
  frame?: string;

  constructor(message: string, opts: VeskErrorOptions = {}) {
    super(message);
    this.name = 'VeskError';
    this.file = opts.file || '';
    this.line = opts.line || 0;
    this.column = opts.column || 0;
    this.suggestions = opts.suggestions || [];
    this.nextSteps = opts.nextSteps || [];
    this.tip = opts.tip || '';
    // The diagnostic code owns `code`. The code frame used to be written there
    // too, which silently replaced `V0501` with a wall of source text — the
    // report lost the one thing that identifies it.
    if (opts.code !== undefined && !opts.code.includes('\n')) this.code = opts.code;
    if (opts.frame !== undefined) this.frame = opts.frame;
  }

  static notFound(name: string, candidates: string[] = [], context: VeskErrorOptions = {}): VeskError {
    const allCandidates = [...new Set([...candidates, ...VESK_BUILTINS])];
    const suggestion = didYouMean(name, allCandidates);
    const isBuiltin = VESK_BUILTINS.includes(name);
    const msg = suggestion
      ? `"${name}" is not defined. Did you mean "${suggestion}"?`
      : `"${name}" is not defined.`;
    const nextSteps: string[] = [];
    if (suggestion && suggestion !== name) {
      nextSteps.push(`Replace "${name}" with "${suggestion}".`);
    }
    if (isBuiltin) {
      nextSteps.push(`"${name}" is a Vesk built-in — it is auto-imported when you use it as a component tag (<${name}>) or call it as a function (${name}()). If you are using it in an unusual way, add an explicit import: import { ${name} } from "@vesk/runtime".`);
    } else {
      nextSteps.push('Check that the name is spelled correctly, imported, or declared in this file.');
      if (suggestion && suggestion !== name) {
        nextSteps.push(`If you meant "${suggestion}", fix the spelling.`);
      }
    }
    return new VeskError(msg, {
      ...context,
      code: context.code || 'V0401',
      suggestions: [name, ...allCandidates.slice(0, 8)],
      nextSteps,
      tip: isBuiltin
        ? `"${name}" is a Vesk built-in. Use it directly — no manual import needed.`
        : '',
    });
  }

  /**
   * A `.vsk` namespace is resolved at the JSX-tag level: `<ns.Icon />` looks
   * the component up in the registry by its exported name, exactly like
   * `import { Icon }`, and no module object is ever built. The two forms that
   * genuinely need a real module object are reported here.
   *
   * - `nested` — `<ns.Sub.Icon />`. A `.vsk` module's exports are flat
   *   component names, so there is no object to walk into.
   * - `value` — `ns.max` read as a value. Component tags resolve; plain value
   *   reads do not, because nothing binds `ns` at runtime.
   */
  /**
   * An imported `.ts`/`.js` module could not be parsed.
   *
   * This used to be silent, and that is the whole point of the diagnostic. A
   * parse failure meant the module's RAW, untranspiled source was substituted,
   * so TypeScript syntax reached `new Function` and the module blew up much
   * later with a bare `Unexpected token ':'` — attributed to no file, at a
   * point in the build far from the code that caused it. It also poisoned the
   * whole shared module graph: one unparseable module left its exports
   * undefined, so unrelated consumers failed with `X is not iterable`.
   *
   * Two real constructs hit this: a parameter annotation that survived the
   * stripper only when the parameter also had a default value, and a generic
   * arrow's type parameter list, which the JSX tokenizer cannot read at all.
   * Both are fixed; this error exists so the NEXT such gap is reported at the
   * right file with the right line instead of surfacing three modules later.
   */
  static moduleParseFailed(context: VeskErrorOptions & { reason?: string } = {}): VeskError {
    return new VeskError(
      `Could not parse an imported module${context.reason ? `: ${context.reason}` : '.'}`,
      {
        ...context,
        code: context.code || 'V0901',
        suggestions: [
          'Check the line the ^ marker points at — it is the construct the parser stopped on.',
          'If it is TypeScript syntax the stripper does not handle, simplifying it here fixes every module that imports this file.',
          'This is a bug in the compiler, not in your code, if the construct is ordinary TypeScript — please report it with the source line.',
        ],
        nextSteps: [
          'A module that fails to parse is substituted with its raw source, so every type annotation it contains becomes a runtime SyntaxError.',
          'The failure is reported here, at the offending file and line, rather than as an `Unexpected token` in whichever module happened to import it.',
        ],
        tip: 'Ordinary TypeScript should parse; if this fires on valid TS, the parser is missing a construct.',
      },
    );
  }

  static vskNamespaceMember(context: VeskErrorOptions & { form?: 'nested' | 'value' } = {}): VeskError {
    const nested = context.form === 'nested';
    return new VeskError(
      nested
        ? 'A `.vsk` namespace is flat, so `<ns.Sub.Icon />` cannot be resolved.'
        : 'A `.vsk` namespace resolves component tags only, so `ns.value` is not available.',
      {
        ...context,
        code: context.code || 'V0410',
        suggestions: nested
          ? [
            "Import the component by name: import { Icon } from './icons.vsk'",
            "Import from the module that owns Sub: import * as Sub from './sub.vsk'",
          ]
          : [
            "Import the value by name: import { MAX } from './constants.vsk'",
            'Move the value into a .ts module and import it from there — those are real ES modules with live bindings.',
          ],
        nextSteps: [
          'A `.vsk` tag resolves by component name in the global registry, not by module exports, so `import * as ns` + `<ns.Icon />` needs no module object.',
          nested
            ? 'Re-export with a flat name (`export { Icon }`) or import the component directly.'
            : 'Re-export the value under a flat name and import it directly, or keep the value in a .ts module.',
        ],
        tip: '`<ns.Icon />` works; only nested paths and value reads need a real module namespace.',
      },
    );
  }

  static classDecl(context: VeskErrorOptions = {}): VeskError {
    return new VeskError(
      'class declarations are not supported inside Vesk components.',
      {
        ...context,
        code: context.code || 'V0402',
        suggestions: [
          'Use a plain object: const obj = { ... };',
          'Use a factory function: function create() { return { ... }; }',
          'Import from an external module: import { Klass } from "./lib.js";',
        ],
        nextSteps: [
          'Replace the class with a plain object, factory function, or import from a .ts/.js file.',
          'Vesk components compile to reactive blocks — classes cannot participate in signal tracking.',
        ],
        tip: 'Use plain objects for data and factory functions for constructors inside .vsk files.',
      },
    );
  }

  /**
   * A browser-only global used in code the SERVER evaluates.
   *
   * On the server these are either absent (`window is not defined`) or, worse,
   * silently present-but-wrong (`navigator` exists in modern Node, so
   * `navigator.onLine` is `undefined` and a page renders as if it were offline).
   * A raw `ReferenceError` at request time is the worst possible report: it
   * names neither the component nor the fix. This points at the line.
   */
  static ssrUnsafeGlobal(
    name: string,
    context: Partial<VeskErrorOptions> & { inComponent?: string } = {},
  ): VeskError {
    return new VeskError(
      `\`${name}\` is browser-only, and this component body runs during SSR.`,
      {
        ...context,
        code: context.code || 'V0501',
        suggestions: [
          `Wrap the part that needs the DOM in a {#client} block.`,
          `Move the code into an event handler — handlers never run on the server.`,
          `Do the setup in on_destroy(), which the compiler only emits on the client.`,
        ],
        nextSteps: [
          `component ${context.inComponent ?? 'this component'}: wrap the \`${name}\` access in {#client}...{/client}.`,
          `Or guard it: if (typeof ${name} !== 'undefined') { ... }`,
        ],
        tip:
          'SSR renders this component before the client exists. Reading a browser global here either throws during the request or (for `navigator`) silently returns undefined.',
      },
    );
  }

  /**
   * The second name from `track()` called as a function.
   *
   * `const &[count, setCount] = track(0)` returns a CELL, not a setter function, so
   * `setCount(1)` throws `setCount is not a function` from generated code with
   * no line of user code in the message. The cell is the writer: `.set(v)`.
   */
  static cellCalledAsFunction(
    name: string,
    context: Partial<VeskErrorOptions> & { value?: string; cell?: string } = {},
  ): VeskError {
    return new VeskError(
      `\`${name}\` is a cell, not a function — cells are written with \`.set()\`.`,
      {
        ...context,
        code: context.code || 'V0502',
        suggestions: [
          `Use \`${name}.set(...)\` instead of \`${name}(...)\`.`,
          `Or use the tracked spelling inside an event handler: set(${context.value ?? 'value'}, ...)`,
        ],
        nextSteps: [
          `const &[${context.value ?? 'value'}, ${name}] = track(0) → \`${name}.set(v)\``,
          'The value read in markup is the first name; the second is the cell object.',
        ],
        tip: `\`track()\` returns [value, cell]. \`${name}\` is the cell half.`,
      },
    );
  }

  /**
   * `set(value, …)` used outside a rewritten expression.
   *
   * The compiler rewrites `set(count, v)` to `countCell.set(v)` inside JSX and
   * event handlers — but a bare statement in the component body is NOT
   * rewritten, so the runtime `set` receives the value and throws
   * "Cannot read properties of undefined". Pass the CELL, not the value.
   */
  static setWithValueName(
    name: string,
    context: Partial<VeskErrorOptions> & { cell?: string } = {},
  ): VeskError {
    return new VeskError(
      `\`set(${name}, …)\` needs the CELL, and \`${name}\` is the value half of track().`,
      {
        ...context,
        code: context.code || 'V0503',
        suggestions: [
          `Use \`set(${context.cell ?? 'cell'}, …)\` or \`${context.cell ?? 'cell'}.set(…)\`.`,
          `Or move the set() into an event handler, where the compiler rewrites it for you.`,
        ],
        nextSteps: [
          `const &[${name}, ${context.cell ?? 'cell'}] = track(0) → \`${context.cell ?? 'cell'}.set(v)\``,
        ],
        tip: 'set(cell, value) is only rewritten inside JSX and handlers; in a body statement it reaches the runtime untouched.',
      },
    );
  }

  static serverBlockInClient(compName: string, context: VeskErrorOptions = {}): VeskError {
    return new VeskError(
      `{#server} block found in client island "${compName}". Client islands render on both server and client, so {#server} blocks have no effect.`,
      {
        ...context,
        code: context.code || 'V0403',
        suggestions: [
          `Remove the {#server} block from "${compName}".`,
          `Or remove the \`client\` keyword from "${compName}" declaration.`,
        ],
        nextSteps: [
          `Remove {#server}...{/server} from component "${compName}".`,
          `Or change \`component ${compName} client\` to \`component ${compName}\` (no client), then wrap interactive parts in {#client} blocks.`,
        ],
        tip: 'A `client` component renders everywhere — {#server} would never execute. Either drop `client` or drop the {#server} block.',
      },
    );
  }

  static clientBlockInServer(compName: string, context: VeskErrorOptions = {}): VeskError {
    return new VeskError(
      `{#client} block found in component "${compName}", but this component is not a client island. {#client} blocks are only allowed inside components declared with the \`client\` keyword.`,
      {
        ...context,
        code: context.code || 'V0404',
        suggestions: [
          `Add \`client\`: \`component ${compName} client { ... }\``,
          `Or remove the {#client}...{/client} block.`,
        ],
        nextSteps: [
          `Add the \`client\` keyword: \`component ${compName} client { ... }\``,
          `Or remove the {#client} block if the content can be server-rendered.`,
        ],
        tip: '{#client} blocks mark interactive content that needs JavaScript. Without `client`, the component is server-only and {#client} blocks are meaningless.',
      },
    );
  }

  static componentNotFound(name: string, available: string[] = [], context: VeskErrorOptions = {}): VeskError {
    return VeskError.notFound(name, available, {
      ...context,
      tip: `Components in Vesk must be declared with the \`component\` keyword. If "${name}" is defined in another file, import it: \`import { ${name} } from "./path";\``,
    });
  }

  static configError(msg: string, validOptions: string[] = [], context: VeskErrorOptions = {}): VeskError {
    return new VeskError(msg, {
      ...context,
      code: context.code || 'V0405',
      suggestions: validOptions.length ? [`Valid options: ${validOptions.join(', ')}`] : [],
      nextSteps: [
        'Check your vesk.config file for typos.',
        ...(validOptions.length ? [`Use one of: ${validOptions.join(', ')}`] : []),
      ],
    });
  }

  static asyncChildInSyncParent(parentName: string, childName: string, context: VeskErrorOptions = {}): VeskError {
    return new VeskError(
      `Component "${parentName}" renders "<${childName} />", but "<${childName} />" is async and "${parentName}" is not declared async.`,
      {
        ...context,
        code: context.code || 'V0406',
        suggestions: [
          `Declare the parent async: \`async component ${parentName} ...\``,
        ],
        nextSteps: [
          `Change \`component ${parentName} ...\` to \`async component ${parentName} ...\`.`,
          `Every component that renders "<${childName} />" (directly or transitively) must itself be \`async component\`.`,
          `Layouts are exempt — a layout that renders {props.children} does not need \`async\`.`,
        ],
        tip: `A component that renders an async component must itself be async so the renderer can await it before serializing the HTML. Async components also include components that call \`useFetch\`.`,
      },
    );
  }

  static attrJsxElement(context: VeskErrorOptions & { attr?: string } = {}): VeskError {
    return new VeskError(
      `Attribute "${context.attr ?? ''}" on an HTML element is given a JSX element value. DOM attributes hold plain values — JSX elements belong to content or to a component prop (where they become a content slot).`,
      {
        ...context,
        code: context.code || 'V0407',
        suggestions: [
          'Pass the element as a child instead: <div>{ <yourElement /> }</div>',
          'If the component accepts it, pass the element as a component prop instead of an HTML attribute.',
        ],
        nextSteps: [
          'Move the JSX element into the element\'s content so it renders as a child node.',
          'Component props can hold JSX elements — they are threaded as content slots and read back with {props.<name>}.',
        ],
        tip: 'JSX elements are content. They render inside an element or travel as a component prop — never as an attribute value on an HTML tag.',
      },
    );
  }

  toString(): string {
    let out = this.code ? `[vesk ${this.code}] ${this.message}` : `[vesk] ${this.message}`;
    if (this.file) {
      out += `\n  File: ${this.file}`;
      if (this.line) {
        out += `:${this.line}`;
        if (this.column) out += `:${this.column}`;
      }
      if (this.line && this.column) out += ` (line ${this.line}, column ${this.column})`;
      else if (this.line) out += ` (line ${this.line})`;
    } else if (this.line) {
      out += `\n  at line ${this.line}${this.column ? `, column ${this.column}` : ''}`;
    }
    if (this.code) out += `\n\n${this.code}`;
    if (this.suggestions.length) {
      out += '\n\n  Suggestions:';
      for (const s of this.suggestions.slice(0, 4)) out += `\n    • ${s}`;
    }
    if (this.nextSteps.length) {
      out += '\n\n  Next steps:';
      for (const s of this.nextSteps.slice(0, 4)) out += `\n    • ${s}`;
    }
    if (this.tip) out += `\n\n  Tip: ${this.tip}`;
    return out;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      file: this.file,
      line: this.line,
      column: this.column,
      code: this.code,
      suggestions: this.suggestions,
      nextSteps: this.nextSteps,
      tip: this.tip,
      stack: this.stack,
    };
  }
}
