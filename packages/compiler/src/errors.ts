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
  const lineMatch = message.match(/(?:line|at\s+line)\s*(\d+)/i);
  const colMatch = message.match(/(?:column|col)\s*(\d+)/i);
  return {
    line: lineMatch ? parseInt(lineMatch[1]) : 0,
    column: colMatch ? parseInt(colMatch[1]) : 0,
  };
}

export interface VeskErrorOptions {
  file?: string;
  line?: number;
  column?: number;
  suggestions?: string[];
  nextSteps?: string[];
  tip?: string;
  code?: string;
  [key: string]: unknown;
}

const VESK_BUILTINS = [
  'useFetch', 'useRouter', 'useParams', 'usePathname', 'useSearchParams',
  'useNavigate', 'useHead', 'useTitle',
  'Form', 'Field', 'Link', 'NavLink', 'Outlet',
  'Image', 'Portal',
  'Experiment',
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
  code?: string;

  constructor(message: string, opts: VeskErrorOptions = {}) {
    super(message);
    this.name = 'VeskError';
    this.file = opts.file || '';
    this.line = opts.line || 0;
    this.column = opts.column || 0;
    this.suggestions = opts.suggestions || [];
    this.nextSteps = opts.nextSteps || [];
    this.tip = opts.tip || '';
    if (opts.code !== undefined) this.code = opts.code;
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
      suggestions: [name, ...allCandidates.slice(0, 8)],
      nextSteps,
      tip: isBuiltin
        ? `"${name}" is a Vesk built-in. Use it directly — no manual import needed.`
        : '',
    });
  }

  static classDecl(context: VeskErrorOptions = {}): VeskError {
    return new VeskError(
      'class declarations are not supported inside Vesk components.',
      {
        ...context,
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

  static serverBlockInClient(compName: string, context: VeskErrorOptions = {}): VeskError {
    return new VeskError(
      `{#server} block found in client island "${compName}". Client islands render on both server and client, so {#server} blocks have no effect.`,
      {
        ...context,
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
      suggestions: validOptions.length ? [`Valid options: ${validOptions.join(', ')}`] : [],
      nextSteps: [
        'Check your vesk.config file for typos.',
        ...(validOptions.length ? [`Use one of: ${validOptions.join(', ')}`] : []),
      ],
    });
  }

  toString(): string {
    let out = `[vesk] ${this.message}`;
    if (this.file) out += `\n  File: ${this.file}${this.line ? `:${this.line}` : ''}`;
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
