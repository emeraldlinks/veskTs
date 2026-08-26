/**
 * Md raw-HTML policy plugin — surfaces the Markdown HTML policy as editor
 * warnings ("ide debug") so users are informed wherever markdown content is
 * authored:
 *
 * - `.vsk` files: raw-HTML tags inside template-literal strings (inline
 *   markdown content, e.g. `<Md content={featureDoc}>`) and `<Md>` usages
 *   themselves get diagnostics; hovering `<Md` explains the effective policy.
 * - Markdown documents (`.md`): every raw-HTML tag is diagnosed.
 *
 * The plugin is policy-aware: when the workspace's vesk.config.ts enables
 * `md.html = 'allow' | 'allowlist'`, the message changes from "this will be
 * escaped" to "passthrough is enabled — only render trusted content".
 */

import type { LanguageServicePlugin } from '@volar/language-service';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface DetectedTag {
	start: number;
	end: number;
	tag: string;
}

let workspaceRoot: string | null = null;
let cachedPolicy: { mode: string; readAt: number } | null = null;

/** Called by the server on initialize so the plugin can find vesk.config. */
export function setMdPluginWorkspaceRoot(root: string | null): void {
	workspaceRoot = root;
	cachedPolicy = null;
}

function detectPolicy(): string {
	if (!workspaceRoot) return 'escape';
	const now = Date.now();
	if (cachedPolicy && now - cachedPolicy.readAt < 5000) return cachedPolicy.mode;
	let mode = 'escape';
	for (const name of ['vesk.config.ts', 'vesk.config.js', 'vesk.config.mjs']) {
		const p = resolve(workspaceRoot, name);
		if (!existsSync(p)) continue;
		try {
			const text = readFileSync(p, 'utf-8');
			const keyIdx = text.indexOf('html');
			if (keyIdx !== -1) {
				// scan forward for a quoted mode value within ~80 chars
				const window = text.slice(keyIdx, keyIdx + 120);
				if (window.includes("'allowlist'") || window.includes('"allowlist"')) mode = 'allowlist';
				else if (window.includes("'allow'") || window.includes('"allow"')) mode = 'allow';
			}
		} catch {
			// unreadable config — keep escape default
		}
		break;
	}
	cachedPolicy = { mode, readAt: now };
	return mode;
}

function isAsciiLetter(c: string): boolean {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function isTagNameChar(c: string): boolean {
	return isAsciiLetter(c) || (c >= '0' && c <= '9') || c === '-';
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr', 'meta', 'link']);

/** Finds well-formed raw-HTML tags in `text`; used for .md content regions. */
function findRawHtmlTags(text: string): DetectedTag[] {
	const tags: DetectedTag[] = [];
	let i = 0;
	while (i < text.length) {
		if (text[i] !== '<') { i++; continue; }
		if (text.startsWith('<!--', i)) {
			const close = text.indexOf('-->', i + 4);
			i = close === -1 ? text.length : close + 3;
			continue;
		}
		let j = i + 1;
		let closing = false;
		if (text[j] === '/') { closing = true; j++; }
		if (!isAsciiLetter(text[j])) { i++; continue; }
		const nameStart = j;
		while (j < text.length && isTagNameChar(text[j])) j++;
		const tag = text.slice(nameStart, j).toLowerCase();
		if (VOID_TAGS.has(tag) || !closing) {
			// opening/void tag — record it; skip to '>' honoring quotes
			let k = j;
			let quote = '';
			while (k < text.length) {
				const c = text[k];
				if (quote !== '') { if (c === quote) quote = ''; }
				else if (c === '"' || c === "'") quote = c;
				else if (c === '>') break;
				k++;
			}
			if (k < text.length) {
				tags.push({ start: i, end: k + 1, tag });
				i = k + 1;
				continue;
			}
		}
		i++;
	}
	return tags;
}

/** Template-literal spans of a .vsk document (escape-aware backtick toggle). */
function templateLiteralSpans(text: string): Array<{ start: number; end: number }> {
	const spans: Array<{ start: number; end: number }> = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '\\') { i += 2; continue; }
		if (ch === '`') {
			const start = i;
			i++;
			while (i < text.length) {
				if (text[i] === '\\') { i += 2; continue; }
				if (text[i] === '`') break;
				i++;
			}
			spans.push({ start, end: Math.min(i + 1, text.length) });
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const q = ch;
			i++;
			while (i < text.length) {
				if (text[i] === '\\') { i += 2; continue; }
				if (text[i] === q) break;
				i++;
			}
			i++;
			continue;
		}
		if (ch === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			continue;
		}
		i++;
	}
	return spans;
}

