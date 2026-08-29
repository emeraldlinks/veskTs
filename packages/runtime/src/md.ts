import type { HydrateWalker } from '@vesk/runtime/src/hydrate';
import { effect } from '@vesk/runtime/src/ripple-blocks';
import { tracked, get, set } from '@vesk/runtime/src/ripple-runtime';
import type { Tracked } from '@vesk/runtime/src/ripple-runtime';
import { getSsrData, setSsrData } from '@vesk/runtime/src/resource';

// =============================================================
// Markdown rendering for <Md content={...} />.
//
// Tokenizer-based (no regex) — mirrors the compiler's no-regex
// rule for source-text handling. Raw HTML is never passed through;
// everything is escaped so content is safe to render as-is.
//
// renderMarkdown(md) keeps its legacy output shape byte-compatible.
// <Md> opts into the advanced pipeline (syntax highlighting, code
// chrome, heading anchors, autolinks, hard breaks) and can be tuned
// via props (css / lineNumbers / copy / highlight / ids / autolink).
//
// `content` accepts a plain string, a tracked cell, a useFetch.stream()
// resource, or an absolute public markdown path (runtime-loaded) —
// cells/resources are unwrapped for rendering and, on the client,
// subscribed so the rendered markdown updates reactively.
// =============================================================

/** Unwraps tracked cells passed as props (compiler emits the cell itself). */
function unwrapMaybeCell(v: unknown): unknown {
	if (v !== null && typeof v === 'object' && typeof (v as { get?: unknown }).get === 'function') {
		try {
			return (v as { get: () => unknown }).get();
		} catch {
			return v;
		}
	}
	return v;
}

function isCell(v: unknown): boolean {
	return v !== null && typeof v === 'object' && typeof (v as { get?: unknown }).get === 'function';
}

export function escapeHtml(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '&') out += '&amp;';
		else if (ch === '<') out += '&lt;';
		else if (ch === '>') out += '&gt;';
		else if (ch === '"') out += '&quot;';
		else out += ch;
	}
	return out;
}

function isBlank(line: string): boolean {
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch !== ' ' && ch !== '\t') return false;
	}
	return true;
}

function leadingSpaces(line: string): number {
	let n = 0;
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '\t') n += 4 - (n % 4);
		else if (line[i] === ' ') n++;
		else break;
	}
	return n;
}

function headingLevel(line: string): number {
	let n = 0;
	while (n < line.length && line[n] === '#') n++;
	if (n === 0 || n > 6) return 0;
	if (n < line.length && (line[n] === ' ' || line[n] === '\t')) return n;
	return 0;
}

function isHr(line: string): boolean {
	const t = line.trim();
	if (t.length < 3) return false;
	const ch = t[0];
	if (ch !== '-' && ch !== '*' && ch !== '_') return false;
	for (let i = 1; i < t.length; i++) {
		if (t[i] !== ch && t[i] !== ' ') return false;
	}
	return true;
}

interface FenceInfo {
	char: string;
	len: number;
	info: string;
}

function fenceInfo(line: string): FenceInfo | null {
	const t = line.trim();
	const ch = t[0];
	if (ch !== '`' && ch !== '~') return null;
	let n = 0;
	while (n < t.length && t[n] === ch) n++;
	if (n < 3) return null;
	return { char: ch, len: n, info: t.slice(n).trim() };
}

function fenceLang(info: string): string {
	// Info string: first whitespace-delimited token is the language.
	let i = 0;
	while (i < info.length && info[i] !== ' ' && info[i] !== '\t') i++;
	return info.slice(0, i).toLowerCase();
}

interface FenceMeta {
	lang: string;
	params: Record<string, string>;
}

/**
 * Parses a fenced info string: the first token is the language, remaining
 * whitespace-separated tokens are key=value params. Values may contain
 * parentheses (rgb()/rgba()) without breaking the split. Unknown keys are
 * preserved so callers can extend.
 */
function parseFenceMeta(info: string): FenceMeta {
	const tokens: string[] = [];
	let cur = '';
	let depth = 0;
	for (let i = 0; i < info.length; i++) {
		const ch = info[i];
		if (ch === '(') depth++;
		if (ch === ')') depth = Math.max(0, depth - 1);
		if ((ch === ' ' || ch === '\t') && depth === 0) {
			if (cur) { tokens.push(cur); cur = ''; }
			continue;
		}
		cur += ch;
	}
	if (cur) tokens.push(cur);

	const lang = tokens.length > 0 ? tokens[0].toLowerCase() : '';
	const params: Record<string, string> = {};
	for (let k = 1; k < tokens.length; k++) {
		const eq = tokens[k].indexOf('=');
		if (eq === -1) continue;
		const key = tokens[k].slice(0, eq).toLowerCase();
		let val = tokens[k].slice(eq + 1);
		// tolerate shell-ish quoting from pasted examples
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (key) params[key] = val;
	}
	return { lang, params };
}

/** Color functions permitted inside bg=/fg= values; anything else with
 *  parentheses (url(), var(), expression tricks) is rejected. */
const COLOR_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix']);

/** Allows only safe CSS color-ish characters into inline style output. */
function safeColorValue(v: string): string | null {
	if (v === '' || v.length > 64) return null;
	const out: string[] = [];
	let word = '';
	for (const ch of v) {
		const ok =
			(ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') ||
			ch === '#' || ch === '%' || ch === '(' || ch === ')' || ch === ',' || ch === '.' ||
			ch === '-' || ch === ' ';
		if (!ok) return null;
		if (isIdentStart(ch) || isDigit(ch)) word += ch.toLowerCase();
		if (ch === '(') {
			const fnName = word.slice(0, -1);
			if (!COLOR_FUNCS.has(fnName)) return null;
		}
		if (!isIdentPart(ch)) word = '';
		out.push(ch);
	}
	return out.join('').trim() || null;
}

function isFenceClose(line: string, char: string, len: number): boolean {
	const t = line.trim();
	if (t[0] !== char) return false;
	let n = 0;
	while (n < t.length && t[n] === char) n++;
	if (n < len) return false;
	for (let i = n; i < t.length; i++) {
		if (t[i] !== ' ') return false;
	}
	return true;
}

interface ListMarker {
	ordered: boolean;
	number: number;
	indent: number;
	contentStart: number;
}

function parseListMarker(line: string): ListMarker | null {
	const indent = leadingSpaces(line);
	let i = indent;
	const ch = line[i];
	if (ch === '-' || ch === '*' || ch === '+') {
		if (i + 1 < line.length && (line[i + 1] === ' ' || line[i + 1] === '\t')) {
			return { ordered: false, number: 0, indent, contentStart: i + 2 };
		}
		return null;
	}
	let num = 0;
	const digitsStart = i;
	while (i < line.length && line[i] >= '0' && line[i] <= '9') {
		num = num * 10 + (line.charCodeAt(i) - 48);
		i++;
	}
	if (i === digitsStart) return null;
	if (i < line.length && line[i] === '.' && i + 1 < line.length && (line[i + 1] === ' ' || line[i + 1] === '\t')) {
		return { ordered: true, number: num, indent, contentStart: i + 2 };
	}
	return null;
}

// ── Tables ───────────────────────────────────────────────────

function splitTableRow(line: string): string[] | null {
	const t = line.trim();
	if (t.length === 0) return null;
	let start = 0;
	let end = t.length;
	if (t[0] === '|') start = 1;
	if (t[end - 1] === '|' && end - 1 > 0 && t[end - 2] !== '\\') end--;
	const cells: string[] = [];
	let cell = '';
	let i = start;
	while (i < end) {
		const ch = t[i];
		if (ch === '\\' && i + 1 < end && (t[i + 1] === '|' || t[i + 1] === '\\')) {
			cell += t[i + 1];
			i += 2;
			continue;
		}
		if (ch === '|') {
			cells.push(cell.trim());
			cell = '';
			i++;
			continue;
		}
		cell += ch;
		i++;
	}
	cells.push(cell.trim());
	return cells;
}

function isTableSepRow(line: string): boolean {
	const t = line.trim();
	if (t.length < 3) return false;
	let sawDash = false;
	for (let i = 0; i < t.length; i++) {
		const ch = t[i];
		if (ch === '-' ) { sawDash = true; continue; }
		if (ch === ':' || ch === '|' || ch === ' ' || ch === '\t') continue;
		return false;
	}
	return sawDash;
}

type Align = 'left' | 'center' | 'right' | null;

function parseAlignRow(cells: string[]): Align[] {
	const out: Align[] = [];
	for (const c of cells) {
		const left = c.startsWith(':');
		const right = c.endsWith(':') && c.length > (left ? 1 : 0);
		if (left && right) out.push('center');
		else if (right) out.push('right');
		else if (left) out.push('left');
		else out.push(null);
	}
	return out;
}

/** A table row needs a non-empty delimiter row on the next line. */
function looksLikeTable(lines: string[], i: number): boolean {
	const row = lines[i].trim();
	if (!row.includes('|')) return false;
	if (row[0] !== '|' && !row.includes(' | ') && !(row.length > 1 && row[row.length - 1] === '|')) {
		// single column without pipes is not a table
		if (!row.startsWith('|')) return false;
	}
	const sep = lines[i + 1];
	if (sep === undefined) return false;
	if (!isTableSepRow(sep)) return false;
	if (!sep.includes('|') && row.includes('|')) {
		// allow single-column tables where sep has no pipe
	}
	return true;
}

type Block =
	| { type: 'paragraph'; text: string; lines?: string[] }
	| { type: 'heading'; level: number; text: string }
	| { type: 'hr' }
	| { type: 'code'; code: string; lang: string; info: string }
	| { type: 'blockquote'; blocks: Block[] }
	| { type: 'list'; ordered: boolean; start: number; items: Array<{ blocks: Block[]; task: boolean | null }> }
	| { type: 'table'; head: string[]; align: Align[]; rows: string[][] };

/** Setext underline: a row of '=' (h1) or '-' (h2) directly under a paragraph. */
function setextLevel(line: string): number {
	const t = line.trim();
	if (t.length === 0) return 0;
	let allEq = true;
	let allDash = true;
	for (let i = 0; i < t.length; i++) {
		if (t[i] !== '=') allEq = false;
		if (t[i] !== '-') allDash = false;
		if (!allEq && !allDash) return 0;
	}
	if (allEq) return 1;
	if (allDash) return 2;
	return 0;
}

function parseBlocks(lines: string[]): Block[] {
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (isBlank(line)) {
			i++;
			continue;
		}

		const trimmed = line.trim();
		const indent = leadingSpaces(line);

		const fence = fenceInfo(trimmed);
		if (fence) {
			const codeLines: string[] = [];
			i++;
			while (i < lines.length) {
				const l = lines[i];
				if (isFenceClose(l, fence.char, fence.len)) {
					i++;
					break;
				}
				codeLines.push(l);
				i++;
			}
			blocks.push({ type: 'code', code: codeLines.join('\n'), lang: fenceLang(fence.info), info: fence.info });
			continue;
		}

		if (indent >= 4) {
			const codeLines: string[] = [];
			while (i < lines.length) {
				const l = lines[i];
				if (isBlank(l)) {
					codeLines.push('');
					i++;
					continue;
				}
				const lIndent = leadingSpaces(l);
				if (lIndent < 4) break;
				codeLines.push(l.slice(4));
				i++;
			}
			while (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') codeLines.pop();
			blocks.push({ type: 'code', code: codeLines.join('\n'), lang: '', info: '' });
			continue;
		}

		const level = headingLevel(line);
		if (level > 0) {
			blocks.push({ type: 'heading', level, text: line.slice(level).trim() });
			i++;
			continue;
		}

		if (isHr(line)) {
			blocks.push({ type: 'hr' });
			i++;
			continue;
		}

		if (looksLikeTable(lines, i)) {
			const head = splitTableRow(lines[i]) || [];
			const sepCells = splitTableRow(lines[i + 1]) || [];
			if (sepCells.length !== head.length) {
				// delimiter count must match header count (GFM)
				blocks.push({ type: 'paragraph', text: trimmed });
				i++;
				continue;
			}
			const align = parseAlignRow(sepCells);
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length) {
				const l = lines[i];
				if (isBlank(l)) break;
				if (!l.includes('|')) break;
				const cells = splitTableRow(l);
				if (!cells) break;
				rows.push(cells);
				i++;
			}
			blocks.push({ type: 'table', head, align, rows });
			continue;
		}

		if (trimmed[0] === '>') {
			const quoteLines: string[] = [];
			while (i < lines.length) {
				const l = lines[i];
				const t = l.trim();
				if (isBlank(l)) break;
				if (t[0] !== '>') break;
				let rest = t.length > 1 ? t.slice(1) : '';
				if (rest[0] === ' ') rest = rest.slice(1);
				quoteLines.push(rest);
				i++;
			}
			blocks.push({ type: 'blockquote', blocks: parseBlocks(quoteLines) });
			continue;
		}

		const marker = parseListMarker(line);
		if (marker) {
			const list: Block = {
				type: 'list',
				ordered: marker.ordered,
				start: marker.number,
				items: [],
			};
			while (i < lines.length) {
				const l = lines[i];
				const m = parseListMarker(l);
				if (!m) break;
				if (m.ordered !== list.ordered) break;
				const contentIndent = m.contentStart;
				let first = l.slice(m.contentStart);
				let task: boolean | null = null;
				// GFM task item: [ ] / [x] / [X] directly after the marker.
				if (first.startsWith('[ ] ')) { task = false; first = first.slice(4); }
				else if (first.startsWith('[x] ') || first.startsWith('[X] ')) { task = true; first = first.slice(4); }
				const itemLines: string[] = [first];
				i++;
				while (i < lines.length) {
					const c = lines[i];
					if (isBlank(c)) {
						i++;
						continue;
					}
					const cm = parseListMarker(c);
					const cIndent = leadingSpaces(c);
					if (cm && cIndent < contentIndent && cm.ordered === m.ordered) break;
					if (cIndent >= contentIndent) {
						itemLines.push(c.slice(Math.min(c.length, contentIndent)));
						i++;
						continue;
					}
					break;
				}
				list.items.push({ blocks: parseBlocks(itemLines), task });
			}
			blocks.push(list);
			continue;
		}

		const paraLines: string[] = [line.slice(leadingSpaces(line))];
		i++;
		while (i < lines.length) {
			const l = lines[i];
			if (isBlank(l)) break;
			const t = l.trim();
			if (setextLevel(t) > 0) break;
			if (headingLevel(l) > 0) break;
			if (isHr(l)) break;
			if (fenceInfo(t)) break;
			if (t[0] === '>') break;
			if (parseListMarker(l)) break;
			if (leadingSpaces(l) >= 4) break;
			paraLines.push(l.slice(leadingSpaces(l)));
			i++;
		}
		const joined = paraLines.join(' ');
		// Setext heading: the underline directly terminates the paragraph.
		if (i < lines.length && paraLines.length > 0) {
			const lv = setextLevel(lines[i].trim());
			if (lv > 0) {
				blocks.push({ type: 'heading', level: lv, text: joined });
				i++;
				continue;
			}
		}
		blocks.push({ type: 'paragraph', text: joined, lines: paraLines });
	}
	return blocks;
}

