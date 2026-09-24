#!/usr/bin/env node
/**
 * API-route dev/prod parity probe.
 *
 * Every API-route feature must behave identically on the dev dispatcher and
 * on the generated production wrapper. That parity used to be broken in BOTH
 * directions: the prod wrapper ignored `config`, `maxDuration` and the
 * route hooks, and the dev dispatcher assumed hooks were arrays when the
 * documented form is a single function. A feature could therefore pass in
 * dev and silently do nothing (or 500) in a production build.
 *
 * Drives a LIVE server (the app's generated API functions and its
 * `@vesk/runtime/server` imports only differ between targets, so only a real
 * build proves them).
 *
 * Usage:
 *   cd test-app && npm run build && npm run start   # or npm run dev
 *   BASE=http://localhost:3000 TARGET=prod node tests/api-parity-test.mjs
 *
 * Requires test-app/app/api/parity/route.ts (the fixture this probes).
 */
const BASE = process.env.BASE || 'http://localhost:3000';
const TARGET = process.env.TARGET || 'unknown';

let pass = 0;
let fail = 0;

function chk(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const MB = 1024 * 1024;

console.log(`\n=== API route parity [${TARGET}] ${BASE} ===`);

// non-Response return is JSON-serialized with 200
{
  const r = await fetch(`${BASE}/api/parity`);
  const t = await r.text();
  chk('non-Response return -> 200 JSON', r.status === 200 && t.includes('"notAResponse":true'), `got ${r.status} ${t.slice(0, 90)}`);
}

// beforeRequest can short-circuit with a Response
{
  const r = await fetch(`${BASE}/api/parity?short=1`);
  const t = await r.text();
  chk('beforeRequest hook short-circuits', r.status === 200 && t.includes('shortCircuited'), `got ${r.status} ${t.slice(0, 90)}`);
}

// afterRequest hook sees and can decorate a real Response
{
  const r = await fetch(`${BASE}/api/parity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ h: 1 }),
  });
  chk('afterRequest hook ran', r.headers.get('x-after-hook') === 'ran', `got ${r.headers.get('x-after-hook')}`);
}

// thrown notFound() -> 404 JSON
{
  const r = await fetch(`${BASE}/api/parity?gone=1`);
  const t = await r.text();
  chk('thrown notFound() -> 404', r.status === 404 && t.includes('Not Found'), `got ${r.status} ${t.slice(0, 90)}`);
}

// thrown redirect -> 3xx + Location
{
  const r = await fetch(`${BASE}/api/parity?away=1`, { redirect: 'manual' });
  chk('thrown redirect -> 302 + Location', r.status === 302 && !!r.headers.get('location'), `got ${r.status} ${r.headers.get('location')}`);
}

// unimplemented OPTIONS auto-answers 204 with Allow
{
  const r = await fetch(`${BASE}/api/parity`, { method: 'OPTIONS' });
  chk('OPTIONS -> 204 + Allow', r.status === 204 && !!r.headers.get('allow'), `got ${r.status} allow=${r.headers.get('allow')}`);
}

// unimplemented verb -> 405 with Allow
{
  const r = await fetch(`${BASE}/api/parity`, { method: 'DELETE' });
  chk('unimplemented verb -> 405 + Allow', r.status === 405 && !!r.headers.get('allow'), `got ${r.status} allow=${r.headers.get('allow')}`);
}

// @vesk/runtime/server import resolves in a real build (signCookie)
{
  const r = await fetch(`${BASE}/api/parity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }),
  });
  const t = await r.text();
  chk('POST -> 201 + signCookie() resolves', r.status === 201 && t.includes('"signed":"abc.'), `got ${r.status} ${t.slice(0, 110)}`);
}

// useParams() from @vesk/runtime/server resolves
{
  const r = await fetch(`${BASE}/api/parity`, { method: 'PUT' });
  const t = await r.text();
  chk('PUT -> 200 + useParams() resolves', r.status === 200 && t.includes('"put":true'), `got ${r.status} ${t.slice(0, 110)}`);
}

// body cap -> 413 (not an opaque 500)
{
  const r = await fetch(`${BASE}/api/parity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pad: 'x'.repeat(MB + 2048) }),
  });
  const t = await r.text();
  chk('body over 1MiB -> 413', r.status === 413, `got ${r.status} ${t.slice(0, 90)}`);
}

// CSRF default enforced on a route that does NOT opt out
{
  const r = await fetch(`${BASE}/api/hello`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}',
  });
  chk('cross-origin POST -> 403 (csrf default)', r.status === 403, `got ${r.status}`);
}

// an existing route is unaffected (GET /api/hello is 201 by design)
{
  const r = await fetch(`${BASE}/api/hello`);
  chk('GET /api/hello unaffected', r.status === 201, `got ${r.status}`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
