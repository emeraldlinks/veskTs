export interface ErrorTips {
  tips: string[];
  suggestions: string[];
  nextSteps: string[];
}

const RUNTIME_AUTOIMPORTS =
  'effect, derived, untrack, peek, tick, flushSync, on_destroy, createContext';

interface Rule {
  match: (message: string) => boolean;
  build: (message: string) => ErrorTips;
}

const SYNTAX_KINDS = ['Unexpected token', 'Parse error', 'SyntaxError'];
const MODULE_KINDS = ['Cannot find module', 'Cannot load module', 'Module not found'];
const NULL_DEREF_KINDS = ['Cannot read properties of', 'Cannot read property'];

const rules: Rule[] = [
  {
    match: (m) => m.includes('is not defined'),
    build: () => ({
      tips: [
        'The name was referenced before it was imported or declared in this file, so the compiler treated it as undeclared.',
      ],
      suggestions: [
        `Vesk auto-imports the reactive helpers from @vesk/runtime (${RUNTIME_AUTOIMPORTS}); note that \`batch\` does NOT exist — never import it.`,
      ],
      nextSteps: [
        'Check the spelling, add an explicit import for the name, or declare it as a binding before use.',
      ],
    }),
  },
  {
    match: (m) => SYNTAX_KINDS.some((k) => m.includes(k)),
    build: () => ({
      tips: ['The parser hit a token it could not place in the current context.'],
      suggestions: [
        'Statement mode accepts bare JSX plus if/for/while/switch/try — no return statement needed; expression mode requires `return <jsx>;`.',
      ],
      nextSteps: [
        'Check the line under the ^ marker for missing brackets, quotes, or unclosed JSX tags, then fix and re-save.',
      ],
    }),
  },
  {
    match: (m) => MODULE_KINDS.some((k) => m.includes(k)),
    build: () => ({
      tips: ['An import path could not be resolved from this file.'],
      suggestions: ['Check the specifier spelling and the relative path (./ vs ../) in the import statement.'],
      nextSteps: [
        'Install the missing dependency or create the file at the expected path, then restart the dev server.',
      ],
    }),
  },
  {
    match: (m) => m.toLowerCase().includes('unterminated'),
    build: () => ({
      tips: ['A string or template literal was opened earlier in the file and never closed.'],
      suggestions: ['Look for a missing closing quote or backtick on the line just above the marker.'],
      nextSteps: [
        'Close the literal; to span lines, open it with a backtick and use ${expr} for interpolation.',
      ],
    }),
  },
  {
    match: (m) => m.includes('is not a function') || m.includes('undefined is not'),
    build: () => ({
      tips: ['The value being called is not callable — often undefined, null, or the wrong import.'],
      suggestions: ['Check that you imported the function itself and used the correct export name.'],
      nextSteps: [
        'Guard the call (typeof x === \'function\' && x()) or trace where the value is assigned before invoking it.',
      ],
    }),
  },
  {
    match: (m) => NULL_DEREF_KINDS.some((k) => m.includes(k)) || m.includes(' of null') || m.includes(' of undefined'),
    build: () => ({
      tips: ['A property was read on null or undefined at the marked line.'],
      suggestions: ['Guard the access with optional chaining (obj?.prop) or a default value (const x = data ?? {}).'],
      nextSteps: [
        'Trace where the value is set — async data may not have arrived when the component first renders.',
      ],
    }),
  },
];

const FALLBACK: ErrorTips = {
  tips: ['The compiler reported an error in this file but no rule matched its message text.'],
  suggestions: [
    'Verify imports and that every referenced name is declared — and check the body in both statement mode (bare JSX, if/for/while/switch/try) and expression mode (return <jsx>).',
  ],
  nextSteps: [
    'Look for a fuller error message printed above this one.',
    'Restart the dev server if the error persists after the fix.',
  ],
};

export function suggestFor(message: string): ErrorTips {
  if (typeof message !== 'string') return FALLBACK;
  for (const rule of rules) {
    if (rule.match(message)) return rule.build(message);
  }
  return FALLBACK;
}