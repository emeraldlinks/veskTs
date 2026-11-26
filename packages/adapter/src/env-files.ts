import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENV_FILE_NAMES = ['.env', '.env.local'] as const;

export function isEnvWatchFile(relPath: string): boolean {
  const normalized = relPath.includes('\\') ? relPath.split('\\').join('/') : relPath;
  return normalized === '.env' || normalized === '.env.local';
}

const loadedValues = new Map<string, string>();
let loadedFor: string | null = null;

function readEnvFile(filePath: string, values: Map<string, string>): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
}

export function loadEnvFiles(projectDir: string): string[] {
  if (loadedFor !== projectDir) {
    loadedValues.clear();
    loadedFor = projectDir;
  }

  const values = new Map<string, string>();
  for (const name of ENV_FILE_NAMES) readEnvFile(join(projectDir, name), values);

  for (const [key, previous] of [...loadedValues]) {
    if (values.has(key)) continue;
    if (process.env[key] === previous) delete process.env[key];
    loadedValues.delete(key);
  }
  for (const [key, value] of values) {
    const previous = loadedValues.get(key);
    if (previous === undefined) {
      if (process.env[key] !== undefined) continue;
    } else if (process.env[key] !== undefined && process.env[key] !== previous) {
      loadedValues.delete(key);
      continue;
    }
    process.env[key] = value;
    loadedValues.set(key, value);
  }
  return [...values.keys()];
}
