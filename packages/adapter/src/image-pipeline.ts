import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import type { ImageRef, ImageResult } from './types';

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
try {
  const mod = await import('sharp') as unknown as { default: (src: string) => SharpImage };
  sharpFn = mod.default;
} catch {
  // sharp not available — fall through to copy-only
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

  const results: ImageResult[] = [];
  for (const ref of refs) {
    const possiblePaths = [
      resolve(appDir, ref.src),
      resolve(appDir, '..', 'public', ref.src.replace(/^\//, '')),
      resolve(appDir, '..', 'src', ref.src.replace(/^\//, '')),
      resolve(outDir, 'static', 'public', ref.src.replace(/^\//, '')),
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
