/**
 * Same-name `.vsk` components across files.
 *
 * The whole registry is keyed by declared name, so two files declaring
 * `component X` resolve to one of them — and SSR keeps the first while the
 * client keeps the last, so the two sides can render different components.
 * This suite pins the warning and the non-warning cases.
 *
 * Run: npx tsx packages/compiler/src/vsk-collision.test.ts
 */
import { VskComponentOwners, resetVskCollisionReports } from '@vesk/compiler/src/vsk-collision';
import { compileClientBoth } from '@vesk/compiler/src/client-codegen';
import { parse } from '@vesk/compiler/src/parser';

let passed = 0;
let failed = 0;

function describe(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toHaveLength(n: number) {
      if (actual.length !== n) throw new Error(`Expected length ${n}, got ${actual.length}: ${JSON.stringify(actual)}`);
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toContain(sub: string) {
      if (!String(actual).includes(sub)) {
        throw new Error(`Expected ${JSON.stringify(String(actual))} to contain ${JSON.stringify(sub)}`);
      }
    },
  };
}

/** Captures console.warn for the duration of `fn`. */
function captureWarnings(fn: () => string[]): { warnings: string[]; fresh: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    return { warnings, fresh: fn() };
  } finally {
    console.warn = original;
  }
}

describe('collision detection', () => {
  it('reports no collision for one file', () => {
    const o = new VskComponentOwners();
    o.claim('Helper', 'a.vsk');
    const { fresh } = captureWarnings(() => o.report('test'));
    expect(fresh).toHaveLength(0);
  });

  it('reports a name declared in two files', () => {
    const o = new VskComponentOwners();
    o.claim('Helper', 'a.vsk');
    o.claim('Helper', 'b.vsk');
    const { warnings, fresh } = captureWarnings(() => o.report('test'));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toContain('Helper: a.vsk, b.vsk');
    expect(warnings[0]).toContain('[vesk] test:');
    expect(warnings[0]).toContain('component "Helper" is declared in 2 files');
  });

  it('names the client/server divergence in the warning', () => {
    resetVskCollisionReports();
    const o = new VskComponentOwners();
    o.claim('Helper', 'a.vsk');
    o.claim('Helper', 'b.vsk');
    const { warnings } = captureWarnings(() => o.report('test'));
    expect(warnings[0]).toContain('client and server registries pick differently');
  });

  it('treats the same file claiming a name twice as NOT a collision', () => {
    // One file can register a name once per bundle (page + hydrator); that is
    // the same owner, not a conflict.
    const o = new VskComponentOwners();
    o.claim('Helper', 'a.vsk');
    o.claim('Helper', 'a.vsk');
    const { fresh } = captureWarnings(() => o.report('test'));
    expect(fresh).toHaveLength(0);
  });

  it('reports each colliding name once per process', () => {
    resetVskCollisionReports();
    const first = new VskComponentOwners();
    first.claim('Helper', 'a.vsk');
    first.claim('Helper', 'b.vsk');
    const { warnings: w1, fresh: f1 } = captureWarnings(() => first.report('SSR'));
    expect(f1).toHaveLength(1);
    expect(w1).toHaveLength(1);

    // A second compileFile for an overlapping graph must not repeat it.
    const second = new VskComponentOwners();
    second.claim('Helper', 'a.vsk');
    second.claim('Helper', 'c.vsk');
    const { warnings: w2, fresh: f2 } = captureWarnings(() => second.report('SSR'));
    expect(f2).toHaveLength(0);
    expect(w2).toHaveLength(0);
  });

  it('reports multiple distinct collisions, sorted by name', () => {
    resetVskCollisionReports();
    const o = new VskComponentOwners();
    o.claim('Zeta', 'a.vsk');
    o.claim('Zeta', 'b.vsk');
    o.claim('Alpha', 'a.vsk');
    o.claim('Alpha', 'b.vsk');
    const { fresh } = captureWarnings(() => o.report('test'));
    expect(fresh).toHaveLength(2);
    expect(fresh[0]).toContain('Alpha');
    expect(fresh[1]).toContain('Zeta');
  });

  it('is a warning, not a throw — a collision still builds', () => {
    resetVskCollisionReports();
    const o = new VskComponentOwners();
    o.claim('Helper', 'a.vsk');
    o.claim('Helper', 'b.vsk');
    let threw = false;
    try {
      captureWarnings(() => o.report('test'));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe('componentNames from compileClientBoth', () => {
  it('returns every component a file declares, not just the resolved one', () => {
    const src = 'component Alpha { <p>a</p> }\ncomponent Beta { <p>b</p> }\ncomponent Gamma { <p>g</p> }\n';
    const { componentNames } = compileClientBoth(src, null, 'lib.vsk');
    expect(componentNames).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('returns the names in statement AND expression mode', () => {
    const stmt = compileClientBoth('component A { <p>a</p> }\ncomponent B { <p>b</p> }\n', null, 'x.vsk');
    expect(stmt.componentNames).toEqual(['A', 'B']);
    const expr = compileClientBoth('component A { return <p>a</p> }\ncomponent B { return <p>b</p> }\n', null, 'y.vsk');
    expect(expr.componentNames).toEqual(['A', 'B']);
  });

  it('includes components reached only through a namespace import in the owner file', () => {
    // The name still has to be owned by the file that DECLARES it, so a
    // namespace import does not register the target's names twice.
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Panel /></div> }\n";
    const { componentNames } = compileClientBoth(src, null, 'page.vsk');
    expect(componentNames).toEqual(['Page']);
  });

  it('an empty file declares nothing', () => {
    const { componentNames } = compileClientBoth('const x = 1\n', null, 'x.vsk');
    expect(componentNames).toEqual([]);
  });
});

describe('parse guard', () => {
  it('the fixture source is real .vsk, so this suite is not testing a fiction', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Panel /></div> }\n";
    const ast = parse(src, { filename: 'page.vsk' });
    expect((ast as any).body.length).toBe(2);
  });
});

console.log(`\n${passed} passing, ${failed} failing`);
if (failed > 0) process.exit(1);
