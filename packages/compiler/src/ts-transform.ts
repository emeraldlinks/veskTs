import { extname } from 'node:path';
import { createRequire } from 'node:module';

type EsbuildLike = {
  transform(input: string, options?: any): Promise<{ code: string; map?: string; warnings?: unknown[] }>;
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
    _native = await import('esbuild') as unknown as EsbuildLike;
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

export type TsLoader = 'ts' | 'tsx' | 'js' | 'jsx' | 'mts' | 'cts';

export function loaderForPath(filename: string): TsLoader {
  const ext = extname(filename).toLowerCase();
  if (ext === '.tsx') return 'tsx';
  if (ext === '.jsx') return 'jsx';
  if (ext === '.mts') return 'mts';
  if (ext === '.cts') return 'cts';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js';
  return 'ts';
}

export interface TransformTsOptions {
  filename?: string;
  loader?: TsLoader;
  target?: string;
  sourcemap?: boolean | 'inline' | 'external';
  format?: 'esm' | 'cjs' | 'iife';
}

export async function transformTsModule(code: string, options: TransformTsOptions = {}): Promise<string> {
  const loader = options.loader ?? loaderForPath(options.filename ?? 'module.ts');
  const result = await withNativeFallback((m) => m.transform(code, {
    loader,
    format: options.format ?? 'esm',
    target: options.target ?? 'node20',
    sourcemap: options.sourcemap ?? false,
    sourcefile: options.filename,
    legalComments: 'none',
  }));
  return result.code;
}

export function transformTsModuleSync(code: string, options: TransformTsOptions = {}): string {
  const loader = options.loader ?? loaderForPath(options.filename ?? 'module.ts');
  if (_nativeDead) {
    throw new Error(`Synchronous TypeScript transform unavailable (native esbuild disabled). Preload this module through async SSR loading: ${options.filename || '<unknown>'}`);
  }
  if (!_native) {
    try {
      const req = createRequire(import.meta.url);
      _native = req('esbuild') as unknown as EsbuildLike;
    } catch (e) {
      throw new Error(`Synchronous TypeScript transform unavailable. Preload this module through async SSR loading: ${options.filename || '<unknown>'} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  const nativeAny = _native as any;
  if (typeof nativeAny.transformSync !== 'function') {
    throw new Error(`Synchronous TypeScript transform unavailable: esbuild.transformSync missing for ${options.filename || '<unknown>'}`);
  }
  const result = nativeAny.transformSync(code, {
    loader,
    format: options.format ?? 'esm',
    target: options.target ?? 'node20',
    sourcemap: options.sourcemap ?? false,
    sourcefile: options.filename,
    legalComments: 'none',
  });
  return result.code as string;
}
