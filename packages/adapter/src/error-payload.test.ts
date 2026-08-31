/**
 * Unit tests for `buildErrorPayload` — the canonical HMR error-payload builder
 * in `hmr.ts`. Runs pre-rebuild via the relative-source import so it needs no
 * `dist/`. Exercises: an Error with stack + a fake file on disk, a plain string
 * error, an error exposing `.loc`, and a missing-file case.
 */
import { buildErrorPayload } from './hmr';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

console.log('\n=== Vesk error-payload ===');

// Fake project dir with a page.vsk on disk so the codeframe path reads real
// source with ≥ 5 lines above + ≥ 5 below the error line.
const tmp = mkdtempSync(join(tmpdir(), 'vesk-payload-'));
const fakeSrc = Array.from({ length: 20 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n');
writeFileSync(join(tmp, 'page.vsk'), fakeSrc, 'utf-8');

try {
  // --- Error instance with stack + .loc + fake file on disk ---
  {
    const err = new Error('someVar is not defined');
    err.name = 'VeskError';
    (err as unknown as { loc: unknown }).loc = { line: 10, column: 3 };
    const p = buildErrorPayload(err, 'page.vsk', { appDir: tmp });
    assert(p.file === 'page.vsk', 'Error case: file is preserved (relative path)');
    assert(p.filePath === join(tmp, 'page.vsk'), 'Error case: filePath is the resolved absolute path');
    assert(p.message === 'someVar is not defined', 'Error case: message via err.message');
    assert(p.stack && p.stack.includes('Error: someVar is not defined'), 'Error case: stack is captured from the Error');
    assert(p.line === 10 && p.column === 4, 'Error case: line/column from .loc (0-based col → 4)');
    assert(Array.isArray(p.tips) && p.tips.length >= 1, 'Error case: tips array present');
    assert(Array.isArray(p.suggestions) && p.suggestions.length >= 1, 'Error case: suggestions array present');
    assert(Array.isArray(p.nextSteps) && p.nextSteps.length >= 1, 'Error case: nextSteps array present');
    assert(
      p.tips!.join(' ').toLowerCase().includes('undeclared') || p.suggestions!.join(' ').toLowerCase().includes('undeclared'),
      'Error case: "is not defined" bucket selected'
    );
    assert(p.codeframe !== undefined, 'Error case: codeframe present (source + line available)');
    assert(p.codeframe!.code.length === 11, 'Error case: codeframe has 11 lines (5 up + error + 5 down)');
    assert(
      p.codeframe!.code.filter((l) => l.isError).length === 1 &&
        p.codeframe!.code.filter((l) => l.isError)[0].no === 10,
      'Error case: exactly one isError line at line 10'
    );
    assert(p.codeframe!.file === 'page.vsk', 'Error case: codeframe.file is the relative filename');
    assert(p.codeframe!.line === 10 && p.codeframe!.column === 4, 'Error case: codeframe centers on error line/column');
  }

  // --- String error (no location info) ---
  {
    const p = buildErrorPayload('boom', 'whatever.vsk', { appDir: tmp });
    assert(p.message === 'boom', 'string case: the string becomes the message');
    assert(p.line === null && p.column === null, 'string case: line/column are null (no location)');
    assert(p.codeframe === undefined, 'string case: no codeframe when line is unknown');
    assert(Array.isArray(p.tips) && Array.isArray(p.suggestions) && Array.isArray(p.nextSteps), 'string case: tips/suggestions/nextSteps arrays present');
  }

  // --- Error exposing .loc (acorn / VeskError shape, 0-based column) ---
  {
    const p = buildErrorPayload(
      { message: 'Unexpected token', loc: { line: 3, column: 7 } },
      'page.vsk',
      { appDir: tmp },
    );
    assert(p.message === 'Unexpected token', 'loc case: message preserved');
    assert(p.line === 3 && p.column === 8, 'loc case: 0-based loc.column → 1-based (8)');
    assert(p.codeframe !== undefined, 'loc case: codeframe present for a located error with source on disk');
    assert(
      p.codeframe!.code.filter((l) => l.isError)[0].no === 3,
      'loc case: codeframe marks the loc line'
    );
    assert(Array.isArray(p.tips) && Array.isArray(p.suggestions) && Array.isArray(p.nextSteps), 'loc case: tips/suggestions/nextSteps arrays present');
  }

  // --- Missing-file case: line info present but no source file on disk ---
  {
    const p = buildErrorPayload(
      { message: 'Parse error', position: { line: 2, column: 0 } },
      'missing.vsk',
      { appDir: tmp },
    );
    assert(p.line === 2 && p.column === 1, 'position/missing-file case: line/column parsed (0-based col → 1)');
    assert(p.codeframe === undefined, 'position/missing-file case: no codeframe when source file is missing on disk');
    assert(p.message === 'Parse error', 'position/missing-file case: message retained');
  }

  // --- Non-string, non-object error still yields a message ---
  {
    const p = buildErrorPayload(42, 'x.vsk', {});
    assert(typeof p.message === 'string' && p.message.length > 0, 'raw value case: message is a non-empty string');
    assert(p.line === null && p.column === null, 'raw value case: line/column null');
    assert(p.codeframe === undefined, 'raw value case: codeframe absent');
  }

  // --- No appDir → cannot read source → no codeframe even with line info ---
  {
    const p = buildErrorPayload({ message: 'x', line: 2, column: 1 }, 'page.vsk', {});
    assert(p.line === 2 && p.column === 1, 'no-appDir case: line/column still parsed');
    assert(p.codeframe === undefined, 'no-appDir case: codeframe omitted (cannot resolve source)');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
