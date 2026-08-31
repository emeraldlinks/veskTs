import { buildCodeframe, parseCompilerError } from './error-codeframe';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

console.log('\n\u2550\u2550\u2550 Vesk error-codeframe tests \u2550\u2550\u2550\n');

const src = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');

// --- buildCodeframe: default 5-above / 5-below window ---
const mid = buildCodeframe(src, 10, 3);
assert(mid !== null, 'buildCodeframe returns a codeframe for a mid-file error line');
assert(mid && mid.code.length === 11, 'default context window is 5 above + 1 + 5 below = 11 lines');
assert(mid && mid.code[0].no === 5 && mid.code[10].no === 15, 'window spans lines 5..15');
assert(
  mid && mid.code.filter((l) => l.isError).map((l) => l.no).join(',') === '10',
  'exactly one line is marked isError and it is the error line'
);
assert(mid && mid.code[4].isError === false && mid.code[6].isError === false, 'adjacent lines are not marked isError');
assert(mid && mid.code[5].text === 'line10', 'code line text matches source line content');
assert(mid && mid.column === 3, 'column is preserved as given (1-based)');
assert(mid && buildCodeframe(src, 10)!.column === 1, 'column defaults to 1');
assert(mid && mid.file === '', 'file defaults to empty string');

// --- clamping near the top and bottom of the file ---
const top = buildCodeframe(src, 2);
assert(top !== null && top.code.length === 7 && top.code[0].no === 1, 'near top: window clamps start to line 1 (1..7)');
const first = buildCodeframe(src, 1);
assert(first !== null && first.code.length === 6 && first.code[0].no === 1, 'error on line 1 includes lines 1..6 only');
const bottom = buildCodeframe(src, 19);
assert(bottom !== null && bottom.code.length === 7 && bottom.code[6].no === 20, 'near bottom: window clamps end to line 20 (14..20)');
const last = buildCodeframe(src, 20);
assert(last !== null && last.code.length === 6 && last.code[5].no === 20, 'error on last line includes lines 15..20 only');

// --- custom context size ---
const small = buildCodeframe(src, 10, undefined, 2);
assert(small !== null && small.code.length === 5 && small.code[0].no === 8 && small.code[4].no === 12, 'context=2 yields a 5-line window');
const huge = buildCodeframe(src, 10, undefined, 20);
assert(huge !== null && huge.code.length === 20 && huge.code[0].no === 1 && huge.code[19].no === 20, 'context larger than the file clamps to full file');

// --- invalid input returns null ---
assert(buildCodeframe('', 1) === null, 'empty source returns null');
assert(buildCodeframe(src, 0) === null, 'line 0 returns null');
assert(buildCodeframe(src, -1) === null, 'negative line returns null');
assert(buildCodeframe(src, 21) === null, 'line beyond the last source line returns null');
assert(buildCodeframe(src, 10.5) === null, 'non-integer line returns null');

// --- parseCompilerError: object with .loc (column 0-based -> 1-based) ---
const locErr = parseCompilerError({ loc: { line: 3, column: 7 }, message: 'boom' }, 'page.vsk', src);
assert(locErr !== null, 'loc-bearing error parses to an ErroredLocation');
assert(locErr && locErr.message === 'boom', 'loc-bearing error: message is preserved');
assert(locErr && locErr.file === 'page.vsk', 'loc-bearing error: file is used');
assert(locErr && locErr.line === 3, 'loc-bearing error: line is taken from loc.line');
assert(locErr && locErr.column === 8, 'loc-bearing error: 0-based loc.column converts to 1-based');
assert(locErr && locErr.stack === null, 'loc-bearing error: stack is null when absent');
assert(locErr && locErr.codeframe !== null, 'loc-bearing error with src attaches a codeframe');
assert(locErr && locErr.codeframe!.line === 3, 'codeframe centers on the error line');
assert(locErr && locErr.codeframe!.code.some((l) => l.isError && l.text === 'line3'), 'codeframe marks the error line with its source text');

// --- parseCompilerError: .position shape (raw parser position, column 0-based) ---
const posErr = parseCompilerError({ position: { line: 2, column: 0 }, message: 'x' }, 'f.vsk');
assert(posErr !== null && posErr.line === 2 && posErr.column === 1, 'position object provides line/column (0-based column -> 1-based)');
assert(posErr && posErr.codeframe === null, 'no source given: codeframe stays null');

// --- parseCompilerError: VeskError-like top-level .line/.column (already 1-based) ---
const veskLike = parseCompilerError({ message: 'nope', line: 4, column: 2 }, 'f.vsk', src);
assert(veskLike !== null && veskLike.line === 4 && veskLike.column === 2, 'VeskError-like .line/.column are taken as-is (1-based)');
assert(veskLike && veskLike.stack === null, 'stack is null when absent');

// --- parseCompilerError: embedded "(line:column)" in message text (0-based column) ---
const embedded = parseCompilerError({ message: 'Unexpected token (12:5)' }, 'f.vsk', src);
assert(embedded !== null && embedded.line === 12 && embedded.column === 6, 'plain message embedding (12:5) yields line 12, column 6');
assert(embedded && embedded.codeframe !== null && embedded.codeframe.line === 12, 'embedded location still attaches a codeframe');

// --- parseCompilerError: stack captured ---
const stackedErr = new Error('real thing');
const withStack = parseCompilerError(stackedErr, 'f.vsk', src);
assert(withStack !== null && withStack.message === 'real thing', 'Error instance: message via err.message');
assert(withStack !== null && typeof withStack.stack === 'string', 'Error instance: stack is captured');
assert(withStack && withStack.stack!.includes('real thing'), 'stack mentions the message');

// --- parseCompilerError: non-string-y, non-object input still produces a message ---
const strOnly = parseCompilerError('a plain string failure', 'f.vsk', src);
assert(strOnly !== null && strOnly.message === 'a plain string failure', 'string input becomes the message');
assert(strOnly && strOnly.line === null && strOnly.column === null, 'string input yields null line and column');

// --- parseCompilerError: no location recoverable -> nulls but message retained ---
const noLoc = parseCompilerError({ message: 'something happened' }, 'f.vsk', src);
assert(noLoc !== null && noLoc.message === 'something happened', 'no-location error keeps the message');
assert(noLoc && noLoc.line === null && noLoc.column === null, 'no-location error keeps null line/column');
assert(noLoc && noLoc.codeframe === null, 'no-location error keeps null codeframe');

// --- parseCompilerError: null / undefined input ---
assert(parseCompilerError(null, 'f.vsk') === null, 'null error returns null');
assert(parseCompilerError(undefined, 'f.vsk') === null, 'undefined error returns null');

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);