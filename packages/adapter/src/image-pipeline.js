import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, extname, dirname, relative, sep } from 'path';

const SUPPORTED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff']);
const OUTPUT_WIDTHS = [640, 768, 1024, 1280, 1536];
const FORMATS = ['webp', 'avif'];

let sharp = null;
try {
  const mod = await import('sharp');
  sharp = mod.default;
} catch {
  // sharp not available — fall through to copy-only
}

async function processImage(srcPath, outDir, baseName) {
  const image = sharp ? sharp(srcPath) : null;

  if (!image) {
    // No sharp: copy original to each width slot so srcset still resolves
    const original = readFileSync(srcPath);
    for (const w of OUTPUT_WIDTHS) {
      const dir = resolve(outDir, `${baseName}-${w}w`);
      mkdirSync(dirname(dir), { recursive: true });
      writeFileSync(dir, original);
    }
    return [];
  }

  const meta = await image.metadata();
  const originalWidth = meta.width || 1920;
  const generated = [];

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

function collectImageRefs(appDir) {
  const refs = [];

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = resolve(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry.startsWith('.')) continue;
        walk(full);
      } else if (entry === 'page.vsk') {
        const src = readFileSync(full, 'utf-8');
        const imgRegex = /<Image\s+src=["']([^"']+)["']/g;
        let m;
        while ((m = imgRegex.exec(src)) !== null) {
          refs.push({ source: full, src: m[1] });
        }
      }
    }
  }

  walk(appDir);
  return refs;
}

export async function optimizeImages(appDir, outDir) {
  const imageOutDir = resolve(outDir, 'static', 'images');
  mkdirSync(imageOutDir, { recursive: true });

  const refs = collectImageRefs(appDir);
  if (refs.length === 0) {
    console.error(`vesk images: no <Image> refs found`);
    return [];
  }

  const results = [];
  for (const ref of refs) {
    const possiblePaths = [
      resolve(appDir, ref.src),
      resolve(appDir, '..', 'public', ref.src.replace(/^\//, '')),
      resolve(appDir, '..', 'src', ref.src.replace(/^\//, '')),
      resolve(outDir, 'static', 'public', ref.src.replace(/^\//, '')),
    ];

    let srcPath = null;
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

  if (sharp) {
    console.error(`vesk images: sharp pipeline — ${results.length} images processed`);
  } else {
    console.error(`vesk images: sharp not available — originals copied (install sharp for resizing)`);
  }

  return results;
}
