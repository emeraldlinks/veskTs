import { suggestFor } from './error-tips';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

console.log('\n\u2550\u2550\u2550 Vesk error-tips tests \u2550\u2550\u2550\n');

function total(t) {
  return t.tips.length + t.suggestions.length + t.nextSteps.length;
}

function isShape(t) {
  return t
    && Array.isArray(t.tips) && t.tips.every((s) => typeof s === 'string')
    && Array.isArray(t.suggestions) && t.suggestions.every((s) => typeof s === 'string')
    && Array.isArray(t.nextSteps) && t.nextSteps.every((s) => typeof s === 'string');
}

// bucket: is not defined
{
  const t = suggestFor('"count" is not defined.');
  console.log('  \u2014 is not defined bucket');
  assert(isShape(t), 'returns a well-shaped ErrorTips object');
  assert(total(t) >= 2 && total(t) <= 4, 'bucket returns 2-4 strings total');
  assert(t.tips.some((s) => /import|declar/i.test(s)), 'tip mentions import/declared');
  assert(
    t.suggestions.join(' ').includes('auto-import') && t.suggestions.join(' ').includes('batch'),
    'suggestion notes vesk auto-imports and the no-batch rule'
  );
  assert(t.suggestions.join(' ').includes('effect'), 'suggestion lists runtime helpers');
}

// bucket: Unexpected token / Parse error / SyntaxError
for (const msg of ['Unexpected token (1:5)', 'Parse error at col 3', 'SyntaxError: unexpected end of input']) {
  const t = suggestFor(msg);
  console.log('  \u2014 syntax bucket:', msg);
  assert(isShape(t), 'returns a well-shaped ErrorTips object');
  assert(total(t) >= 2 && total(t) <= 4, 'bucket returns 2-4 strings total');
  assert(
    t.suggestions.join(' ').toLowerCase().includes('statement mode') && t.suggestions.join(' ').toLowerCase().includes('expression mode'),
    'suggestion covers statement vs expression body modes'
  );
  assert(t.tips.join(' ').toLowerCase().includes('token') || t.nextSteps.join(' ').includes('^'), 'content addresses the parser error');
}

// bucket: module resolution
for (const msg of ['Cannot find module "./missing"', 'Cannot load module "@pkg/x"', 'Module not found: ./y']) {
  const t = suggestFor(msg);
  console.log('  \u2014 module bucket:', msg);
  assert(isShape(t), 'returns a well-shaped ErrorTips object');
  assert(total(t) >= 2 && total(t) <= 4, 'bucket returns 2-4 strings total');
  assert(t.suggestions.join(' ').includes('./'), 'suggestion addresses relative import paths');
  assert(t.nextSteps.join(' ').toLowerCase().includes('install'), 'next step suggests installing/missing file');
}

// bucket: unterminated
for (const msg of ['Unterminated string constant (4:1)', 'unterminated template literal']) {
  const t = suggestFor(msg);
  console.log('  \u2014 unterminated bucket:', msg);
  assert(isShape(t), 'returns a well-shaped ErrorTips object');
  assert(total(t) >= 2 && total(t) <= 4, 'bucket returns 2-4 strings total');
  assert(/string|template/i.test(t.tips.join(' ')), 'tip mentions string/template literal');
  assert(/backtick|quote/i.test(t.suggestions.join(' ')), 'suggestion looks for closing quote/backtick');
}

// bucket: is not a function
for (const msg of ['foo.bar is not a function', 'undefined is not a function (reading "emit")']) {
  const t = suggestFor(msg);
  console.log('  \u2014 not-a-function bucket:', msg);
  assert(isShape(t), 'returns a well-shaped ErrorTips object');
  assert(total(t) >= 2 && total(t) <= 4, 'bucket returns 2-4 strings total');
  assert(/call|import/i.test(t.suggestions.join(' ')), 'suggestion covers call/import');
}

// bucket: null / undefined property access
for (const msg of [
  'Cannot read properties of undefined (reading "name")',
  'Cannot read properties of null (reading "x")',
  'Cannot read property "y" of null',
]) {
  const t = suggestFor(msg);
  console.log('  \u2014 null-deref bucket:', msg);
  assert(isShape(t), 'returns a well-shaped ErrorTips object');
  assert(total(t) >= 2 && total(t) <= 4, 'bucket returns 2-4 strings total');
  assert(/null|undefined/i.test(t.tips.join(' ')), 'tip mentions null/undefined read');
  assert(t.suggestions.join(' ').includes('?.'), 'suggestion offers optional chaining');
  assert(/async|render/i.test(t.nextSteps.join(' ')), 'next step traces async/load timing');
}

// generic fallback for unmatched messages
{
  const t = suggestFor('I am an error that matches no known bucket hello world');
  console.log('  \u2014 fallback bucket');
  assert(isShape(t), 'returns a well-shaped ErrorTips object');
  assert(total(t) >= 2 && total(t) <= 4, 'fallback returns 2-4 strings total');
  assert(t.suggestions.join(' ').includes('import'), 'fallback checks imports');
  assert(t.suggestions.join(' ').includes('statement mode'), 'fallback checks both body modes');
  assert(t.nextSteps.join(' ').toLowerCase().includes('restart'), 'fallback suggests restarting the dev server');
  assert(t.nextSteps.join(' ').toLowerCase().includes('fuller'), 'fallback points at the fuller error above');
}

// fallback also handles a non-string signal defensively
{
  const t = suggestFor(undefined);
  assert(isShape(t), 'non-string input still yields a shaped fallback');
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);