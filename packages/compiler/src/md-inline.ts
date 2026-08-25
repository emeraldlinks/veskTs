import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// =============================================================
// Inline resolution of <Md content="path/to/file.md"> attributes.
//
// When a `content="..."` attribute on an <Md> element is a static string
// ending in .md/.markdown, the file is read at COMPILE time and inlined
// into the source as a module-level const, so SSR, client chunks, SSG and
// production all work without runtime filesystem access.
//
// Resolution order for the specifier:
//   - './x.md' / '../x.md'  → relative to the importing .vsk file
//   - '/x.md'               → candidate roots (project dir / public),
//                             tried as <root>/public/x.md then <root>/x.md
// =============================================================

const MD_EXT_MARKER = '.md';

function looksLikeMarkdownPath(value: string): boolean {
	const v = value.trim();
	if (v.length === 0 || v.length > 4096) return false;
	if (v.includes('\n') || v.includes('\r')) return false;
	const lower = v.toLowerCase();
	return lower.endsWith(MD_EXT_MARKER) || lower.endsWith('.markdown');
}

function isRelativeSpecifier(v: string): boolean {
	return v.startsWith('./') || v.startsWith('../');
}

/** Walks up from `start` looking for the first directory containing `marker`. */
function findUp(start: string, marker: string): string | null {
	let cur = start;
	for (let i = 0; i < 32; i++) {
		if (existsSync(join(cur, marker))) return cur;
		const parent = dirname(cur);
		if (parent === cur) return null;
		cur = parent;
	}
	return null;
}

/**
 * Rewrites static `content="<file>.md"` attributes on <Md> elements into
 * inlined constants. Returns the transformed source; when nothing matches,
 * the original string is returned untouched.
 *
 * `mdRoots` are candidate project roots for absolute-style specifiers
 * ("/x.md"); each root is tried as <root>/public<x> and <root><x>.
 */
export function inlineMdContentAttrs(
	source: string,
	importerDir: string | null,
	mdRoots: string[] = [],
): string {
	if (!source.includes('content=') && !source.includes('content =')) return source;
	if (!importerDir && mdRoots.length === 0) return source;

	let out = '';
	let i = 0;
	const n = source.length;
	let counter = 0;
	const decls: string[] = [];
	const prefix = 'content=';

	while (i < n) {
		if (source.startsWith(prefix, i)) {
			// attribute position: ensure this is a JSX-ish attribute (preceded by whitespace/start)
			const prev = i > 0 ? source[i - 1] : ' ';
			if (prev === ' ' || prev === '\t' || prev === '\n' || prev === '\r') {
				let j = i + prefix.length;
				const quote = source[j];
				if (quote === '"' || quote === "'") {
					j++;
					const valStart = j;
					while (j < n && source[j] !== quote) j++;
					if (j < n) {
						const value = source.slice(valStart, j);
						if (looksLikeMarkdownPath(value)) {
							const abs = resolveMdPath(value, importerDir, mdRoots);
							if (abs !== null) {
								let contents: string;
								try {
									contents = readFileSync(abs, 'utf-8');
								} catch {
									out += source[i];
									i++;
									continue;
								}
								const varName = `__vesk_md_${counter++}`;
								decls.push(`const ${varName} = ${JSON.stringify(contents)};`);
								out += `${prefix}{${varName}}`;
								i = j + 1;
								continue;
							}
						}
					}
				}
			}
		}
		out += source[i];
		i++;
	}

	if (decls.length === 0) return source;
	return decls.join('\n') + '\n' + out;
}

function resolveMdPath(specifier: string, importerDir: string | null, roots: string[]): string | null {
	const spec = specifier.trim();
	if (isRelativeSpecifier(spec)) {
		if (!importerDir) return null;
		const abs = resolve(importerDir, spec);
		return existsSync(abs) ? abs : null;
	}
	if (spec.startsWith('/')) {
		for (const root of roots) {
			const pub = join(root, 'public', spec);
			if (existsSync(pub)) return pub;
			const direct = join(root, spec);
			if (existsSync(direct)) return direct;
		}
	}
	return null;
}

/**
 * Candidate project roots for absolute-style specifiers: walks up from
 * `dir` collecting directories that contain a package.json (bounded).
 */
export function guessProjectRoots(dir: string | null): string[] {
	if (!dir) return [];
	const roots: string[] = [];
	let cur = dir;
	for (let i = 0; i < 6; i++) {
		roots.push(cur);
		if (existsSync(join(cur, 'package.json'))) break;
		const parent = dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	return roots;
}

/** Convenience wrapper used by pipelines that already know the file dir. */
export function inlineMdImportsFrom(source: string, importerFile: string | null, mdRoots: string[] = []): string {
	const dir = importerFile ? dirname(importerFile) : null;
	return inlineMdContentAttrs(source, dir, mdRoots.length > 0 ? mdRoots : [dir || process.cwd()]);
}