function diagnosticMessage(tag: string, policy: string): { message: string; severity: number } {
	if (policy === 'escape') {
		return {
			severity: DiagnosticSeverity.Warning,
			message: `Raw HTML <${tag}> inside Markdown is ESCAPED by default and renders as visible text. ` +
				'To render it, set md.html = "allow" or "allowlist" (+ md.allowTags) in vesk.config.ts.',
		};
	}
	return {
		severity: DiagnosticSeverity.Information,
		message: `Raw HTML <${tag}> renders verbatim (md.html = "${policy}"). ` +
			'Only render markdown you trust — passthrough bypasses escaping.',
	};
}

export function createMdHtmlPlugin(): LanguageServicePlugin {
	return {
		name: 'vesk-md-html',
		capabilities: {
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false,
			},
			hoverProvider: true,
		},
		create(context) {
			function analyze(uri: string, text: string): { tags: DetectedTag[]; mdRanges: Array<{ start: number; end: number }> } {
				const mdRanges: Array<{ start: number; end: number }> = [];
				let tags: DetectedTag[] = [];
				if (uri.endsWith('.vsk')) {
					for (const span of templateLiteralSpans(text)) {
						mdRanges.push(span);
						tags.push(...findRawHtmlTags(text.slice(span.start, span.end)).map((t) => ({
							start: t.start + span.start,
							end: t.end + span.start,
							tag: t.tag,
						})));
					}
				} else {
					tags = findRawHtmlTags(text);
				}
				return { tags, mdRanges };
			}

			return {
				async provideDiagnostics(document, _token) {
					const uri = document.uri;
					if (!uri.endsWith('.vsk') && !uri.endsWith('.md') && !uri.endsWith('.markdown')) {
						return undefined;
					}
					const text = document.getText();
					const { tags } = analyze(uri, text);
					if (tags.length === 0) return undefined;
					const policy = detectPolicy();
					const diagnostics: any[] = [];
					for (const t of tags) {
						const { severity, message } = diagnosticMessage(t.tag, policy);
						diagnostics.push({
							range: {
								start: document.positionAt(t.start),
								end: document.positionAt(Math.min(t.end, text.length)),
							},
							severity,
							source: 'vesk',
							code: 'vesk-md-html',
							message,
						});
					}
					return diagnostics;
				},

				async provideHover(document, position, _token) {
					const uri = document.uri;
					if (!uri.endsWith('.vsk') && !uri.endsWith('.md')) return undefined;
					const offset = document.offsetAt(position);
					const text = document.getText();

					// Hovering an `<Md` usage in .vsk → explain the policy.
					if (uri.endsWith('.vsk')) {
						const mdIdx = text.lastIndexOf('<Md', offset);
						if (mdIdx !== -1 && offset <= mdIdx + 4 && offset - mdIdx >= 0 && offset - mdIdx < 40 && /^\s*$/.test(text.slice(mdIdx + 3, offset))) {
							const policy = detectPolicy();
							const what = policy === 'escape'
								? 'Raw HTML inside Markdown is **escaped** by default (renders as visible text).'
								: `Raw HTML passthrough is **enabled** (\`md.html = "${policy}"\`). Only render trusted content.`;
							return {
								contents: {
									kind: 'markdown',
									value: `**Md** — markdown renderer\n\n${what}\n\nConfigure via \`md: { html: 'escape' | 'allow' | 'allowlist', allowTags?: string[] }\` in \`vesk.config.ts\`, or per instance with the \`html\` / \`allowTags\` props.`,
								},
							};
						}
					}

					// Hovering a detected raw-HTML tag → inline explanation.
					const { tags } = analyze(uri, text);
					for (const t of tags) {
						if (offset >= t.start && offset <= t.end) {
							const policy = detectPolicy();
							const { message } = diagnosticMessage(t.tag, policy);
							return {
								contents: { kind: 'markdown', value: `**Md raw HTML** — ${message}` },
							};
						}
					}
					return undefined;
				},
			};
		},
	};
}
