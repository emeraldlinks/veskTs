// esbuild access with a WASM fallback for machines where the native binary
// cannot run (older CPUs raise SIGILL, unsupported platforms skip install).
// Only `build()` is routed here: every synchronous TS-strip call site now uses
// the compiler's dependency-free `stripCodeTypes` (acorn-based), so no
// transformSync path exists anymore.
let _nativeBuild: ((options: any) => Promise<any>) | null = null;
let _nativeDead = false;
let _wasm: any | null = null;
let _wasmReady: Promise<any> | null = null;

async function loadNative() {
  if (_nativeBuild || _nativeDead) return;
  try {
    const m = await import('esbuild');
    _nativeBuild = m.build.bind(m);
  } catch {
    // native esbuild not installed — wasm handles it
  }
}

async function getWasm() {
  if (_wasm) return _wasm;
  if (!_wasmReady) {
    _wasmReady = import('esbuild-wasm').then(m => {
      _wasm = m;
      return m;
    }).catch(() => {
      _wasmReady = null;
      throw new Error('esbuild-wasm not available — install it with: npm install esbuild-wasm');
    });
  }
  return _wasmReady;
}

export async function build(options: any): Promise<any> {
  await loadNative();
  if (_nativeBuild) {
    try {
      return await _nativeBuild(options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('SIGILL') || msg.includes('illegal hardware instruction') || msg.includes('cannot execute binary file')) {
        console.warn('vesk: native esbuild failed, falling back to esbuild-wasm:', msg);
        _nativeDead = true;
      } else {
        throw e;
      }
    }
  }
  const wasm = await getWasm();
  return wasm.build(options);
}
