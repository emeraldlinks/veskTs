import type { HydrateWalker } from '@vesk/runtime/src/hydrate';

// =============================================================
// Markdown rendering for <Md content={...} />.
//
// Tokenizer-based (no regex) — mirrors the compiler's no-regex
// rule for source-text handling. Raw HTML is never passed through;
// everything is escaped so content is safe to render as-is.
// =============================================================

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
	lang: string;
}

function fenceInfo(line: string): FenceInfo | null {
	const t = line.trim();
	const ch = t[0];
	if (ch !== '`' && ch !== '~') return null;
	let n = 0;
	while (n < t.length && t[n] === ch) n++;
	if (n < 3) return null;
	return { char: ch, len: n, lang: t.slice(n).trim() };
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

type Block =
	| { type: 'paragraph'; text: string }
	| { type: 'heading'; level: number; text: string }
	| { type: 'hr' }
	| { type: 'code'; code: string; lang: string }
	| { type: 'blockquote'; blocks: Block[] }
	| { type: 'list'; ordered: boolean; items: Array<{ blocks: Block[] }> };

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
			blocks.push({ type: 'code', code: codeLines.join('\n'), lang: fence.lang });
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
			blocks.push({ type: 'code', code: codeLines.join('\n'), lang: '' });
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
				items: [],
			};
			while (i < lines.length) {
				const l = lines[i];
				const m = parseListMarker(l);
				if (!m) break;
				if (m.ordered !== list.ordered) break;
				const contentIndent = m.contentStart;
				const itemLines: string[] = [l.slice(m.contentStart)];
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
				list.items.push({ blocks: parseBlocks(itemLines) });
			}
			blocks.push(list);
			continue;
		}

		const paraLines: string[] = [trimmed];
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
			paraLines.push(t);
			i++;
		}
		blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
	}
	return blocks;
}

function renderListItem(item: { blocks: Block[] }): string {
	const blocks = item.blocks;
	if (blocks.length === 1 && blocks[0].type === 'paragraph') {
		return `<li>${renderInline(blocks[0].text)}</li>`;
	}
	const parts: string[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		if (i === 0 && b.type === 'paragraph') {
			parts.push(renderInline(b.text));
		} else {
			parts.push(renderBlock(b));
		}
	}
	return `<li>${parts.join('\n')}</li>`;
}

function renderBlock(b: Block): string {
	if (b.type === 'paragraph') {
		return `<p>${renderInline(b.text)}</p>`;
	}
	if (b.type === 'heading') {
		return `<h${b.level}>${renderInline(b.text)}</h${b.level}>`;
	}
	if (b.type === 'hr') {
		return '<hr />';
	}
	if (b.type === 'code') {
		const lang = b.lang ? ` class="language-${escapeHtml(b.lang)}"` : '';
		return `<pre><code${lang}>${escapeHtml(b.code)}</code></pre>`;
	}
	if (b.type === 'blockquote') {
		return `<blockquote>${renderBlocks(b.blocks)}</blockquote>`;
	}
	return renderList(b);
}

function renderList(b: { ordered: boolean; items: Array<{ blocks: Block[] }> }): string {
	const tag = b.ordered ? 'ol' : 'ul';
	const items = b.items.map(renderListItem).join('\n');
	return `<${tag}>\n${items}\n</${tag}>`;
}

function renderBlocks(blocks: Block[]): string {
	const out: string[] = [];
	for (const b of blocks) {
		out.push(renderBlock(b));
	}
	return out.join('\n');
}

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

function renderInline(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const ch = text[i];

		if (ch === '\\' && i + 1 < text.length) {
			out += escapeHtml(text[i + 1]);
			i += 2;
			continue;
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
				out += `<del>${renderInline(text.slice(i + 2, close))}</del>`;
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
				const inner = tryEmphasis(text, i);
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
					out += `<img src="${escapeHtml(link.url)}" alt="${escapeHtml(link.alt)}" />`;
				} else {
					out += `<a href="${escapeHtml(link.url)}">${renderInline(link.text)}</a>`;
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
				return { html: `<strong>${renderInline(text.slice(start + 2, j))}</strong>`, end: j + 2 };
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
			return { html: `<em>${renderInline(text.slice(start + 1, j))}</em>`, end: j + 1 };
		}
		j++;
	}
	return null;
}

export function renderMarkdown(md: string): string {
	const lines = String(md == null ? '' : md).split('\n');
	return renderBlocks(parseBlocks(lines));
}

export interface MdProps {
	content?: string;
	class?: string;
	className?: string;
	style?: string;
	[k: string]: unknown;
}

function mdIsSSR(): boolean {
	return typeof document === 'undefined';
}

/**
 * Renders markdown as HTML. On the server it returns an HTML string; on the
 * client it claims the SSR-rendered subtree during hydration (or builds a
 * fresh wrapper element for SPA navigation).
 */
export function Md(props: MdProps, _registry?: Map<string, unknown>, hydrate?: HydrateWalker): Node | string {
	const content = props.content == null ? '' : String(props.content);
	const html = renderMarkdown(content);
	const className = props.className != null ? String(props.className) : props.class != null ? String(props.class) : '';
	const style = props.style != null ? String(props.style) : '';

	if (mdIsSSR()) {
		const attrs = className ? ` class="${escapeHtml(className)}"` : '';
		const styleAttr = style ? ` style="${style.split('"').join('&quot;')}"` : '';
		return `<div${attrs}${styleAttr}>${html}</div>`;
	}

	if (hydrate && typeof hydrate.nextElement === 'function') {
		let el = hydrate.nextElement('div') as HTMLElement;
		if (el && !el.parentNode && hydrate.root) {
			const existing = hydrate.root.querySelector('div');
			if (existing) el = existing as HTMLElement;
		}
		el.innerHTML = html;
		if (className) el.className = className;
		if (style) el.style.cssText = style;
		return document.createDocumentFragment();
	}

	const div = document.createElement('div');
	div.innerHTML = html;
	if (className) div.className = className;
	if (style) div.style.cssText = style;
	return div;
}