// ── URL safety ───────────────────────────────────────────────

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/** Allows http/https/mailto/tel plus relative URLs; anything else → '#'. */
export function sanitizeUrl(url: string): string {
	const u = url.trim();
	if (u === '') return '#';
	// find scheme delimiter before any path-ish char
	for (let i = 0; i < u.length; i++) {
		const ch = u[i];
		if (ch === ':') {
			const scheme = u.slice(0, i + 1).toLowerCase();
			for (const s of SAFE_SCHEMES) {
				if (scheme === s) return u;
			}
			return '#';
		}
		if (ch === '/' || ch === '?' || ch === '#' || ch === '&') break;
	}
	return u;
}

// ── Reference link definitions ───────────────────────────────

interface RefDef {
	url: string;
	title: string;
}

function normalizeRefLabel(label: string): string {
	return label.trim().toLowerCase();
}

/**
 * Parses one `[label]: destination "title"` definition line (single-line form).
 * Returns null when the line is not a definition.
 */
function parseRefDefinitionLine(rawLine: string): { label: string; def: RefDef } | null {
	const line = rawLine.trim();
	if (line.length < 4 || line[0] !== '[') return null;
	let depth = 1;
	let j = 1;
	while (j < line.length) {
		const c = line[j];
		if (c === '\\') { j += 2; continue; }
		if (c === '[') depth++;
		else if (c === ']') {
			depth--;
			if (depth === 0) break;
		}
		j++;
	}
	if (j >= line.length || line[j] !== ']') return null;
	const label = line.slice(1, j);
	if (label.trim() === '') return null;
	if (line[j + 1] !== ':') return null;
	let rest = line.slice(j + 2);
	// optional whitespace incl. up to one newline equivalent (we are single-line)
	while (rest.length > 0 && (rest[0] === ' ' || rest[0] === '\t')) rest = rest.slice(1);
	if (rest === '') return null;

	let dest: string;
	if (rest[0] === '<') {
		const close = rest.indexOf('>');
		if (close === -1) return null;
		dest = rest.slice(1, close);
		rest = rest.slice(close + 1);
		if (dest.includes('<')) return null;
	} else {
		let e = 0;
		while (e < rest.length && rest[e] !== ' ' && rest[e] !== '\t') e++;
		dest = rest.slice(0, e);
		rest = rest.slice(e);
	}
	if (dest === '') return null;

	let title = '';
	const trimmedRest = rest.trim();
	if (trimmedRest !== '') {
		// Definition tail is a bare title: "…", '…' or (…) occupying the rest.
		const open = trimmedRest[0];
		if (open !== '"' && open !== '\'' && open !== '(') return null;
		const close = open === '(' ? ')' : open;
		let m = 1;
		const titleChars: string[] = [];
		let closed = false;
		while (m < trimmedRest.length) {
			const c = trimmedRest[m];
			if (c === '\\' && m + 1 < trimmedRest.length) { titleChars.push(trimmedRest[m + 1]); m += 2; continue; }
			if (c === close) { closed = true; m++; break; }
			titleChars.push(c);
			m++;
		}
		if (!closed) return null;
		while (m < trimmedRest.length && (trimmedRest[m] === ' ' || trimmedRest[m] === '\t')) m++;
		if (m < trimmedRest.length) return null;
		title = titleChars.join('');
	}
	return { label, def: { url: dest, title } };
}

/**
 * Collects top-level reference definitions and returns the remaining lines
 * with those definitions removed. Fenced code contents are never treated as
 * definitions.
 */
function extractRefDefinitions(lines: string[]): { lines: string[]; defs: Map<string, RefDef> } {
	const defs = new Map<string, RefDef>();
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const fence = fenceInfo(line.trim());
		if (fence) {
			out.push(line);
			i++;
			while (i < lines.length) {
				out.push(lines[i]);
				const isClose = isFenceClose(lines[i], fence.char, fence.len);
				i++;
				if (isClose) break;
			}
			continue;
		}
		const parsed = parseRefDefinitionLine(line);
		if (parsed && !defs.has(normalizeRefLabel(parsed.label))) {
			defs.set(normalizeRefLabel(parsed.label), parsed.def);
			i++;
			continue;
		}
		out.push(line);
		i++;
	}
	return { lines: out, defs };
}

// ── Syntax highlighting (tokenizer, no regex) ────────────────

interface LangProfile {
	keywords: Set<string>;
	literals?: Set<string>;
	lineComments?: string[];
	blockComments?: Array<[string, string]>;
	strings?: string[];
	types?: Set<string>;
	highlightHashComment?: boolean;
}

const KW_JS = new Set([
	'abstract','as','async','await','break','case','catch','class','const','continue',
	'debugger','declare','default','delete','do','else','enum','export','extends','finally',
	'for','from','function','get','if','implements','import','in','infer','instanceof',
	'interface','is','keyof','let','namespace','new','of','private','protected','public',
	'readonly','return','satisfies','set','static','super','switch','this','throw','try',
	'type','typeof','var','void','while','with','yield',
	'string','number','boolean','any','unknown','never','object','symbol','bigint',
]);
const KW_VSK = new Set([...KW_JS, 'component']);
const LIT_JS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

const KW_PY = new Set([
	'and','as','assert','async','await','break','class','continue','def','del','elif',
	'else','except','finally','for','from','global','if','import','in','is','lambda',
	'nonlocal','not','or','pass','raise','return','try','while','with','yield','match','case',
]);
const LIT_PY = new Set(['True', 'False', 'None', 'self', 'cls']);

const KW_GO = new Set([
	'break','case','chan','const','continue','default','defer','else','fallthrough','for',
	'func','go','goto','if','import','interface','map','package','range','return','select',
	'struct','switch','type','var',
]);
const LIT_GO = new Set(['true', 'false', 'nil', 'iota']);

const KW_RUST = new Set([
	'as','async','await','break','const','continue','crate','dyn','else','enum','extern',
	'fn','for','if','impl','in','let','loop','match','mod','move','mut','pub','ref',
	'return','self','Self','static','struct','super','trait','type','unsafe','use','where','while',
]);
const LIT_RUST = new Set(['true', 'false', 'None', 'Some', 'Ok', 'Err']);

const KW_SQL = new Set([
	'select','from','where','insert','into','values','update','set','delete','create','table',
	'drop','alter','add','column','primary','key','foreign','references','join','inner','left',
	'right','outer','full','on','group','by','order','having','limit','offset','union','all',
	'distinct','as','and','or','not','null','is','in','between','like','exists','case','when',
	'then','else','end','index','view','with','returning',
]);

const KW_BASH = new Set([
	'if','then','else','elif','fi','for','while','until','do','done','case','esac','in',
	'function','return','local','export','source','alias','set','unset','shift','read','echo',
	'cd','exit','trap',
]);

function kwSet(items: string[]): Set<string> {
	return new Set(items);
}

