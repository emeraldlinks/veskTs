/**
 * `vesk migrate` — apply the codemods a project needs.
 *
 * Version resolution: the project's installed `@vesk/*` versions (from
 * node_modules, which is what the app will actually build against), falling
 * back to the running CLI's own version. `--from`/`--to` override both, so a
 * migration can be rehearsed against a version the project has not adopted yet.
 *
 * Output is a report either way: what would change, what changed, and what a
 * human still has to do. A codemod that cannot parse a file says so instead of
 * skipping it silently.
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { applicableCodemods, type Codemod } from './codemods.js';

const SCAN_EXTENSIONS = new Set(['.vsk', '.ts', '.tsx', '.mjs', '.js']);
const SKIP_DIRS = new Set(['node_modules', '.vesk', 'dist', 'build', '.git', '.next', 'coverage']);

/** The Vesk version this project has installed, or null when unknown. */
export function detectInstalledVersion(projectDir: string, cliVersion: string): { version: string; source: string } {
  for (const pkg of ['@vesk/vesk-cli', '@vesk/adapter', '@vesk/compiler']) {
    const p = join(projectDir, 'node_modules', pkg, 'package.json');
    if (!existsSync(p)) continue;
    try {
      const version = JSON.parse(readFileSync(p, 'utf-8')).version;
      if (typeof version === 'string' && version) return { version, source: pkg };
    } catch {
      // unreadable package.json — fall through to the next candidate
    }
  }
  return { version: cliVersion, source: 'this CLI' };
}

/** Every migratable file under a directory, project-relative, sorted. */
export function collectTargets(dir: string, root = dir): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectTargets(full, root));
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      out.push(relative(root, full));
    }
  }
  return out;
}

export interface MigrateOptions {
  projectDir: string;
  cliVersion: string;
  from?: string;
  to?: string;
  only?: string[];
  dryRun?: boolean;
}

export interface MigrateReport {
  from: string;
  fromSource: string;
  to: string;
  /** Whether the run was a rehearsal (nothing written). */
  dryRun: boolean;
  codemods: string[];
  filesChanged: string[];
  notes: string[];
  skipped: string[];
}

/**
 * Run the applicable codemods over a project.
 *
 * Files are written only when a codemod produced a change, and only under the
 * project's own directories — never into node_modules, never into a build
 * output dir (a codemod must not rewrite its own input).
 */
export function runMigrate(options: MigrateOptions): MigrateReport {
  const detected = detectInstalledVersion(options.projectDir, options.cliVersion);
  const from = options.from || detected.version;
  const to = options.to || detected.version;
  // `to` is only a restriction when the user passed it: otherwise "migrate me
  // to the current version" must still run every codemod the project is behind.
  const codemods = applicableCodemods(from, options.to, options.only);

  const report: MigrateReport = {
    from,
    fromSource: detected.source,
    to,
    dryRun: options.dryRun === true,
    codemods: codemods.map((c) => c.id),
    filesChanged: [],
    notes: [],
    skipped: [],
  };

  if (codemods.length === 0) {
    report.notes.push(`no codemods apply to a project at ${from} (target ${to}) — nothing to do`);
    return report;
  }

  for (const relPath of collectTargets(options.projectDir)) {
    const abs = join(options.projectDir, relPath);
    const ctx = { filePath: abs, displayPath: relPath, projectDir: options.projectDir };
    if (!existsSync(abs)) continue;
    let source: string;
    try {
      source = readFileSync(abs, 'utf-8');
    } catch (e) {
      report.skipped.push(`${relPath}: unreadable (${(e as Error).message})`);
      continue;
    }
    const applicable = codemods.filter((c: Codemod) => c.appliesTo(abs));
    if (applicable.length === 0) continue;

    let current = source;
    let changed = false;
    for (const codemod of applicable) {
      let result;
      try {
        result = codemod.run(current, ctx);
      } catch (e) {
        report.skipped.push(`${relPath}: ${codemod.id} failed (${(e as Error).message})`);
        continue;
      }
      report.notes.push(...result.notes);
      if (result.code !== null && result.code !== current) {
        current = result.code;
        changed = true;
      }
    }
    if (!changed) continue;
    report.filesChanged.push(relPath);
    if (!options.dryRun) writeFileSync(abs, current, 'utf-8');
  }

  return report;
}
