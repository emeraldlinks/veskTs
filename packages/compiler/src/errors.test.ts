import { strict as assert } from 'node:assert';
import { VeskError, codeFrame, didYouMean } from './errors.js';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, msg: string): void => {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('✗ ' + msg);
  }
};

// --- factory codes are stable (V0401..V0406) ---
{
  const e = VeskError.notFound('Menu');
  ok(e.code === 'V0401', `notFound() code is V0401 (got ${String(e.code)})`);
  ok(e.toString().startsWith('error[V0401]:'), 'toString prefixes the code');
}
{
  const e = VeskError.classDecl();
  ok(e.code === 'V0402', `classDecl() code is V0402 (got ${String(e.code)})`);
}
{
  const e = VeskError.serverBlockInClient('Foo');
  ok(e.code === 'V0403', `serverBlockInClient() code is V0403 (got ${String(e.code)})`);
}
{
  const e = VeskError.clientBlockInServer('Foo');
  ok(e.code === 'V0404', `clientBlockInServer() code is V0404 (got ${String(e.code)})`);
}
{
  const e = VeskError.componentNotFound('Foo');
  ok(e.code === 'V0401', `componentNotFound() reuses V0401 via notFound (got ${String(e.code)})`);
}
{
  const e = VeskError.configError('bad key');
  ok(e.code === 'V0405', `configError() code is V0405 (got ${String(e.code)})`);
}
{
  const e = VeskError.asyncChildInSyncParent('Parent', 'Child');
  ok(e.code === 'V0406', `asyncChildInSyncParent() code is V0406 (got ${String(e.code)})`);
}

// --- caller-supplied code wins over the factory default ---
{
  const e = VeskError.notFound('Menu', [], { code: 'V0999' });
  ok(e.code === 'V0999', `context.code overrides the factory default (got ${String(e.code)})`);
}
{
  const e = new VeskError('manual', { code: 'V0420', file: 'app/page.vsk', line: 3, column: 7 });
  ok(e.code === 'V0420' && e.file === 'app/page.vsk' && e.line === 3 && e.column === 7, 'constructor opts set code/file/line/column');
}

// --- toJSON serializes the code for the diagnostics pipeline ---
{
  const e = VeskError.asyncChildInSyncParent('Parent', 'Child');
  const json = e.toJSON();
  ok(json.code === 'V0406', 'toJSON() carries code');
  ok(typeof json.message === 'string' && typeof json.stack === 'string', 'toJSON() keeps message + stack');
}

// --- no-code fallback keeps the legacy `[vesk]` prefix ---
{
  const e = new VeskError('plain');
  ok(e.code === undefined && e.toString().startsWith('error: '), 'uncoded VeskError renders the legacy prefix');
}

// --- helpers still work (regression guard) ---
{
  ok(didYouMean('Menus', ['Menu', 'MeNu']) === 'Menu', 'didYouMean finds the closest candidate');
  const frame = codeFrame('a\nb\nc', 2, 1);
  ok(frame.includes('2 | b') && frame.includes('^'), 'codeFrame builds the caret frame');
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);