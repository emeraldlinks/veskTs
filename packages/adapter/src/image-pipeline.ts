import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, extname, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import type { ImageRef, ImageResult } from '@vesk/adapter/src/types';

const SUPPORTED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff']);
const OUTPUT_WIDTHS = [640, 768, 1024, 1280, 1536];
const FORMATS = ['webp', 'avif'];

interface SharpImage {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  clone(): SharpImage;
  resize(opts: { width: number; withoutEnlargement: boolean }): SharpImage;
  toFile(path: string): Promise<void>;
  toFormat(fmt: string, opts: { quality: number }): SharpImage;
}

let sharpFn: ((src: string) => SharpImage) | null = null;
let sharpProbed = false;

/**
 * Remember a failed probe on disk.
 *
 * The probe's answer is a property of the MACHINE (CPU instruction set, the
 * installed sharp binary) and not of the project, but it costs a child process
 * that dies with SIGILL — and the kernel writes a core dump on the way out, so
 * the "no" case is the expensive one: measured at 25-100s per build on a
 * loaded 2-core box. Without this, every build of an app that has images pays
 * it again. The key folds in the resolved sharp entry's mtime, so installing or
 * upgrading sharp invalidates the memo and the next build probes for real.
 */
function probeMemoPath(): string | null {
  try {
    const req = createRequire(import.meta.url);
    // `sharp/package.json` is NOT an exported subpath (sharp's exports map
    // rejects it with ERR_PACKAGE_PATH_NOT_EXPORTED), so key on the resolved
    // ENTRY file: its mtime changes on install/upgrade, which is exactly when
    // the answer has to be re-measured.
    const entry = req.resolve('sharp');
    const stamp = Math.round(statSync(entry).mtimeMs);
    return join(tmpdir(), `vesk-sharp-probe-${process.platform}-${process.arch}-${stamp}.json`);
  } catch {
    // sharp not installed: the answer is "unavailable" and cannot change
    // without an install.
    return null;
  }
}

function readProbeMemo(): boolean | null {
  const path = probeMemoPath();
  if (path === null) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))?.usable === true;
  } catch {
    return null;
  }
}

function writeProbeMemo(usable: boolean): void {
  const path = probeMemoPath();
  if (path === null) return;
  try {
    writeFileSync(path, JSON.stringify({ usable, at: Date.now() }), 'utf-8');
  } catch { /* a read-only tmpdir just means we probe again next build */ }
}

/**
 * Load sharp, or decide we cannot. LAZY on purpose: the probe spawns a child
 * Node that imports the native module, and on a CPU without the instructions
 * sharp's binary needs that child dies with SIGILL after tens of seconds. Doing
 * it at module scope charged every build — including builds of apps with no
 * `<Image>` at all — for a capability the build may never use. Callers reach
 * this only after finding image refs, and the answer is memoized per machine.
 */
async function ensureSharp(): Promise<void> {
  if (sharpProbed) return;
  sharpProbed = true;
  const memo = readProbeMemo();
  if (memo === false) {
    console.warn('vesk images: sharp unusable on this machine (cached); using copy-only image pipeline');
    return;
  }
  try {
    // Probe in a child before importing sharp in this process. On older CPUs,
    // importing the native module itself can terminate Node with SIGILL; an
    // in-process try/catch cannot catch that signal.
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import sharp from 'sharp'; await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();",
      ],
      { stdio: 'ignore' },
    );
    if (probe.status === 0) {
      const mod = await import('sharp') as unknown as { default: (src: string) => SharpImage };
      sharpFn = mod.default;
      writeProbeMemo(true);
    } else {
      console.warn('vesk images: sharp native probe failed; using copy-only image pipeline');
      writeProbeMemo(false);
    }
  } catch {
    // sharp not available — fall through to copy-only
  }
}

async function processImage(srcPath: string, outDir: string, baseName: string): Promise<string[]> {
  const image = sharpFn ? sharpFn(srcPath) : null;

  if (!image) {
    const original = readFileSync(srcPath);
    for (const w of OUTPUT_WIDTHS) {
      const outputPath = resolve(outDir, `${baseName}-${w}w`);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, original);
    }
    return [];
  }

  const meta = await image.metadata();
  const originalWidth = meta.width || 1920;
  const generated: string[] = [];

  for (const w of OUTPUT_WIDTHS) {
    if (w > originalWidth) continue;
    const resized = image.clone().resize({ width: w, withoutEnlargement: true });
    const base = `${baseName}-${w}w`;

    const jpgPath = resolve(outDir, `${base}${extname(srcPath)}`);
    mkdirSync(dirname(jpgPath), { recursive: true });
    await resized.toFile(jpgPath);
    generated.push(jpgPath);

    for (const fmt of FORMATS) {
      const fmtPath = resolve(outDir, `${base}.${fmt}`);
      await resized.toFormat(fmt, { quality: 80 }).toFile(fmtPath);
      generated.push(fmtPath);
    }
  }

  return generated;
}

function collectImageRefs(appDir: string): ImageRef[] {
  const refs: ImageRef[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = resolve(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry.startsWith('.')) continue;
        walk(full);
      } else if (entry === 'page.vsk') {
        const src = readFileSync(full, 'utf-8');
        const imgRegex = /<Image\s+src=["']([^"']+)["']/g;
        let m: RegExpExecArray | null;
        while ((m = imgRegex.exec(src)) !== null) {
          refs.push({ source: full, src: m[1] });
        }
      }
    }
  }

  walk(appDir);
  return refs;
}

export async function optimizeImages(appDir: string, outDir: string): Promise<ImageResult[]> {
  const imageOutDir = resolve(outDir, 'static', 'images');
  mkdirSync(imageOutDir, { recursive: true });

  const refs = collectImageRefs(appDir);
  if (refs.length === 0) {
    console.error('vesk images: no <Image> refs found');
    return [];
  }

  await ensureSharp();

  const results: ImageResult[] = [];
  for (const ref of refs) {
    // `src` is site-root-relative in every documented form (`<Image
    // src="/hero.png" />`), and `path.resolve` treats a leading-slash argument
    // as an ABSOLUTE path — so `resolve(appDir, '/hero.png')` asks the filesystem
    // for `/hero.png` and every image reference in the app is reported missing.
    // Strip the leading slash for every candidate base.
    const rel = ref.src.replace(/^\//, '');
    const possiblePaths = [
      resolve(appDir, rel),
      resolve(appDir, '..', 'public', rel),
      resolve(appDir, '..', 'src', rel),
      resolve(outDir, 'static', 'public', rel),
    ];

    let srcPath: string | null = null;
    for (const p of possiblePaths) {
      if (existsSync(p)) { srcPath = p; break; }
    }

    if (!srcPath) {
      console.error(`vesk images: not found — ${ref.src} (referenced by ${ref.source})`);
      continue;
    }

    const ext = extname(srcPath).toLowerCase();
    if (!SUPPORTED.has(ext)) {
      console.error(`vesk images: unsupported format — ${ref.src} (${ext})`);
      continue;
    }

    const baseName = ref.src.replace(/^\//, '').replace(extname(ref.src), '');
    const files = await processImage(srcPath, imageOutDir, baseName);
    results.push({ src: ref.src, baseName, files, widths: OUTPUT_WIDTHS });
    console.error(`vesk images: ${ref.src} → ${files.length} variants`);
  }

  if (sharpFn) {
    console.error(`vesk images: sharp pipeline — ${results.length} images processed`);
  } else {
    console.error('vesk images: sharp not available — originals copied (install sharp for resizing)');
  }

  return results;
}
