import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  extractImportStatements,
  vskImportTarget,
  vskImportLines,
  collectVskImportPaths,
  stripTypeImport,
} from '@vesk/compiler/src/vsk-imports';

let passed = 0;
let failed = 0;

function describe(name, fn) { console.log(`\n${name}`); fn(); }

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
    toContain(sub) {
      if (!String(actual).includes(sub)) throw new Error(`Expected to contain ${JSON.stringify(sub)} in ${JSON.stringify(actual)}`);
    },
  };
}

describe('extractImportStatements', () => {
  it('extracts single-line imports', () => {
    const src = "import { Foo } from './foo.vsk';\ncomponent App {}\n";
    const imports = extractImportStatements(src);
    expect(imports.length).toBe(1);
    expect(imports[0]).toBe("import { Foo } from './foo.vsk';");
  });

  it('extracts multi-line import lists', () => {
    const src = [
      'import {',
      '  Foo,',
      '  Bar,',
      "} from './helpers.vsk';",
      'component App {}',
    ].join('\n');
    const imports = extractImportStatements(src);
    expect(imports.length).toBe(1);
    expect(imports[0]).toContain('Foo');
    expect(imports[0]).toContain("from './helpers.vsk'");
  });

  it('does not treat import-looking text inside strings as imports', () => {
    const src = "const s = \"import { x } from './fake.vsk';\";\ncomponent App {}\n";
    const imports = extractImportStatements(src);
    expect(imports.length).toBe(0);
  });

  it('does not treat import-looking text inside comments as imports', () => {
    const src = "// import { x } from './fake.vsk';\ncomponent App {}\n";
    const imports = extractImportStatements(src);
    expect(imports.length).toBe(0);
  });

  it('extracts imports after component bodies', () => {
    const src = [
      'component App {',
      '  return <div>hi</div>',
      '}',
      "import { Foo } from './foo.vsk';",
    ].join('\n');
    const imports = extractImportStatements(src);
    expect(imports.length).toBe(1);
    expect(imports[0]).toContain("from './foo.vsk'");
  });

  it('extracts default and namespace imports', () => {
    const src = [
      "import Helper from './helper.vsk';",
      "import * as utils from './utils.vsk';",
      'component App {}',
    ].join('\n');
    const imports = extractImportStatements(src);
    expect(imports.length).toBe(2);
  });
});

describe('vskImportTarget', () => {
  it('returns .vsk targets', () => {
    expect(vskImportTarget("import { Foo } from './foo.vsk';")).toBe('./foo.vsk');
  });

  it('returns null for non-.vsk targets', () => {
    expect(vskImportTarget("import { x } from './foo.js';")).toBeNull();
  });
});

describe('collectVskImportPaths', () => {
  it('resolves relative .vsk imports', () => {
    const tmp = mkdtempSync('/tmp/vesk-vskimports-test-');
    try {
      const srcDir = join(tmp, 'app');
      mkdirSync(srcDir, { recursive: true });
      const helperPath = join(srcDir, 'helpers.vsk');
      writeFileSync(helperPath, 'component Helper {}');
      const paths = collectVskImportPaths([`import { Helper } from './helpers.vsk';`], join(srcDir, 'page.vsk'));
      expect(paths.length).toBe(1);
      expect(paths[0]).toBe(helperPath);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it('ignores type-only imports', () => {
    const tmp = mkdtempSync('/tmp/vesk-vskimports-test-');
    try {
      const srcDir = join(tmp, 'app');
      mkdirSync(srcDir, { recursive: true });
      const helperPath = join(srcDir, 'helpers.vsk');
      writeFileSync(helperPath, 'component Helper {}');
      const paths = collectVskImportPaths([
        `import { Helper } from './helpers.vsk';`,
        `import type { HelperProps } from './helpers.vsk';`,
      ], join(srcDir, 'page.vsk'));
      expect(paths.length).toBe(1);
      expect(paths[0]).toBe(helperPath);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});

describe('stripTypeImport', () => {
  it('drops whole import type statements', () => {
    expect(stripTypeImport("import type { User } from './types.ts';")).toBeNull();
    expect(stripTypeImport("import type { Theme } from './types.vsk';")).toBeNull();
    expect(stripTypeImport("import type Foo from './x.ts';")).toBeNull();
    expect(stripTypeImport("import type * as ns from './x.ts';")).toBeNull();
  });

  it('drops imports whose specifiers are all type specifiers', () => {
    expect(stripTypeImport("import { type A, type B } from './x.ts';")).toBeNull();
  });

  it('strips inline type specifiers from mixed imports', () => {
    expect(stripTypeImport("import { type A, helper } from './x.ts';")).toBe("import { helper } from './x.ts';");
    expect(stripTypeImport("import value, { type C } from './x.ts';")).toBe("import value from './x.ts';");
  });

  it('leaves value imports untouched', () => {
    expect(stripTypeImport("import { helper } from './x.ts';")).toBe("import { helper } from './x.ts';");
    expect(stripTypeImport("import * as ns from './x.ts';")).toBe("import * as ns from './x.ts';");
  });
});

describe('vskImportLines', () => {
  it('skips type-only imports even from .vsk targets', () => {
    const src = [
      "import { Helper } from './helpers.vsk';",
      "import type { HelperProps } from './helpers.vsk';",
      'component App {}',
    ].join('\n');
    const lines = vskImportLines(src);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('Helper }');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
