import { pathToFileURL } from 'node:url';

function isWindowsDrivePath(p: string): boolean {
  if (p.length < 3 || p[1] !== ':') return false;
  const code = p.charCodeAt(0);
  const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  return isLetter && (p[2] === '/' || p[2] === '\\');
}

/**
 * Build a `file:` URL suitable for dynamic `import()` from a filesystem path.
 * Node's ESM loader rejects bare absolute paths on Windows (`C:\...` is read as
 * the `c:` protocol), so every generated-module import goes through here.
 */
export function fileImportUrl(filePath: string, cacheBust?: string | number): string {
  let url: URL;
  if (process.platform !== 'win32' && isWindowsDrivePath(filePath)) {
    const parts = filePath.split('\\').join('/').split('/');
    const drive = parts[0];
    const tail = parts.slice(1).map(part => encodeURIComponent(part)).join('/');
    url = new URL(`file:///${drive}/${tail}`);
  } else {
    url = pathToFileURL(filePath);
  }
  if (cacheBust !== undefined) url.searchParams.set('t', String(cacheBust));
  return url.href;
}
