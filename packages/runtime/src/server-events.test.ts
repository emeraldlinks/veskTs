import {
  server_locals,
  get_server_context,
  set_server_context,
  clear_server_context,
  serverLocals,
  getServerContext,
  setServerContext,
  clearServerContext,
} from '@vesk/runtime/src/server-events';

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
    console.log(`  ✗ ${name}`);
    console.log(`    ${e instanceof Error ? e.message : e}`);
  }
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toBeNull() {
      if (actual !== null && actual !== undefined) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
  };
}

describe('server-wide context', () => {
  it('set/get round-trip through the process-wide store', () => {
    set_server_context('db', { connected: true });
    const db = get_server_context('db') as { connected: boolean } | undefined;
    expect(db === undefined).toBe(false);
    expect(db?.connected).toBe(true);
  });

  it('camelCase aliases are the same functions', () => {
    expect(serverLocals === server_locals).toBe(true);
    expect(getServerContext === get_server_context).toBe(true);
    expect(setServerContext === set_server_context).toBe(true);
    expect(clearServerContext === clear_server_context).toBe(true);
  });

  it('serverLocals returns the live store object', () => {
    const store = serverLocals();
    set_server_context('k', 42);
    expect(store.k).toBe(42);
  });

  it('get returns undefined when unset', () => {
    set_server_context('zzz-unset-key', undefined);
    expect(get_server_context('zzz-missing')).toBeNull();
  });

  it('clear wipes every key', () => {
    set_server_context('a', 1);
    set_server_context('b', 2);
    clear_server_context();
    expect(get_server_context('a')).toBeNull();
    expect(get_server_context('b')).toBeNull();
  });

  it('values set via camelCase are visible via snake_case', () => {
    setServerContext('x', 'y');
    expect(get_server_context('x')).toBe('y');
  });
});

describe('cleanup', () => {
  it('clears the store', () => {
    clear_server_context();
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All server-events tests passed!');