function profileFor(lang: string): LangProfile | null {
	if (lang === '' ) return null;
	if (lang === 'vsk' || lang === 'vesk') {
		return { keywords: KW_VSK, literals: LIT_JS, lineComments: ['//'], blockComments: [['/*', '*/']], strings: ['"', "'", '`'] };
	}
	if (lang === 'js' || lang === 'javascript' || lang === 'mjs' || lang === 'cjs'
		|| lang === 'ts' || lang === 'typescript' || lang === 'tsx' || lang === 'jsx') {
		return { keywords: KW_JS, literals: LIT_JS, lineComments: ['//'], blockComments: [['/*', '*/']], strings: ['"', "'", '`'] };
	}
	if (lang === 'json' || lang === 'jsonc' || lang === 'json5') {
		return { keywords: new Set(), literals: LIT_JS, lineComments: lang === 'json' ? [] : ['//'], blockComments: lang === 'json' ? [] : [['/*', '*/']], strings: ['"'] };
	}
	if (lang === 'py' || lang === 'python') {
		return { keywords: KW_PY, literals: LIT_PY, lineComments: ['#'], strings: ['"', "'"] };
	}
	if (lang === 'go') {
		return { keywords: KW_GO, literals: LIT_GO, lineComments: ['//'], blockComments: [['/*', '*/']], strings: ['"', "'", '`'] };
	}
	if (lang === 'rs' || lang === 'rust') {
		return { keywords: KW_RUST, literals: LIT_RUST, lineComments: ['//'], blockComments: [['/*', '*/']], strings: ['"'] };
	}
	if (lang === 'sql' || lang === 'postgres' || lang === 'mysql' || lang === 'sqlite') {
		return { keywords: KW_SQL, lineComments: ['--'], blockComments: [['/*', '*/']], strings: ["'"] };
	}
	if (lang === 'sh' || lang === 'bash' || lang === 'shell' || lang === 'zsh') {
		return { keywords: KW_BASH, literals: new Set(['true', 'false']), lineComments: ['#'], strings: ['"', "'"] };
	}
	if (lang === 'yaml' || lang === 'yml' || lang === 'toml') {
		return { keywords: new Set(), literals: LIT_PY, lineComments: ['#'], strings: ['"', "'"], highlightHashComment: true };
	}
	if (lang === 'java' || lang === 'kt' || lang === 'kotlin' || lang === 'swift' || lang === 'c' || lang === 'cpp' || lang === 'cs' || lang === 'csharp' || lang === 'php' || lang === 'dart' || lang === 'scala' || lang === 'zig') {
		return { keywords: kwSet(['abstract','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','fun','func','if','implements','import','in','instanceof','int','interface','is','let','long','namespace','new','null','override','package','private','protected','public','return','short','signed','static','struct','super','switch','synchronized','template','this','throw','throws','trait','try','type','typedef','typeof','union','unsigned','val','var','void','volatile','when','where','while','using','public','ref','fn','impl']), literals: LIT_JS, lineComments: ['//'], blockComments: [['/*', '*/']], strings: ['"', "'"] };
	}
	return null;
}

function isIdentStart(ch: string): boolean {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}
function isIdentPart(ch: string): boolean {
	return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}
