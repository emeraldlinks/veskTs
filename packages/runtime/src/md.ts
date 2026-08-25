import type { HydrateWalker } from '@vesk/runtime/src/hydrate';
import { effect } from '@vesk/runtime/src/ripple-blocks';

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
// `content` accepts a plain string or a tracked cell — cells are
// unwrapped for rendering and, on the client, subscribed so the
// rendered markdown updates reactively.
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
]);
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
 * js/ts/jsx/tsx family, json, python, go, rust, sql, bash/shell, yaml/toml,
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
			while (k < n && code[k] === ' ') k++;
			if (p.keywords.has(word)) emit('kw', word);
			else if (p.literals && p.literals.has(word)) emit('lit', word);
			else if (code[k] === '(') emit('fn', word);
			else emit('txt', word);
			i = j;
			continue;
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

// ── Inline rendering ─────────────────────────────────────────

interface LinkResult {
	text: string;
	url: string;
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
	const url = text.slice(urlStart, urlEnd).trim();
	if (url === '') return null;
	return { text: label, url, alt: label, image: isImage, end: urlEnd + 1 };
}

function findDelimiter(text: string, from: number, delim: string): number {
	return text.indexOf(delim, from);
}

export interface InlineOptions {
	autolink?: boolean;
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
			const link = parseLink(text, i);
			if (link) {
				if (link.image) {
					out += `<img src="${escapeHtml(sanitizeUrl(link.url))}" alt="${escapeHtml(link.alt)}" loading="lazy" />`;
				} else {
					out += `<a href="${escapeHtml(sanitizeUrl(link.url))}">${renderInline(link.text, opts)}</a>`;
				}
				i = link.end;
				continue;
			}
		}

		out += escapeHtml(ch);
		i++;
	}
	return out;
}

function tryEmphasis(
	text: string,
	start: number,
	opts: InlineOptions = {},
): { html: string; end: number } | null {
	const ch = text[start];
	if (text[start + 1] === ch) {
		let j = start + 2;
		while (j < text.length) {
			if (text[j] === ch && text[j + 1] === ch) {
				if (j > start + 2 && (text[j - 1] === ' ' || text[j - 1] === '\t')) {
					j += 2;
					continue;
				}
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
}

interface RenderCtx extends Required<MarkdownOptions> {
	headings: Map<string, number>;
}

function ctxOf(o: MarkdownOptions): RenderCtx {
	return {
		highlight: o.highlight === true,
		chrome: o.chrome === true,
		lineNumbers: o.lineNumbers === true,
		copy: o.copy !== false,
		ids: o.ids === true,
		autolink: o.autolink === true,
		hardBreaks: o.hardBreaks === true,
		headings: new Map(),
	};
}

function inlineOpts(ctx: RenderCtx): InlineOptions {
	return { autolink: ctx.autolink };
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
	const ctx = ctxOf(options);
	// Normalize CRLF/CR so pasted content parses identically to typed input.
	const normalized = String(md == null ? '' : md).split('\r\n').join('\n').split('\r').join('\n');
	const lines = normalized.split('\n');
	return renderBlocks(parseBlocks(lines), ctx);
}

export interface MdProps {
	/** Markdown source — a plain string or a tracked cell (reactive on client). */
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

function buildHtml(content: string, props: MdProps): string {
	const html = renderMarkdown(content, {
		highlight: props.highlight !== false,
		chrome: props.highlight !== false,
		lineNumbers: props.lineNumbers === true,
		copy: props.copy !== false,
		ids: props.ids !== false,
		autolink: props.autolink !== false,
		hardBreaks: props.hardBreaks === true,
	});
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
	const content = String(unwrapMaybeCell(rawContent) ?? '');
	const html = buildHtml(content, props);
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

	// A tracked `content` cell re-renders the markdown reactively on the
	// client (per-keystroke live editing works without any extra wiring).
	const reactive = isCell(rawContent);

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
		el.innerHTML = html;
		el.className = className;
		el.style.cssText = [wrapperStyle, style].filter(Boolean).join(';');
		wireCopyHandlers(el);
		if (reactive) subscribeContent(el, rawContent, props);
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
	if (reactive) subscribeContent(div, rawContent, props);
	return div;
}

function subscribeContent(el: HTMLElement, rawContent: unknown, props: MdProps): void {
	effect(() => {
		const value = String(unwrapMaybeCell(rawContent) ?? '');
		el.innerHTML = buildHtml(value, props);
		wireCopyHandlers(el);
	});
}
