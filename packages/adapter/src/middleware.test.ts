import { compileMiddlewareCode } from './middleware.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean | null | undefined, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function main(): void {
  console.log('\n=== Middleware chain code generation ===');

  const code = compileMiddlewareCode([
    [
      "import { VeskResponse } from '@vesk/runtime/server';",
      'export async function middleware(ctx, next) {',
      "  return VeskResponse.redirect('/auth/login', 302);",
      '}',
    ].join('\n'),
  ]);

  assert(code !== null, 'compiles a middleware chain');
  assert(code?.includes("import { VeskResponse } from '@vesk/runtime/server';") === true, 'preserves bare package imports');
  assert(code?.includes("return VeskResponse.redirect('/auth/login', 302);") === true, 'keeps VeskResponse call in the emitted middleware');

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

main();
