// esbuild access with a WASM fallback for machines where the native binary
// cannot run (older CPUs raise SIGILL, unsupported platforms skip install).
// `build()` and `transform()` are routed here. Synchronous compiler AST-strip
// paths still use the dependency-free `stripCodeTypes` (acorn-based), but file-
// level module preparation/SSR loading use this async transform for robust TS.
type EsbuildLike = {
  build(options: any): Promise<any>;
  transform(input: string, options?: any): Promise<any>;
};

let _native: EsbuildLike | null = null;
let _nativeDead = process.env.VESK_NO_NATIVE_ESBUILD === 'true';
let _wasm: EsbuildLike | null = null;
let _wasmReady: Promise<EsbuildLike> | null = null;

function isNativeUnavailable(msg: string): boolean {
  return msg.includes('SIGILL') || msg.includes('illegal hardware instruction') || msg.includes('cannot execute binary file') || msg.includes('esbuild native timeout');
}

async function loadNative() {
  if (_native || _nativeDead) return;
  try {
    const m = await import('esbuild') as unknown as EsbuildLike;
    _native = m;
  } catch {
    // native esbuild not installed — wasm handles it
  }
}

async function getWasm(): Promise<EsbuildLike> {
  if (_wasm) return _wasm;
  if (!_wasmReady) {
    _wasmReady = import('esbuild-wasm').then((m) => {
      _wasm = m as unknown as EsbuildLike;
      return _wasm;
    }).catch((e) => {
      _wasmReady = null;
      throw new Error(`esbuild-wasm not available — install it with: npm install esbuild-wasm (underlying: ${e instanceof Error ? e.message : String(e)})`);
    });
  }
  return _wasmReady;
}

async function withNativeFallback<T>(op: (m: EsbuildLike) => Promise<T>): Promise<T> {
  await loadNative();
  if (_native && !_nativeDead) {
    try {
      return await Promise.race([
        op(_native),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('esbuild native timeout')), 120000)),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isNativeUnavailable(msg)) {
        console.warn('vesk: native esbuild failed, falling back to esbuild-wasm:', msg);
        _nativeDead = true;
      } else {
        throw e;
      }
    }
  }
  const wasm = await getWasm();
  return op(wasm);
}

export async function build(options: any): Promise<any> {
  return withNativeFallback((m) => m.build(options));
}

export async function transform(input: string, options?: any): Promise<any> {
  return withNativeFallback((m) => m.transform(input, options));
}
