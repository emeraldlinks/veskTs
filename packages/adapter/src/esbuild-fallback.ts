let _nativeBuild: ((options: any) => Promise<any>) | null = null;
let _nativeTransform: ((code: string, options?: any) => any) | null = null;
let _wasm: any | null = null;
let _wasmReady: Promise<any> | null = null;

async function loadNative() {
  if (_nativeBuild && _nativeTransform) return;
  try {
    const m = await import('esbuild');
    _nativeBuild = m.build.bind(m);
    _nativeTransform = m.transformSync.bind(m);
  } catch {
    // native esbuild not installed
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
      throw new Error('esbuild-wasm not available');
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
      } else {
        throw e;
      }
    }
  }
  const wasm = await getWasm();
  return wasm.build(options);
}

export function transformSync(code: string, options?: any): any {
  if (_nativeTransform) {
    try {
      return _nativeTransform(code, options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('SIGILL') || msg.includes('illegal hardware instruction') || msg.includes('cannot execute binary file')) {
        throw new Error('esbuild-wasm fallback for transformSync not yet implemented — use native esbuild or convert to async transform');
      }
      throw e;
    }
  }
  throw new Error('esbuild not installed — run `npm install esbuild` or use `vesk build` which falls back to esbuild-wasm for bundling');
}