function isDigit(ch: string): boolean {
	return ch >= '0' && ch <= '9';
}
function isHexDigit(ch: string): boolean {
	return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

/**
 * Highlights `code` as `lang` into class-tokenized HTML. Everything is
 * escaped; unknown languages fall back to escaped plain text. Supported:
 * js/ts/jsx/tsx/vsk/vesk family, json, python, go, rust, sql, bash/shell, yaml/toml,
 * css/scss, html/xml/svg/vue/svelte, diff/patch.
 */
export function highlightCode(code: string, lang: string): string {
	if (lang === 'diff' || lang === 'patch') return highlightDiff(code);
	if (lang === 'css' || lang === 'scss' || lang === 'less' || lang === 'postcss') return highlightCss(code);
	if (lang === 'html' || lang === 'xml' || lang === 'svg' || lang === 'vue' || lang === 'svelte') return highlightHtml(code);
	const p = profileFor(lang);
	if (!p) return escapeHtml(code);

	let out = '';
	let i = 0;
	const n = code.length;
	let prevKw: string | null = null;

	const emit = (cls: string, text: string): void => {
		out += `<span class="tok-${cls}">${escapeHtml(text)}</span>`;
	};

	while (i < n) {
		const ch = code[i];

		// line comments
		let matchedLine = false;
		if (p.lineComments) {
			for (const lc of p.lineComments) {
				if (code.startsWith(lc, i)) {
					let j = i;
					while (j < n && code[j] !== '\n') j++;
					emit('com', code.slice(i, j));
					i = j;
					matchedLine = true;
					break;
				}
			}
		}
		if (matchedLine) continue;

		// block comments
		let matchedBlock = false;
		if (p.blockComments) {
			for (const [open, close] of p.blockComments) {
				if (code.startsWith(open, i)) {
					const endIdx = code.indexOf(close, i + open.length);
					const j = endIdx === -1 ? n : endIdx + close.length;
					emit('com', code.slice(i, j));
					i = j;
					matchedBlock = true;
					break;
				}
			}
		}
		if (matchedBlock) continue;

		// strings
		let matchedStr = false;
		if (p.strings) {
			for (const q of p.strings) {
				if (ch === q) {
					let j = i + 1;
					while (j < n) {
						if (code[j] === '\\') { j += 2; continue; }
						if (code[j] === q) { j++; break; }
						if (code[j] === '\n' && q !== '`') { break; }
						j++;
					}
					emit('str', code.slice(i, j));
					i = j;
					matchedStr = true;
					break;
				}
			}
		}
		if (matchedStr) continue;

		// numbers
		if (isDigit(ch) || (ch === '.' && i + 1 < n && isDigit(code[i + 1]))) {
			let j = i;
			while (j < n && (isDigit(code[j]) || code[j] === '.' || code[j] === '_'
				|| ((code[j] === 'x' || code[j] === 'b' || code[j] === 'o') && (j === i + 1 && (code[i] === '0')))
				|| ((code[j] === 'e' || code[j] === 'E') && j > i && (isDigit(code[j - 1]) || code[j - 1] === '.'))
				|| ((code[j] === '+' || code[j] === '-') && j > i && (code[j - 1] === 'e' || code[j - 1] === 'E')))) j++;
			emit('num', code.slice(i, j));
			i = j;
			continue;
		}

		// identifiers / keywords / calls
		if (isIdentStart(ch)) {
			let j = i;
			while (j < n && isIdentPart(code[j])) j++;
			const word = code.slice(i, j);
			let k = j;
			while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
			const isProp = code[k] === ':' || (code[k] === '?' && code[k + 1] === ':');
			const isTypeName = prevKw === 'type' || prevKw === 'interface';
			if (p.keywords.has(word)) {
				emit('kw', word);
				prevKw = (word === 'type' || word === 'interface') ? word : null;
			} else if (p.literals && p.literals.has(word)) {
				emit('lit', word);
				prevKw = null;
			} else if (code[k] === '(') {
				emit('fn', word);
				prevKw = null;
			} else if (isTypeName) {
				emit('fn', word);
				prevKw = null;
			} else if (isProp) {
				emit('prop', word);
				prevKw = null;
			} else {
				emit('txt', word);
				prevKw = null;
			}
			i = j;
			continue;
		} else {
			// reset prevKw on non-identifier that isn't whitespace
			if (ch !== ' ' && ch !== '\t' && ch !== '\n') prevKw = null;
		}

		if (ch === '\n') { out += '\n'; i++; continue; }
		if (ch === ' ' || ch === '\t') { out += ch; i++; continue; }
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

function highlightDiff(code: string): string {
	const lines = code.split('\n');
	let out = '';
	for (const line of lines) {
		let cls = 'txt';
		if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
		else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
		else if (line.startsWith('@@')) cls = 'kw';
		else if (line.startsWith('diff ') || line.startsWith('index ')) cls = 'com';
		out += `<span class="tok-${cls}">${escapeHtml(line)}</span>\n`;
	}
	return out;
}

function highlightCss(code: string): string {
	let out = '';
	let i = 0;
	const n = code.length;
	const emit = (cls: string, text: string) => { out += `<span class="tok-${cls}">${escapeHtml(text)}</span>`; };
	let inProp = false;
	while (i < n) {
		const ch = code[i];
		if (code.startsWith('/*', i)) {
			const end = code.indexOf('*/', i + 2);
			const j = end === -1 ? n : end + 2;
			emit('com', code.slice(i, j));
			i = j;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < n) {
				if (code[j] === '\\') { j += 2; continue; }
				if (code[j] === ch) { j++; break; }
				j++;
			}
			emit('str', code.slice(i, j));
			i = j;
			continue;
		}
		if (ch === '#' && isHexDigit(code[i + 1] || '')) {
			let j = i + 1;
			while (j < n && isHexDigit(code[j])) j++;
			emit('num', code.slice(i, j));
			i = j;
			continue;
		}
		if (ch === '@' && isIdentStart(code[i + 1] || '')) {
			let j = i + 1;
			while (j < n && (isIdentPart(code[j]) || code[j] === '-')) j++;
			emit('kw', code.slice(i, j));
			i = j;
			continue;
		}
		if (isDigit(ch) || (ch === '.' && isDigit(code[i + 1] || ''))) {
			let j = i;
			while (j < n && (isDigit(code[j]) || code[j] === '.' || code[j] === '%' || isIdentPart(code[j]))) j++;
			emit('num', code.slice(i, j));
			inProp = false;
			i = j;
			continue;
		}
		if (isIdentStart(ch)) {
			let j = i;
			while (j < n && (isIdentPart(code[j]) || code[j] === '-')) j++;
			const word = code.slice(i, j);
			let k = j;
			while (k < n && code[k] === ' ') k++;
			if (code[k] === ':' && code[k + 1] !== ':') { emit('prop', word); inProp = true; }
			else if (inProp) emit('txt', word);
			else if (word.startsWith('--')) emit('prop', word);
			else emit('sel', word);
			i = j;
			continue;
		}
		if (ch === '{' || ch === '}') { inProp = false; out += escapeHtml(ch); i++; continue; }
		if (ch === ':') { inProp = true; out += escapeHtml(ch); i++; continue; }
		if (ch === ';') { inProp = false; out += escapeHtml(ch); i++; continue; }
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

function highlightHtml(code: string): string {
	let out = '';
	let i = 0;
	const n = code.length;
	const emit = (cls: string, text: string) => { out += `<span class="tok-${cls}">${escapeHtml(text)}</span>`; };
	while (i < n) {
		if (code.startsWith('<!--', i)) {
			const end = code.indexOf('-->', i + 4);
			const j = end === -1 ? n : end + 3;
			emit('com', code.slice(i, j));
			i = j;
			continue;
		}
		if (code[i] === '<') {
			// tag
			let j = i + 1;
			if (code[j] === '/') j++;
			const nameStart = j;
			while (j < n && (isIdentPart(code[j]) || code[j] === '-')) j++;
			emit('kw', code.slice(i, j));
			i = j;
			// attributes until '>' or '/>'
			while (i < n && code[i] !== '>') {
				if (code.startsWith('/>', i)) break;
				const ch = code[i];
				if (ch === '"' || ch === "'") {
					let k = i + 1;
					while (k < n && code[k] !== ch) k++;
					k = Math.min(k + 1, n);
					emit('str', code.slice(i, k));
					i = k;
					continue;
				}
				if (isIdentStart(ch) || ch === '-' || ch === ':') {
					let k = i;
					while (k < n && (isIdentPart(code[k]) || code[k] === '-' || code[k] === ':')) k++;
					emit(code[k] === '=' ? 'attr' : 'attr', code.slice(i, k));
					i = k;
					continue;
				}
				out += escapeHtml(ch);
				i++;
			}
			if (code.startsWith('/>', i)) { out += escapeHtml('/>'); i += 2; }
			else if (i < n) { out += escapeHtml('>'); i++; }
			continue;
		}
		const next = code.indexOf('<', i);
		const j = next === -1 ? n : next;
		emit('txt', code.slice(i, j));
		i = j;
	}
	return out;
}

// ── Heading anchors ──────────────────────────────────────────

function stripMdMarkers(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '`' || ch === '*' || ch === '_' || ch === '~') { i++; continue; }
		if (ch === '\\') { out += text[i + 1] || ''; i += 2; continue; }
		if (ch === '[' || ch === ']') { i++; continue; }
		if (ch === '!') { i++; continue; }
		out += ch;
		i++;
	}
	return out;
}

function slugify(text: string): string {
	const plain = stripMdMarkers(text).toLowerCase().trim();
	let out = '';
	let lastDash = true;
	for (let i = 0; i < plain.length; i++) {
		const ch = plain[i];
		const ok = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
		if (ok) { out += ch; lastDash = false; continue; }
		if (!lastDash) { out += '-'; lastDash = true; }
	}
	while (out.endsWith('-')) out = out.slice(0, -1);
	return out || 'section';
}

// ── Autolinks ────────────────────────────────────────────────

function tryAutolink(text: string, i: number): { html: string; end: number } | null {
	let schemeLen = -1;
	let prefix = '';
	if (text.startsWith('https://', i)) { schemeLen = 8; prefix = ''; }
	else if (text.startsWith('http://', i)) { schemeLen = 7; prefix = ''; }
	else if (text.startsWith('mailto:', i)) { schemeLen = 7; prefix = ''; }
	else if (text.startsWith('www.', i) && (i === 0 || !isIdentPart(text[i - 1]))) { schemeLen = 0; prefix = 'https://'; }
	if (schemeLen === -1) return null;
	let j = i + schemeLen;
	let lastGood = j;
	let parenDepth = 0;
	while (j < text.length) {
		const ch = text[j];
		if (ch === ' ' || ch === '\t' || ch === '<' || ch === '"' || ch === '\'') break;
		if (ch === '(') parenDepth++;
		if (ch === ')') {
			if (parenDepth === 0) break;
			parenDepth--;
		}
		j++;
		// trailing punctuation does not belong to the link
		if (!(ch === '.' || ch === ',' || ch === ';' || ch === '!' || ch === '?' || ch === ':')) lastGood = j;
	}
	if (lastGood === i + schemeLen && schemeLen === 0) return null;
	const raw = text.slice(i, lastGood);
	const href = prefix + raw;
	return { html: `<a href="${escapeHtml(sanitizeUrl(href))}">${escapeHtml(raw)}</a>`, end: lastGood };
}

// ── Entities ─────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
	copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
	mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
	ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb',
	times: '\u00d7', divide: '\u00f7', plusmn: '\u00b1', deg: '\u00b0',
	middot: '\u00b7', bull: '\u2022', dagger: '\u2020', sect: '\u00a7',
	para: '\u00b6', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5',
	cent: '\u00a2', sup2: '\u00b2', sup3: '\u00b3', frac12: '\u00bd',
	frac14: '\u00bc', frac34: '\u00be', micro: '\u00b5', agrave: '\u00e0',
	eacute: '\u00e9', egrave: '\u00e8', uuml: '\u00fc', ouml: '\u00f6',
	auml: '\u00e4', szlig: '\u00df', ntilde: '\u00f1', ccedil: '\u00e7',
};

/**
 * Decodes an entity reference at text[i] and returns it re-escaped, so
 * `&copy;` renders © while `&lt;` still renders as visible "<" (the decoded
 * char goes back through escapeHtml). Returns null when there is no valid
 * reference — the caller escapes the '&' literally.
 */
function tryEntity(text: string, i: number): { html: string; end: number } | null {
	if (text[i] !== '&') return null;
	const n = text.length;
	if (text[i + 1] === '#') {
		let j = i + 2;
		let value = 0;
		if (text[j] === 'x' || text[j] === 'X') {
			j++;
			while (j < n && isHexDigit(text[j])) {
				value = value * 16 + parseInt(text[j], 16);
				j++;
			}
			if (j === i + 3) return null;
		} else {
			while (j < n && isDigit(text[j])) {
				value = value * 10 + (text.charCodeAt(j) - 48);
				j++;
			}
			if (j === i + 2) return null;
		}
		if (text[j] !== ';' || value === 0 || value > 0x10ffff) return null;
		return { html: escapeHtml(String.fromCodePoint(value)), end: j + 1 };
	}
	let j = i + 1;
	while (j < n && j <= i + 32 && isIdentPart(text[j])) j++;
	if (j === i + 1 || text[j] !== ';') return null;
	const name = text.slice(i + 1, j);
	const decoded = NAMED_ENTITIES[name];
	if (decoded === undefined) return null;
	return { html: escapeHtml(decoded), end: j + 1 };
}

// ── Inline rendering ─────────────────────────────────────────

interface LinkResult {
	text: string;
	url: string;
	title: string;
	alt: string;
	image: boolean;
	end: number;
}

function parseLink(text: string, start: number): LinkResult | null {
	let i = start;
	let isImage = false;
	if (text[i] === '!' && text[i + 1] === '[') {
		isImage = true;
		i++;
	}
	if (text[i] !== '[') return null;
	i++;
	let depth = 1;
	let labelEnd = -1;
	let j = i;
	while (j < text.length) {
		if (text[j] === '[') depth++;
		else if (text[j] === ']') {
			depth--;
			if (depth === 0) {
				labelEnd = j;
				break;
			}
		}
		j++;
	}
	if (labelEnd === -1) return null;
	const label = text.slice(i, labelEnd);
	j = labelEnd + 1;
	if (text[j] !== '(') return null;
	j++;
	while (j < text.length && text[j] === ' ') j++;
	const urlStart = j;
	depth = 1;
	let urlEnd = -1;
	while (j < text.length) {
		if (text[j] === '(') depth++;
		else if (text[j] === ')') {
			depth--;
			if (depth === 0) {
				urlEnd = j;
				break;
			}
		}
		j++;
	}
	if (urlEnd === -1) return null;
	const rawDest = text.slice(urlStart, urlEnd);
	const parts = splitLinkTitle(rawDest);
	if (!parts || parts.url === '') return null;
	return { text: label, url: parts.url, title: parts.title, alt: label, image: isImage, end: urlEnd + 1 };
}

/**
 * Splits an inline link destination into URL + optional title. A title must be
 * separated from the URL by whitespace ("double quoted", 'single quoted' or
 * (parenthesized)); quotes that are part of the URL itself (e.g. ?q="1") stay
 * in the destination. A backslash escapes the quote character inside.
 */
function splitLinkTitle(dest: string): { url: string; title: string } | null {
	// Find the first quote/paren that follows whitespace — that starts a title.
	let titleStart = -1;
	for (let i = 1; i < dest.length; i++) {
		const c = dest[i];
		if ((c === '"' || c === '\'' || c === '(') && (dest[i - 1] === ' ' || dest[i - 1] === '\t')) {
			titleStart = i;
			break;
		}
	}
	if (titleStart === -1) return { url: dest.trim(), title: '' };

	let k = titleStart;
	while (k > 0 && (dest[k - 1] === ' ' || dest[k - 1] === '\t')) k--;
	const url = dest.slice(0, k).trim();
	const open = dest[titleStart];
	const close = open === '(' ? ')' : open;
	let m = titleStart + 1;
	const titleChars: string[] = [];
	let closed = false;
	while (m < dest.length) {
		const c = dest[m];
		if (c === '\\' && m + 1 < dest.length) { titleChars.push(dest[m + 1]); m += 2; continue; }
		if (c === close) { closed = true; m++; break; }
		titleChars.push(c);
		m++;
	}
	if (!closed) return null;
	while (m < dest.length && (dest[m] === ' ' || dest[m] === '\t')) m++;
	if (m < dest.length) return null; // trailing garbage after the title
	return { url, title: titleChars.join('') };
}

function findDelimiter(text: string, from: number, delim: string): number {
	return text.indexOf(delim, from);
}

export interface InlineOptions {
	autolink?: boolean;
	defs?: Map<string, RefDef>;
	htmlMode?: MdHtmlMode;
	allowTags?: string[];
	rawHtmlWarnings?: MdHtmlWarning[];
}

function isAsciiLetter(c: string): boolean {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function isTagNameChar(c: string): boolean {
	return isAsciiLetter(c) || (c >= '0' && c <= '9') || c === '-';
}

interface HtmlTagScan {
	end: number;
	tag: string;
	closing: boolean;
	selfClosing: boolean;
	/** Attribute source slice between the tag name and the closing `>`/`/>`. */
	attrSrc: string;
}

/**
 * Scans an HTML tag starting at `text[start] === '<'`. Handles comments
 * (`<!-- … -->`), quoted attribute values containing `>`, and self-closing
 * tags. Returns null when this is not a well-formed tag.
 */
function scanHtmlTag(text: string, start: number): HtmlTagScan | null {
	if (text[start] !== '<') return null;
	if (text.startsWith('<!--', start)) {
		const close = text.indexOf('-->', start + 4);
		if (close === -1) return null;
		return { end: close + 3, tag: '!--', closing: false, selfClosing: false, attrSrc: '' };
	}
	let i = start + 1;
	let closing = false;
	if (text[i] === '/') { closing = true; i++; }
	if (!isAsciiLetter(text[i])) return null;
	const nameStart = i;
	while (i < text.length && isTagNameChar(text[i])) i++;
	const tag = text.slice(nameStart, i).toLowerCase();
	// find the terminating '>' honoring quotes
	let k = i;
	let quote = '';
	while (k < text.length) {
		const c = text[k];
		if (quote !== '') {
			if (c === quote) quote = '';
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === '>') {
			break;
		}
		k++;
	}
	if (k >= text.length) return null; // unterminated tag — treat as text
	let selfClosing = false;
	let attrEnd = k;
	if (text[k - 1] === '/') {
		selfClosing = true;
		attrEnd = k - 1;
	}
	return { end: k + 1, tag, closing, selfClosing, attrSrc: text.slice(i, attrEnd) };
}

/** Emits one passthrough warning into the render's collector. */
function recordRawHtml(warnings: MdHtmlWarning[] | undefined, tag: string, sample: string): void {
	if (!warnings) return;
	warnings.push({ tag, sample: sample.length > 60 ? sample.slice(0, 57) + '…' : sample });
}

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'poster', 'formaction']);

