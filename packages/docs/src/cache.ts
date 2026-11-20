import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IntelligenceDiagnostic, ProjectIntelligence, RouteRecord, SchemaRecord } from '@vesk/docs/src/ir';

export interface CachedRoute {
  hash: string;
  dependencies: string[];
  route: RouteRecord;
  schemas: SchemaRecord[];
  diagnostics: IntelligenceDiagnostic[];
}

export interface IntelligenceCacheFile {
  version: 1;
  generatorVersion: string;
  routes: Record<string, CachedRoute>;
}

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashFiles(files: string[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(file);
    try {
      hash.update(readFileSync(file, 'utf8'));
    } catch {
      hash.update('<missing>');
    }
  }
  return hash.digest('hex');
}

export function cachePath(projectRoot: string, cacheDir: string | undefined): string {
  return resolve(projectRoot, cacheDir ?? '.vesk/intelligence', 'analysis.json');
}

export function loadCache(file: string, generatorVersion: string): IntelligenceCacheFile | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as IntelligenceCacheFile;
    if (parsed.version !== 1 || parsed.generatorVersion !== generatorVersion || typeof parsed.routes !== 'object' || parsed.routes === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCache(file: string, data: IntelligenceCacheFile): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function projectIntelligenceHash(intelligence: ProjectIntelligence): string {
  return hashText(JSON.stringify(intelligence));
}
