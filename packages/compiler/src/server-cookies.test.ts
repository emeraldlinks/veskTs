import { attachCookieGet, parseCookies } from '@vesk/compiler/src/server-cookies';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

console.log('\n=== server cookie jar ===');

{
  const cookies = parseCookies('session=abc123; theme=dark');
  assert(cookies.session === 'abc123', 'plain cookie access is preserved');
  assert(cookies.get('session') === 'abc123', 'cookies.get(name) reads a cookie');
  assert(cookies.get('missing') === undefined, 'cookies.get(name) returns undefined when absent');
  assert(JSON.stringify(cookies) === '{"session":"abc123","theme":"dark"}', 'get is non-enumerable and stays out of JSON');
}

{
  const cookies = parseCookies('get=literal; normal=1');
  assert(cookies.get('get') === 'literal', 'a cookie literally named get is still readable through get()');
  assert(cookies.get('normal') === '1', 'other cookies remain readable');
}

{
  const raw = { session: 'abc' };
  const cookies = attachCookieGet(raw);
  assert(cookies === raw, 'attachCookieGet returns the same cookie object');
  assert(cookies.get('session') === 'abc', 'attachCookieGet installs the get accessor');
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