/** Escapes a value for embedding in a double-quoted attribute. */
function escapeAttrValue(v: string): string {
	return v.split('"').join('&quot;').split('&').join('&amp;');
}

/**
 * Rebuilds an attribute source string under the allowlist policy:
 * event-handler attributes (`on*`) are dropped, URL-bearing attributes are
 * sanitized via sanitizeUrl, everything else is kept verbatim.
 */
function filterHtmlAttributes(attrSrc: string): string {
	let out = '';
	let i = 0;
	const n = attrSrc.length;
	while (i < n) {
		// skip whitespace between attributes
		while (i < n && (attrSrc[i] === ' ' || attrSrc[i] === '\t' || attrSrc[i] === '\n')) { out += attrSrc[i]; i++; }
		if (i >= n) break;
		const tokenStart = i;
		// attribute name
		while (i < n && attrSrc[i] !== '=' && attrSrc[i] !== ' ' && attrSrc[i] !== '\t' && attrSrc[i] !== '\n') i++;
		const name = attrSrc.slice(tokenStart, i);
		const nameLower = name.toLowerCase();
		let rawValue: string | null = null;
		if (attrSrc[i] === '=') {
			i++;
			while (i < n && (attrSrc[i] === ' ' || attrSrc[i] === '\t')) i++;
			if (attrSrc[i] === '"' || attrSrc[i] === "'") {
				const q = attrSrc[i];
				const vStart = ++i;
				while (i < n && attrSrc[i] !== q) i++;
				rawValue = attrSrc.slice(vStart, i);
				if (i < n) i++; // closing quote
			} else {
				const vStart = i;
				while (i < n && attrSrc[i] !== ' ' && attrSrc[i] !== '\t' && attrSrc[i] !== '\n') i++;
				rawValue = attrSrc.slice(vStart, i);
			}
		}
		const tokenEnd = i;
		if (nameLower.startsWith('on')) continue; // drop inline handlers
		if (rawValue !== null && URL_ATTRS.has(nameLower)) {
			out += `${name}="${escapeAttrValue(sanitizeUrl(rawValue))}"`;
			continue;
		}
		out += attrSrc.slice(tokenStart, tokenEnd);
	}
	return out;
}

/**
 * Renders a raw-HTML tag at `text[start]` according to the policy:
 * - 'allow': verbatim.
 * - 'allowlist': allowed tags only; attrs filtered; closing tags normalized.
 * Returns null when the policy does not apply — the caller then falls back to
 * escaping, so disallowed tags stay visible as literal text.
 */
function tryRawHtml(text: string, start: number, opts: InlineOptions): { html: string; end: number } | null {
	const mode = opts.htmlMode;
	if (mode !== 'allow' && mode !== 'allowlist') return null;
	const scan = scanHtmlTag(text, start);
	if (!scan) return null;

	if (mode === 'allowlist') {
		if (scan.tag === '!--') return null;
		const allowedTags = opts.allowTags || MD_DEFAULT_ALLOW_TAGS;
		if (!allowedTags.includes(scan.tag)) return null;
		if (scan.closing) {
			recordRawHtml(opts.rawHtmlWarnings, scan.tag, text.slice(start, scan.end));
			return { html: `</${scan.tag}>`, end: scan.end };
		}
		recordRawHtml(opts.rawHtmlWarnings, scan.tag, text.slice(start, scan.end));
		const filtered = filterHtmlAttributes(scan.attrSrc);
		const tail = scan.selfClosing ? ' />' : '>';
		return { html: `<${scan.tag}${filtered}${tail}`, end: scan.end };
	}

	// mode === 'allow': verbatim, but still record so callers can warn.
	recordRawHtml(opts.rawHtmlWarnings, scan.tag, text.slice(start, scan.end));
	return { html: text.slice(start, scan.end), end: scan.end };
}

function renderInline(text: string, opts: InlineOptions = {}): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const ch = text[i];

		if (ch === '\\' && i + 1 < text.length) {
			out += escapeHtml(text[i + 1]);
			i += 2;
			continue;
		}

		if (opts.autolink && (ch === 'h' || ch === 'm' || ch === 'w')) {
			const auto = tryAutolink(text, i);
			if (auto) {
				out += auto.html;
				i = auto.end;
				continue;
			}
		}

		if (ch === '`') {
			let n = 0;
			while (i + n < text.length && text[i + n] === '`') n++;
			const delim = '`'.repeat(n);
			const close = findDelimiter(text, i + n, delim);
			if (close !== -1) {
				let code = text.slice(i + n, close);
				code = code.split('\n').join(' ');
				out += `<code>${escapeHtml(code)}</code>`;
				i = close + n;
				continue;
			}
			out += '`';
			i++;
			continue;
		}

		if (ch === '~' && text[i + 1] === '~') {
			const close = findDelimiter(text, i + 2, '~~');
			if (close !== -1 && close > i + 2) {
				out += `<del>${renderInline(text.slice(i + 2, close), opts)}</del>`;
				i = close + 2;
				continue;
			}
			out += '~';
			i++;
			continue;
		}

		if (ch === '*' || ch === '_') {
			const next = text[i + 1];
			if (next !== ' ' && next !== '\t' && next !== undefined) {
				const inner = tryEmphasis(text, i, opts);
				if (inner) {
					out += inner.html;
					i = inner.end;
					continue;
				}
			}
			out += ch;
			i++;
			continue;
		}

		if (ch === '[' || (ch === '!' && text[i + 1] === '[')) {
			let link = parseLink(text, i);
			if (!link) link = parseRefLink(text, i, opts.defs);
			if (link) {
				const titleAttr = link.title !== '' ? ` title="${escapeHtml(link.title)}"` : '';
				if (link.image) {
					out += `<img src="${escapeHtml(sanitizeUrl(link.url))}" alt="${escapeHtml(link.alt)}"${titleAttr} loading="lazy" />`;
				} else {
					out += `<a href="${escapeHtml(sanitizeUrl(link.url))}"${titleAttr}>${renderInline(link.text, opts)}</a>`;
				}
				i = link.end;
				continue;
			}
		}

		if (ch === '<' && opts.autolink) {
			const angle = tryAngleAutolink(text, i);
			if (angle) {
				out += angle.html;
				i = angle.end;
				continue;
			}
		}

		if (ch === '<' && opts.htmlMode && opts.htmlMode !== 'escape') {
			const raw = tryRawHtml(text, i, opts);
			if (raw) {
				out += raw.html;
				i = raw.end;
				continue;
			}
		}

		if (ch === '&') {
			const ent = tryEntity(text, i);
			if (ent) {
				out += ent.html;
				i = ent.end;
				continue;
			}
		}

		out += escapeHtml(ch);
		i++;
	}
	return out;
}

/**
 * CommonMark angle autolinks: `<https://…>`, `<http://…>`, `<mailto:…>` and
 * bare `<user@host.tld>` emails. Everything else returns null so the `<` is
 * escaped as before. Hrefs still pass through sanitizeUrl.
 */
function tryAngleAutolink(text: string, start: number): { html: string; end: number } | null {
	let end = -1;
	for (let j = start + 1; j < text.length && j <= start + 512; j++) {
		const c = text[j];
		if (c === ' ' || c === '\t' || c === '\n' || c === '<') return null;
		if (c === '>') { end = j; break; }
	}
	if (end === -1) return null;
	const inner = text.slice(start + 1, end);
	let href: string | null = null;
	if (inner.startsWith('https://') || inner.startsWith('http://') || inner.startsWith('mailto:')) {
		href = inner;
	} else if (isEmailLike(inner)) {
		href = 'mailto:' + inner;
	}
	if (!href) return null;
	return { html: `<a href="${escapeHtml(sanitizeUrl(href))}">${escapeHtml(inner)}</a>`, end: end + 1 };
}

function isEmailLike(s: string): boolean {
	const at = s.indexOf('@');
	if (at <= 0 || at !== s.lastIndexOf('@')) return false;
	const domain = s.slice(at + 1);
	const dot = domain.lastIndexOf('.');
	if (dot < 1 || dot === domain.length - 1) return false;
	const okChar = (c: string): boolean =>
		isIdentPart(c) || c === '.' || c === '-' || c === '+' || c === '%' || c === '_' || c === '@';
	for (const c of s) {
		if (!okChar(c)) return false;
	}
	return true;
}

/**
 * Reference links/images: full `[text][label]`, collapsed `[text][]` and
 * shortcut `[text]` forms, resolved against the document's definition map.
 * A failed inline link (`[a](no close`) is never re-interpreted as shortcut —
 * it stays literal.
 */
function parseRefLink(text: string, start: number, defs?: Map<string, RefDef>): LinkResult | null {
	if (!defs || defs.size === 0) return null;
	let i = start;
	let isImage = false;
	if (text[i] === '!' && text[i + 1] === '[') { isImage = true; i++; }
	if (text[i] !== '[') return null;
	i++;
	let depth = 1;
	let labelEnd = -1;
	let j = i;
	while (j < text.length) {
		if (text[j] === '\\') { j += 2; continue; }
		if (text[j] === '[') depth++;
		else if (text[j] === ']') {
			depth--;
			if (depth === 0) { labelEnd = j; break; }
		}
		j++;
	}
	if (labelEnd === -1) return null;
	const label = text.slice(i, labelEnd);

	let refLabel: string;
	let end: number;
	const next = text[labelEnd + 1];
	if (next === '[') {
		const close = text.indexOf(']', labelEnd + 2);
		if (close === -1) return null;
		refLabel = text.slice(labelEnd + 2, close);
		end = close + 1;
		// Collapsed form `[text][]` resolves through the text itself.
		if (refLabel.trim() === '') refLabel = label;
	} else if (next === '(') {
		return null; // inline-form attempt already failed → literal
	} else {
		refLabel = label; // collapsed / shortcut
		end = labelEnd + 1;
	}

	const def = defs.get(normalizeRefLabel(refLabel));
	if (!def) return null;
	return { text: label, url: def.url, title: def.title, alt: label, image: isImage, end };
}

function isAlphaNum(ch: string | undefined): boolean {
	if (ch === undefined) return false;
	return isIdentPart(ch);
}

