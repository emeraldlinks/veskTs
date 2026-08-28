export interface GuideItem {
	path: string
}

export interface GuideGroup {
	title: string
	items: GuideItem[]
}

export const GUIDE: GuideGroup[] = [
	{
		title: 'Start',
		items: [
			{ path: 'getting-started' },
			{ path: 'cli' },
			{ path: 'dev-server' },
			{ path: 'configuration' },
		],
	},
	{
		title: 'Language',
		items: [
			{ path: 'language/components' },
			{ path: 'language/body-modes' },
			{ path: 'language/expression-mode' },
			{ path: 'language/statement-mode' },
			{ path: 'language/typescript' },
			{ path: 'language/styles' },
			{ path: 'language/client-boundary' },
			{ path: 'language/head-metadata' },
		],
	},
	{
		title: 'Reactivity',
		items: [{ path: 'reactivity' }],
	},
	{
		title: 'Routing',
		items: [
			{ path: 'routing/file-based' },
			{ path: 'routing/router-api' },
			{ path: 'routing/components-and-hooks' },
			{ path: 'routing/loading-states' },
			{ path: 'routing/error-handling' },
			{ path: 'routing/offline-network' },
			{ path: 'routing/loading-indicator' },
		],
	},
	{
		title: 'Rendering & data',
		items: [
			{ path: 'ssr-hydration' },
			{ path: 'data-fetching' },
			{ path: 'isr' },
			{ path: 'ssg' },
		],
	},
	{
		title: 'Forms & input',
		items: [
			{ path: 'forms-actions' },
			{ path: 'bindings' },
		],
	},
	{
		title: 'Built-ins',
		items: [
			{ path: 'built-ins/headless' },
			{ path: 'built-ins/portal' },
			{ path: 'built-ins/markdown' },
			{ path: 'built-ins/image' },
			{ path: 'built-ins/experiment' },
		],
	},
	{
		title: 'Server',
		items: [
			{ path: 'api-routes' },
			{ path: 'server/request-response' },
			{ path: 'server/cookies' },
			{ path: 'middleware' },
			{ path: 'seo' },
		],
	},
	{
		title: 'Production',
		items: [
			{ path: 'security' },
			{ path: 'deployment' },
		],
	},
	{
		title: 'Extending',
		items: [
			{ path: 'plugins' },
			{ path: 'tooling/lsp-editors' },
			{ path: 'tooling/prettier-tailwind' },
		],
	},
]

/** Mirrors the markdown renderer's stripMdMarkers so TOC ids line up. */
function stripMdMarkers(text: string): string {
	let out = ''
	let i = 0
	while (i < text.length) {
		const ch = text[i]
		if (ch === '`' || ch === '*' || ch === '_' || ch === '~') { i++; continue }
		if (ch === '\\') { out += text[i + 1] || ''; i += 2; continue }
		if (ch === '[' || ch === ']') { i++; continue }
		if (ch === '!') { i++; continue }
		out += ch
		i++
	}
	return out
}

/** Mirrors the renderer's slugify: name of the emitted heading id. */
export function slugify(text: string): string {
	const plain = stripMdMarkers(text).toLowerCase().trim()
	let out = ''
	let lastDash = true
	for (let i = 0; i < plain.length; i++) {
		const ch = plain[i]
		const ok = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
		if (ok) {
			out += ch
			lastDash = false
			continue
		}
		if (!lastDash) { out += '-'; lastDash = true }
	}
	while (out.endsWith('-')) out = out.slice(0, -1)
	return out || 'section'
}

export interface TocEntry {
	level: 2 | 3
	text: string
	id: string
}

/** Extract heading outline from markdown source, matching renderer ids. */
export function tocFrom(source: string): TocEntry[] {
	const seen = new Map<string, number>()
	const out: TocEntry[] = []
	let fence: null | 'fence' = null
	for (const raw of source.split('\n')) {
		const line = raw.trimEnd()
		const fenceMark = line.startsWith('```') || line.startsWith('~~~')
		if (fenceMark) {
			fence = fence ? null : 'fence'
			continue
		}
		if (fence) continue
		if (line.startsWith('>')) continue
		let level: 2 | 3 | 0 = 0
		let text = ''
		if (line.startsWith('### ')) {
			level = 3
			text = line.slice(4)
		} else if (line.startsWith('## ')) {
			level = 2
			text = line.slice(3)
		}
		if (level === 0) continue
		const base = slugify(text)
		const seenCount = seen.get(base) ?? 0
		seen.set(base, seenCount + 1)
		out.push({
			level,
			text: stripMdMarkers(text),
			id: seenCount === 0 ? base : `${base}-${seenCount + 1}`,
		})
	}
	return out
}

/** First `# ` heading (outside fences) — the page's own H1. */
export function firstHeading(source: string): string {
	let fence: null | 'fence' = null
	for (const raw of source.split('\n')) {
		const line = raw.trimEnd()
		const fenceMark = line.startsWith('```') || line.startsWith('~~~')
		if (fenceMark) {
			fence = fence ? null : 'fence'
			continue
		}
		if (fence) continue
		if (line.startsWith('# ')) return stripMdMarkers(line.slice(2)).trim()
	}
	return 'Vesk documentation'
}