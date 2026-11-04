// esbuild access with a WASM fallback for machines where the native binary
// cannot run (older CPUs raise SIGILL, unsupported platforms skip install).
// Only `build()` is routed here: every synchronous TS-strip call site now uses
// the compiler's dependency-free `stripCodeTypes` (acorn-based), so no
// transformSync path exists anymore.
let _nativeBuild: ((options: any) => Promise<any>) | null = null;
let _nativeDead = process.env.VESK_NO_NATIVE_ESBUILD === 'true';
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
    }).catch((e) => {
      _wasmReady = null;
      throw new Error(`esbuild-wasm not available — install it with: npm install esbuild-wasm (underlying: ${e instanceof Error ? e.message : String(e)})`);
    });
  }
  return _wasmReady;
}

export async function build(options: any): Promise<any> {
  await loadNative();
  if (_nativeBuild && !_nativeDead) {
    try {
      return await Promise.race([
        _nativeBuild(options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('esbuild native timeout')), 120000)),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('SIGILL') || msg.includes('illegal hardware instruction') || msg.includes('cannot execute binary file') || msg.includes('esbuild native timeout')) {
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