function tryEmphasis(
	text: string,
	start: number,
	opts: InlineOptions = {},
): { html: string; end: number } | null {
	const ch = text[start];
	// CommonMark flanking rules for `_`: intraword emphasis (`some_var_name`)
	// never applies. Asterisks keep allowing it.
	const underscoreOk = (open: boolean, pos: number): boolean => {
		if (ch !== '_') return true;
		return open ? !isAlphaNum(text[pos - 1]) : !isAlphaNum(text[pos + 1]);
	};
	if (!underscoreOk(true, start)) return null;
	if (text[start + 1] === ch) {
		let j = start + 2;
		while (j < text.length) {
			if (text[j] === ch && text[j + 1] === ch) {
				if (j > start + 2 && (text[j - 1] === ' ' || text[j - 1] === '\t')) {
					j += 2;
					continue;
				}
				if (!underscoreOk(false, j)) { j++; continue; }
				return { html: `<strong>${renderInline(text.slice(start + 2, j), opts)}</strong>`, end: j + 2 };
			}
			j++;
		}
	}
	let j = start + 1;
	while (j < text.length) {
		if (text[j] === ch) {
			if (j > start + 1 && (text[j - 1] === ' ' || text[j - 1] === '\t')) {
				j++;
				continue;
			}
			if (!underscoreOk(false, j)) { j++; continue; }
			return { html: `<em>${renderInline(text.slice(start + 1, j), opts)}</em>`, end: j + 1 };
		}
		j++;
	}
	return null;
}

// ── Block rendering ──────────────────────────────────────────

export interface MarkdownOptions {
	/** Highlight fenced code with the built-in tokenizer. Default false. */
	highlight?: boolean;
	/** Wrap code in .md-code chrome with a language badge + copy button. Default false. */
	chrome?: boolean;
	/** Render per-line spans for CSS counter line numbers inside chrome. Default false. */
	lineNumbers?: boolean;
	/** Emit a copy button in the code bar. Default true when chrome is on. */
	copy?: boolean;
	/** Add slug anchors to headings. Default false. */
	ids?: boolean;
	/** Linkify bare http(s)/www/mailto URLs. Default false. */
	autolink?: boolean;
	/** Honor two-space / backslash hard line breaks in paragraphs. Default false. */
	hardBreaks?: boolean;
	/** Raw-HTML policy (see MdHtmlMode). Default 'escape' — every HTML-ish
	 * construct renders as visible text. */
	html?: MdHtmlMode;
	/** Tag allowlist for html:'allowlist'. Defaults to MD_DEFAULT_ALLOW_TAGS. */
	allowTags?: string[];
}

export type MdHtmlMode = 'escape' | 'allow' | 'allowlist';

/**
 * Tags allowed by default when html = 'allowlist'. Inline, formatting-level
 * tags only — structural/embedding tags (script, iframe, img, div, …) must be
 * opted into explicitly via allowTags. Keep in sync with
 * packages/compiler/src/config.ts MD_DEFAULT_ALLOW_TAGS.
 */
export const MD_DEFAULT_ALLOW_TAGS = [
	'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em',
	'i', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
	'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
];

/** One raw-HTML passthrough observed while rendering. */
export interface MdHtmlWarning {
	tag: string;
	/** Short sample of the source snippet (bounded). */
	sample: string;
}

interface RenderCtx extends Required<MarkdownOptions> {
	headings: Map<string, number>;
	refs: Map<string, RefDef>;
	warnings: MdHtmlWarning[];
}

function ctxOf(o: MarkdownOptions): RenderCtx {
	// Fall back to the process-wide policy (configureMd) per key, so direct
	// renderMarkdown calls honor vesk.config.ts just like the <Md> component.
	return {
		highlight: o.highlight === true,
		chrome: o.chrome === true,
		lineNumbers: o.lineNumbers === true,
		copy: o.copy !== false,
		ids: o.ids === true,
		autolink: o.autolink === true,
		hardBreaks: o.hardBreaks === true,
		html: o.html || __globalMode,
		allowTags: o.allowTags || __globalAllowTags || MD_DEFAULT_ALLOW_TAGS,
		headings: new Map(),
		refs: new Map(),
		warnings: [],
	};
}

function inlineOpts(ctx: RenderCtx): InlineOptions {
	return { autolink: ctx.autolink, defs: ctx.refs, htmlMode: ctx.html, allowTags: ctx.allowTags, rawHtmlWarnings: ctx.warnings };
}

function renderListItem(item: { blocks: Block[]; task: boolean | null }, ctx: RenderCtx): string {
	const blocks = item.blocks;
	let checkbox = '';
	if (item.task === true) checkbox = '<input type="checkbox" checked disabled class="md-task-box" />';
	else if (item.task === false) checkbox = '<input type="checkbox" disabled class="md-task-box" />';
	const liClass = item.task !== null ? ' class="md-task"' : '';

	if (blocks.length === 1 && blocks[0].type === 'paragraph') {
		return `<li${liClass}>${checkbox}${renderInline(blocks[0].text, inlineOpts(ctx))}</li>`;
	}
	const parts: string[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		if (i === 0 && b.type === 'paragraph') {
			parts.push(renderInline(b.text, inlineOpts(ctx)));
		} else {
			parts.push(renderBlock(b, ctx));
		}
	}
	return `<li${liClass}>${checkbox}${parts.join('\n')}</li>`;
}

function renderHeadingId(text: string, ctx: RenderCtx): string {
	const base = slugify(text);
	const seen = ctx.headings.get(base) || 0;
	ctx.headings.set(base, seen + 1);
	return seen === 0 ? base : `${base}-${seen + 1}`;
}

function trimTrailingSpaces(s: string): string {
	let e = s.length;
	while (e > 0 && s[e - 1] === ' ') e--;
	return s.slice(0, e);
}

function hardJoin(lines: string[], ctx: RenderCtx): string {
	let out = '';
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		let br = false;
		if (ctx.hardBreaks) {
			if (line.endsWith('  ')) { br = true; line = trimTrailingSpaces(line); }
			else if (line.endsWith('\\')) { br = true; line = line.slice(0, -1); }
		}
		out += renderInline(trimTrailingSpaces(line), inlineOpts(ctx));
		if (br && i < lines.length - 1) out += '<br />\n';
		else if (i < lines.length - 1) out += ' ';
	}
	return out;
}

/**
 * Wraps each rendered line in <span class="tok-line"> for CSS-counter line
 * numbers. Token spans never intentionally cross lines, except multi-line
 * block comments — the splitter reopens any open spans on the next line so
 * nesting stays valid.
 */
function wrapCodeLines(html: string): string {
	const stack: string[] = [];
	let out = '';
	let i = 0;
	const n = html.length;
	const closeAll = () => {
		for (let k = stack.length - 1; k >= 0; k--) out += '</span>';
	};
	const reopen = () => {
		for (const c of stack) out += c;
	};
	out += '<span class="tok-line">';
	while (i < n) {
		if (html.startsWith('<span class="tok-', i)) {
			const close = html.indexOf('>', i);
			if (close === -1) { out += html[i]; i++; continue; }
			const tag = html.slice(i, close + 1);
			stack.push(tag);
			out += tag;
			i = close + 1;
			continue;
		}
		if (html.startsWith('</span>', i)) {
			stack.pop();
			out += '</span>';
			i += 7;
			continue;
		}
		if (html[i] === '\n') {
			closeAll();
			out += '</span>\n<span class="tok-line">';
			reopen();
			i++;
			continue;
		}
		out += html[i];
		i++;
	}
	closeAll();
	out += '</span>';
	return out;
}

function renderCodeBlock(b: Extract<Block, { type: 'code' }>, ctx: RenderCtx): string {
	const legacy = !ctx.chrome && !ctx.highlight;
	if (legacy) {
		const lang = b.lang ? ` class="language-${escapeHtml(b.lang)}"` : '';
		return `<pre><code${lang}>${escapeHtml(b.code)}</code></pre>`;
	}

	const rawBody = ctx.highlight && b.lang ? highlightCode(b.code, b.lang) : escapeHtml(b.code);
	const body = ctx.lineNumbers && ctx.chrome ? wrapCodeLines(rawBody) : rawBody;
	const codeCls = b.lang ? `language-${escapeHtml(b.lang)}` : '';
	const lineAttr = ctx.lineNumbers && ctx.chrome ? ' md-lines' : '';

	if (!ctx.chrome) {
		return `<pre><code${codeCls ? ` class="${codeCls}"` : ''}>${body}</code></pre>`;
	}

	const meta = parseFenceMeta(b.info || b.lang);
	const styleParts: string[] = [];
	if (meta.params.bg !== undefined) {
		const v = safeColorValue(meta.params.bg);
		styleParts.push(`--md-code-bg:${v === 'none' ? 'transparent' : (v || 'transparent')}`);
	}
	if (meta.params.fg !== undefined) {
		const v = safeColorValue(meta.params.fg);
		if (v && v !== 'none') styleParts.push(`--md-code-fg:${v}`);
	}
	const styleAttr = styleParts.length > 0 ? ` style="${escapeHtml(styleParts.join(';'))}"` : '';
	const langLabel = meta.lang ? `<span class="md-code-lang">${escapeHtml(meta.lang)}</span>` : '<span class="md-code-lang"></span>';
	const copyBtn = ctx.copy ? '<button type="button" class="md-copy" data-md-copy aria-label="Copy code">Copy</button>' : '';
	return (
		`<div class="md-code"${meta.lang ? ` data-lang="${escapeHtml(meta.lang)}"` : ''}${styleAttr}>` +
		`<div class="md-code-bar">${langLabel}${copyBtn}</div>` +
		`<pre><code${codeCls ? ` class="${codeCls}"` : ''}${lineAttr}>${body}</code></pre>` +
		`</div>`
	);
}

function renderBlock(b: Block, ctx: RenderCtx): string {
	if (b.type === 'paragraph') {
		return `<p>${hardJoin(b.lines || [b.text], ctx)}</p>`;
	}
	if (b.type === 'heading') {
		const id = ctx.ids ? ` id="${escapeHtml(renderHeadingId(b.text, ctx))}"` : '';
		return `<h${b.level}${id}>${renderInline(b.text, inlineOpts(ctx))}</h${b.level}>`;
	}
	if (b.type === 'hr') {
		return '<hr />';
	}
	if (b.type === 'code') {
		return renderCodeBlock(b, ctx);
	}
	if (b.type === 'blockquote') {
		return `<blockquote>${renderBlocks(b.blocks, ctx)}</blockquote>`;
	}
	if (b.type === 'table') {
		return renderTable(b, ctx);
	}
	return renderList(b as Extract<Block, { type: 'list' }>, ctx);
}

function renderList(b: Extract<Block, { type: 'list' }>, ctx: RenderCtx): string {
	const tag = b.ordered ? 'ol' : 'ul';
	const startAttr = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
	const items = b.items.map((it) => renderListItem(it, ctx)).join('\n');
	return `<${tag}${startAttr}${b.items.some(it => it.task !== null) ? ' class="md-tasks"' : ''}>\n${items}\n</${tag}>`;
}

