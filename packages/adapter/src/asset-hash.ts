/**
 * Content-addressed asset names and Subresource Integrity digests.
 *
 * Production assets are emitted under a content hash — `client.a1b2c3d4.js` —
 * so they can be served `immutable` and never go stale in a CDN, and so a
 * deploy that changes the runtime cannot be served the previous one. Dev keeps
 * the plain name: the dev server rewrites it on every edit and HMR needs a
 * stable URL.
 *
 * The digest is also the SRI value. Both come from the same bytes, so a tag
 * carrying `integrity` can only execute the file that was actually built.
 */
import { createHash } from 'node:crypto';

export interface AssetDigest {
  /** `client.a1b2c3d4e5.js` */
  fileName: string;
  /** 10 hex chars of the content hash, safe in a URL and a filename. */
  hash: string;
  bytes: number;
  /** `sha384-<base64>`, ready for an `integrity` attribute. */
  integrity: string;
}

const EXT_RE = /\.([a-z0-9]+)$/i;

/** `client.js` + bytes -> `client.a1b2c3d4e5.js` (the extension is preserved). */
export function hashedName(fileName: string, content: string | Buffer): string {
  const m = EXT_RE.exec(fileName);
  if (!m) return fileName;
  const base = fileName.slice(0, m.index);
  return `${base}.${hashOf(content)}${m[0]}`;
}

export function hashOf(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 10);
}

export function integrityOf(content: string | Buffer): string {
  return `sha384-${createHash('sha384').update(content).digest('base64')}`;
}

export function describeAsset(fileName: string, content: string | Buffer): AssetDigest {
  return {
    fileName: hashedName(fileName, content),
    hash: hashOf(content),
    bytes: typeof content === 'string' ? Buffer.byteLength(content) : content.length,
    integrity: integrityOf(content),
  };
}

/** Does this name carry a content hash? Used to pick the cache policy. */
export function isHashedName(fileName: string): boolean {
  const m = EXT_RE.exec(fileName);
  if (!m) return false;
  const base = fileName.slice(0, m.index);
  const dot = base.lastIndexOf('.');
  if (dot === -1) return false;
  const suffix = base.slice(dot + 1);
  return suffix.length === 10 && /^[0-9a-f]{10}$/.test(suffix);
}

/**
 * Cache-Control for a served asset.
 *
 * A hashed name means the bytes behind that URL can never change, so it is
 * immutable for a year. Anything else (dev bundles, `public/` files copied
 * verbatim, the unhashed name a prerendered page may still reference) must be
 * revalidated, or a deploy would serve stale code forever.
 */
export function cacheControlFor(fileName: string, isDev: boolean): string {
  if (isDev) return 'no-cache';
  return isHashedName(fileName)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';
}