function renderTable(b: Extract<Block, { type: 'table' }>, ctx: RenderCtx): string {
	const styleFor = (a: Align): string => (a ? ` style="text-align:${a}"` : '');
	const headCells = b.head
		.map((c, idx) => `<th${styleFor(b.align[idx] || null)}>${renderInline(c, inlineOpts(ctx))}</th>`)
		.join('');
	const bodyRows = b.rows
		.map((row) => {
			const cells = b.head
				.map((_, idx) => `<td${styleFor(b.align[idx] || null)}>${renderInline(row[idx] || '', inlineOpts(ctx))}</td>`)
				.join('');
			return `<tr>${cells}</tr>`;
		})
		.join('\n');
	return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headCells}</tr></thead><tbody>\n${bodyRows}\n</tbody></table></div>`;
}

function renderBlocks(blocks: Block[], ctx: RenderCtx): string {
	const out: string[] = [];
	for (const b of blocks) {
		out.push(renderBlock(b, ctx));
	}
	return out.join('\n');
}

// ── Base stylesheet (opt-in via <Md css>) ────────────────────

export const MD_BASE_CSS = `
.vesk-md { color: #24292f; font-size: 16px; line-height: 1.7; word-wrap: break-word; }
.vesk-md h1,.vesk-md h2,.vesk-md h3,.vesk-md h4,.vesk-md h5,.vesk-md h6 { margin: 1.4em 0 .6em; font-weight: 650; line-height: 1.25; }
.vesk-md h1 { font-size: 2em; }
.vesk-md h2 { font-size: 1.5em; }
.vesk-md h3 { font-size: 1.25em; } .vesk-md h4 { font-size: 1em; }
.vesk-md p { margin: .8em 0; }
.vesk-md a { color: #0969da; text-decoration: none; } .vesk-md a:hover { text-decoration: underline; }
.vesk-md img { max-width: 100%; border-radius: 6px; }
.vesk-md hr { border: 0; height: 1px; background: #d0d7de; margin: 1.6em 0; }
.vesk-md blockquote { margin: .8em 0; padding: .2em 1em; color: #57606a; border-left: .25em solid #d0d7de; }
.vesk-md ul,.vesk-md ol { margin: .8em 0; padding-left: 2em; }
.vesk-md ul { list-style: disc; } .vesk-md ul ul { list-style: circle; } .vesk-md ul ul ul { list-style: square; }
.vesk-md ol { list-style: decimal; } .vesk-md ol ol { list-style: lower-alpha; }
.vesk-md li { margin: .25em 0; }
.vesk-md li.md-task { list-style: none; margin-left: -1.4em; display: flex; gap: .5em; align-items: baseline; }
.vesk-md code:not(pre code) { background: rgba(175,184,193,.2); padding: .15em .35em; border-radius: 5px; font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size: 85%; }
.vesk-md .md-table-wrap { overflow-x: auto; margin: .8em 0; }
.vesk-md table.md-table { border-collapse: collapse; width: max-content; max-width: 100%; font-size: .95em; }
.vesk-md .md-table th,.vesk-md .md-table td { border: 1px solid #d0d7de; padding: 6px 13px; }
.vesk-md .md-table th { background: #f6f8fa; font-weight: 650; }
.vesk-md .md-table tr:nth-child(2n) td { background: #f6f8fa80; }
.vesk-md .md-code { --md-code-bg: #f6f8fa; margin: 1em 0; border-radius: 8px; overflow: hidden; background: var(--md-code-bg); border: 1px solid #d1d9e0; }
.vesk-md .md-code-bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: var(--md-code-bg); border-bottom: 1px solid #d1d9e0; }
.vesk-md .md-code-lang { font-family: ui-monospace,monospace; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #59636e; }
.vesk-md .md-copy { all: unset; cursor: pointer; font: 11px ui-monospace,monospace; color: #59636e; padding: 2px 8px; border-radius: 6px; }
.vesk-md .md-copy:hover { color: #1f2328; background: #eaeef2; }
.vesk-md .md-copy.md-copied { color: #1a7f37; }
.vesk-md .md-code pre { margin: 0; overflow-x: auto; padding: 14px 16px; }
.vesk-md .md-code code { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size: 13.5px; line-height: 1.55; color: var(--md-code-fg,#1f2328); background: none; padding: 0; }
.vesk-md code[md-lines] { counter-reset: ln; display: block; }
.vesk-md code[md-lines] .tok-line { display: block; counter-increment: ln; padding-left: 3.2em; position: relative; }
.vesk-md code[md-lines] .tok-line::before { content: counter(ln); position: absolute; left: 0; width: 2.4em; text-align: right; color: #8c959f; user-select: none; }
.tok-kw { color: #cf222e; } .tok-lit { color: #0550ae; } .tok-str { color: #0a3069; }
.tok-num { color: #0550ae; } .tok-com { color: #59636e; font-style: italic; }
.tok-fn { color: #8250df; } .tok-attr { color: #0550ae; } .tok-prop { color: #0550ae; }
.tok-sel { color: #116329; } .tok-add { color: #116329; background: #dafbe1; display: inline-block; width: 100%; }
.tok-del { color: #cf222e; background: #ffebe9; display: inline-block; width: 100%; }
.vesk-md-dark { --md-code-bg: #0d1117; --md-code-fg: #c9d1d9; }
.vesk-md-dark .md-code-bar { border-bottom-color: #30363d; }
.vesk-md-dark .md-code-lang { color: #8b949e; }
.vesk-md-dark .md-copy { color: #8b949e; }
.vesk-md-dark .md-copy:hover { color: #c9d1d9; background: #30363d; }
.vesk-md-dark .md-copy.md-copied { color: #3fb950; }
.vesk-md-dark code[md-lines] .tok-line::before { color: #484f58; }
.vesk-md-dark .tok-kw { color: #ff7b72; } .vesk-md-dark .tok-lit { color: #79c0ff; }
.vesk-md-dark .tok-str { color: #a5d6ff; } .vesk-md-dark .tok-num { color: #f2cc60; }
.vesk-md-dark .tok-com { color: #8b949e; font-style: italic; }
.vesk-md-dark .tok-fn { color: #d2a8ff; } .vesk-md-dark .tok-attr { color: #79c0ff; }
.vesk-md-dark .tok-prop { color: #79c0ff; } .vesk-md-dark .tok-sel { color: #7ee787; }
.vesk-md-dark .tok-add { color: #aff5b4; background: rgba(46,160,67,.15); }
.vesk-md-dark .tok-del { color: #ffdcd7; background: rgba(248,81,73,.15); }
`;

// ── Public entry points ──────────────────────────────────────

/**
 * Renders markdown to HTML with default (legacy) options — output shape is
 * stable for existing consumers. Pass options for advanced features:
 * `{ highlight, chrome, lineNumbers, copy, ids, autolink, hardBreaks }`.
 */
export function renderMarkdown(md: string, options: MarkdownOptions = {}): string {
	return renderMarkdownEx(md, options).html;
}

/** Like renderMarkdown, but also returns the raw-HTML passthrough warnings. */
export function renderMarkdownEx(md: string, options: MarkdownOptions = {}): { html: string; warnings: MdHtmlWarning[] } {
	const ctx = ctxOf(options);
	// Normalize CRLF/CR so pasted content parses identically to typed input.
	const normalized = String(md == null ? '' : md).split('\r\n').join('\n').split('\r').join('\n');
	const extracted = extractRefDefinitions(normalized.split('\n'));
	ctx.refs = extracted.defs;
	const html = renderBlocks(parseBlocks(extracted.lines), ctx);
	return { html, warnings: ctx.warnings };
}

// ── Global Md policy (configured from vesk.config.ts `md` key) ────

let __globalMode: MdHtmlMode = 'escape';
let __globalAllowTags: string[] | null = null;

/**
 * Sets the process-wide default raw-HTML policy for `<Md>`. Called by the CLI
 * and servers with the `md` key from vesk.config.ts. Individual `<Md>` usages
 * can still override per-instance via the `html` / `allowTags` props.
 */
export function configureMd(policy?: { html?: MdHtmlMode; allowTags?: string[] }): void {
	if (!policy || typeof policy !== 'object') return;
	if (policy.html) __globalMode = policy.html;
	if (policy.allowTags) {
		__globalAllowTags = policy.allowTags
			.map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, ''))
			.filter(Boolean);
	}
}

/** The effective process-wide policy (after configureMd). */
export function getMdPolicy(): { html: MdHtmlMode; allowTags: string[] } {
	return { html: __globalMode, allowTags: (__globalAllowTags || MD_DEFAULT_ALLOW_TAGS).slice() };
}

// Bounded collector for build-time summaries (`vesk build` prints it).
const __sessionWarnings: MdHtmlWarning[] = [];
const __warnedKeys = new Set<string>();

/** Test hook: silence per-render console warnings without changing policy. */
let __suppressMdConsoleWarnings = false;
export function setMdConsoleWarnings(enabled: boolean): void {
	__suppressMdConsoleWarnings = !enabled;
}

function rememberSessionWarnings(warnings: MdHtmlWarning[]): void {
	for (const w of warnings) {
		if (__warnedKeys.has(w.tag)) continue;
		__warnedKeys.add(w.tag);
		__sessionWarnings.push(w);
		if (__warnedKeys.size > 500) break; // bounded
	}
}

/** Drains the collected passthrough samples (for build-time summaries). */
export function drainMdHtmlWarnings(): MdHtmlWarning[] {
	return __sessionWarnings.splice(0, __sessionWarnings.length);
}

export interface MdProps {
	/** Markdown source — a plain string, a tracked cell (reactive on client), a
	 *  streamed resource (useFetch.stream — re-renders per chunk), or an
	 *  absolute public markdown path (runtime-loaded from the app's public dir). */
	content?: string | { get: () => string };
	/** Default background for all code blocks (CSS color or 'none'). Fence-level bg= wins. */
	codeBg?: string;
	/** Default code text color. Fence-level fg= wins. */
	codeFg?: string;
	/** Code theme preset: 'light' (default) or 'dark'. Per-fence bg=/fg= still win. */
	theme?: 'light' | 'dark';
	class?: string;
	className?: string;
	style?: string;
	/** Inject MD_BASE_CSS (true), a custom stylesheet string, or nothing (false/default). */
	css?: boolean | string;
	/** Per-line spans for CSS-counter line numbers in code chrome. */
	lineNumbers?: boolean;
	/** Copy buttons on code blocks (client-wired when hydrated). Default true. */
	copy?: boolean;
	highlight?: boolean;
	ids?: boolean;
	autolink?: boolean;
	hardBreaks?: boolean;
	/** Per-instance raw-HTML policy — overrides the global md.html config. */
	html?: MdHtmlMode | string;
	/** Per-instance tag allowlist — overrides the global md.allowTags config. */
	allowTags?: string[];
	[k: string]: unknown;
}

function wireCopyHandlers(root: HTMLElement): void {
	root.addEventListener('click', (ev) => {
		const target = ev.target as HTMLElement | null;
		if (!target) return;
		const btn = target.closest('[data-md-copy]') as HTMLElement | null;
		if (!btn) return;
		const wrap = btn.closest('.md-code') as HTMLElement | null;
		const code = wrap ? wrap.querySelector('pre > code') : null;
		const text = code ? (code.textContent || '') : '';
		const done = () => {
			btn.classList.add('md-copied');
			btn.textContent = 'Copied!';
			window.setTimeout(() => {
				btn.classList.remove('md-copied');
				btn.textContent = 'Copy';
			}, 1500);
		};
		try {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
				void navigator.clipboard.writeText(text).then(done, done);
				return;
			}
		} catch { /* fall through */ }
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
			done();
		} catch { /* clipboard unavailable */ }
	});
}

function mdIsSSR(): boolean {
	return typeof document === 'undefined';
}

// =============================================================
// Runtime markdown-file loading (public/*.md) + streaming support
//
// When `content` resolves to an absolute public markdown path
// (e.g. "/docs/guide.md"), <Md> loads the FILE at runtime:
//   - server: adapter-installed `__vsk_md_read_file` hook reads it,
//     constrained to the public dir + `.md` suffixes (returns null
//     outside those bounds), and the content is stashed in
//     `__vsk_ssr_data` for hydration so there is no flash.
//   - client: `fetch(path)` with a per-path cache cell; while loading
//     (or if the file does not exist) the path itself is rendered as
//     literal markdown text.
// `content` may also be a streaming-resource result (useFetch.stream),
// whose `.into` cell is subscribed so chunks re-render progressively.
// =============================================================

/** Tokenizer endsWith (no regex, mirrors compiler rule). */
function stringEndsWith(s: string, suffix: string): boolean {
	if (suffix.length > s.length) return false;
	for (let i = 0; i < suffix.length; i++) {
		if (s[s.length - suffix.length + i] !== suffix[i]) return false;
	}
	return true;
}

function isPublicMarkdownPath(v: unknown): v is string {
	if (typeof v !== 'string') return false;
	const s = v;
	if (s.length < 2 || s.charCodeAt(0) !== 47) return false; // '/'
	if (s.charCodeAt(1) === 47) return false;                  // '//'
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 63 || c === 35 || c === 92) return false;      // ? # \
	}
	const lower = s.toLowerCase();
	return stringEndsWith(lower, '.md') || stringEndsWith(lower, '.markdown');
}

const mdPathCache = new Map<string, string | null>();
const mdPathCells = new Map<string, Tracked>();
const mdPathInflight = new Set<string>();

function getMdPathCell(path: string): Tracked {
	let cell = mdPathCells.get(path);
	if (!cell) {
		cell = tracked(undefined as string | undefined);
		mdPathCells.set(path, cell);
	}
	return cell;
}

function ensureMdPathLoaded(path: string): void {
	if (mdPathCache.has(path) || mdPathInflight.has(path)) return;
	const ssr = getSsrData('md:' + path);
	if (typeof ssr === 'string') {
		mdPathCache.set(path, ssr);
		return;
	}
	mdPathInflight.add(path);
	fetch(path)
		.then((r) => (r.ok ? r.text() : Promise.reject(r)))
		.then((text) => {
			mdPathCache.set(path, text);
			set(getMdPathCell(path), text);
		})
		.catch(() => {
			mdPathCache.set(path, null);
			set(getMdPathCell(path), null);
		})
		.finally(() => {
			mdPathInflight.delete(path);
		});
}

function readServerMdPath(path: string): string | null {
	const hook = (globalThis as Record<string, unknown>).__vsk_md_read_file;
	if (typeof hook !== 'function') return null;
	try {
		const out = (hook as (p: string) => string | null)(path);
		if (typeof out === 'string') return out;
	} catch {
		/* read errors fall through to literal rendering */
	}
	return null;
}

/**
 * Resolves a raw content value to the markdown SOURCE that should be
 * rendered. Non-path values pass through; public markdown paths are read
 * on the server (SSR) or resolved from cache while loading on the client.
 */
function resolveMdSource(value: unknown): string {
	const s = String(value ?? '');
	if (!isPublicMarkdownPath(s)) return s;
	if (mdIsSSR()) {
		const content = readServerMdPath(s);
		if (content !== null) {
			setSsrData('md:' + s, content);
			return content;
		}
		return s;
	}
	ensureMdPathLoaded(s);
	const cached = mdPathCache.get(s);
	return cached === undefined || cached === null ? s : cached;
}

/** Extracts the streaming target cell from a useFetch.stream() resource. */
function streamCellFrom(rawContent: unknown): Tracked | null {
	if (rawContent === null || typeof rawContent !== 'object') return null;
	const into = (rawContent as { into?: unknown }).into;
	if (into !== null && typeof into === 'object' && typeof (into as { get?: unknown }).get === 'function') {
		return into as Tracked;
	}
	return null;
}

function buildHtml(content: string, props: MdProps): string {
	// Per-instance props override the process-wide policy from vesk.config.ts.
	const global = getMdPolicy();
	const mode: MdHtmlMode = (props.html as MdHtmlMode) || global.html;
	const allowTags = Array.isArray(props.allowTags)
		? (props.allowTags as string[]).map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean)
		: global.allowTags;

	const { html, warnings } = renderMarkdownEx(content, {
		highlight: props.highlight !== false,
		chrome: props.highlight !== false,
		lineNumbers: props.lineNumbers === true,
		copy: props.copy !== false,
		ids: props.ids !== false,
		autolink: props.autolink !== false,
		hardBreaks: props.hardBreaks === true,
		html: mode,
		allowTags,
	});

	if (warnings.length > 0 && mode !== 'escape') {
		rememberSessionWarnings(warnings);
		if (!__suppressMdConsoleWarnings) {
			const byTag = new Map<string, number>();
			for (const w of warnings) byTag.set(w.tag, (byTag.get(w.tag) || 0) + 1);
			const tags = [...byTag.entries()].map(([t, n]) => `<${t}>×${n}`).join(', ');
			console.warn(
				`[vesk-md] ${mode === 'allow' ? 'raw HTML rendered verbatim' : 'allowlisted HTML rendered'} — ${tags}. ` +
				'Only use with trusted markdown content. Policy source: md.html in vesk.config.ts (or <Md html> prop).',
			);
		}
	}
	if (props.css === true) {
		return `<style data-vesk-md-css>${MD_BASE_CSS}</style>${html}`;
	}
	if (typeof props.css === 'string' && props.css !== '') {
		return `<style data-vesk-md-css>${props.css}</style>${html}`;
	}
	return html;
}

/**
 * Renders markdown as HTML. On the server it returns an HTML string; on the
 * client it claims the SSR-rendered subtree during hydration (or builds a
 * fresh wrapper element for SPA navigation). Advanced rendering (highlighted
 * code with chrome, heading anchors, autolinks) is on by default; tune with
 * the css / lineNumbers / copy / highlight / ids / autolink / hardBreaks props.
 */
export function Md(props: MdProps, _registry?: Map<string, unknown>, hydrate?: HydrateWalker): Node | string {
	const rawContent = props.content;
	const streamTarget = streamCellFrom(rawContent);
	const contentCell = streamTarget ?? rawContent;
	const content = String(unwrapMaybeCell(contentCell) ?? '');
	const html = buildHtml(resolveMdSource(content), props);
	const classNameRaw = props.className != null ? String(props.className) : props.class != null ? String(props.class) : '';
	const themeClass = props.theme === 'dark' ? ' vesk-md-dark' : '';
	const className = `vesk-md${themeClass}${classNameRaw ? ' ' + classNameRaw : ''}`;
	const style = props.style != null ? String(props.style) : '';

	// Component-level code defaults; fence-level bg=/fg= emit the same
	// custom properties on the block, overriding these by inheritance.
	const wrapperParts: string[] = [];
	const propBg = safeColorValue(String(props.codeBg ?? ''));
	if (propBg) wrapperParts.push(`--md-code-bg:${propBg === 'none' ? 'transparent' : propBg}`);
	const propFg = safeColorValue(String(props.codeFg ?? ''));
	if (propFg && propFg !== 'none') wrapperParts.push(`--md-code-fg:${propFg}`);
	const wrapperStyle = wrapperParts.length > 0 ? escapeHtml(wrapperParts.join(';')) : '';

	// A tracked `content` cell (or a streaming resource's `into` cell)
	// re-renders the markdown reactively on the client (per-keystroke live
	// editing and progressive stream chunks work without any extra wiring).
	const reactive = isCell(contentCell);
	const pathMode = isPublicMarkdownPath(content);

	if (mdIsSSR()) {
		const attrs = className ? ` class="${escapeHtml(className)}"` : '';
		const styleAttr = style || wrapperStyle ? ` style="${[wrapperStyle, style.split('"').join('&quot;')].filter(Boolean).join(';')}"` : '';
		return `<div${attrs}${styleAttr}>${html}</div>`;
	}

	if (hydrate && typeof hydrate.nextElement === 'function') {
		let el = hydrate.nextElement('div') as HTMLElement;
		if (el && !el.parentNode && hydrate.root) {
			const existing = hydrate.root.querySelector('div');
			if (existing) el = existing as HTMLElement;
		}
		const claimed = !!el.parentNode;
		if (pathMode && claimed) {
			// Retention: the SSR render already shows this path's rendered
			// file (or the literal path). Only overwrite when the client has
			// authoritative content (hydrated ssr data / cache); otherwise
			// trust the markup until the client load resolves.
			el.setAttribute('data-vsk-md-ssr', '1');
			if (mdPathCache.has(content)) el.innerHTML = html;
		} else {
			el.innerHTML = html;
		}
		el.className = className;
		el.style.cssText = [wrapperStyle, style].filter(Boolean).join(';');
		wireCopyHandlers(el);
		if (reactive || pathMode) {
			subscribeContent(el, contentCell, props, pathMode && claimed ? { trustInitialSsr: true, initialValue: content } : undefined);
		}
		// When the element came from SSR it is already in the document —
		// return an empty fragment. When the walker handed us a FRESH
		// element (dynamic branch that had no SSR markup), hand the element
		// back so the caller places it.
		if (el.parentNode) return document.createDocumentFragment();
		return el;
	}

	const div = document.createElement('div');
	div.innerHTML = html;
	div.className = className;
	div.style.cssText = [wrapperStyle, style].filter(Boolean).join(';');
	wireCopyHandlers(div);
	if (reactive || pathMode) subscribeContent(div, contentCell, props);
	return div;
}

function subscribeContent(
	el: HTMLElement,
	rawContent: unknown,
	props: MdProps,
	opts?: { trustInitialSsr?: boolean; initialValue?: string },
): void {
	const trust = opts?.trustInitialSsr === true;
	const initial = opts?.initialValue;
	let ran = false;
	effect(() => {
		const value = String(unwrapMaybeCell(rawContent) ?? '');
		if (isPublicMarkdownPath(value)) {
			const known = getSsrData('md:' + value) !== undefined || mdPathCache.has(value);
			ensureMdPathLoaded(value);
			const cell = getMdPathCell(value);
			get(cell);
			if (trust && !ran && value === initial && !known) {
				// Keep the SSR-rendered file visible while the client load is
				// in flight (or the path stays a literal on not-found).
				ran = true;
				return;
			}
			ran = true;
			el.innerHTML = buildHtml(resolveMdSource(value), props);
			wireCopyHandlers(el);
			return;
		}
		ran = true;
		el.innerHTML = buildHtml(resolveMdSource(value), props);
		wireCopyHandlers(el);
	});
}
