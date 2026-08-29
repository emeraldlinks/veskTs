import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

const DOCS_DIR = join(process.cwd(), 'docs');

// Dynamic docs API — /api/docs/guide/reactivity → reads docs/guide/reactivity/doc.md
// (also tries a bare name.md fallback). Path traversal guard included.
// The body is streamed in ~400-byte chunks so useFetch.stream() consumers
// (e.g. <Md content={docRes} />) re-render progressively on the client.
export async function GET(request: Request, { params }: { params: Promise<Record<string, string>> }) {
	const { path } = await params;
	const raw = Array.isArray(path) ? path.join('/') : String(path ?? '');

	const rel = normalize(raw).replace(/^([/\\])+/, '');
	if (rel.includes('..')) {
		return new Response('invalid path', { status: 400 });
	}

	let content: string | null = null;
	for (const file of [
		join(DOCS_DIR, rel, 'doc.md'),
		join(DOCS_DIR, rel.endsWith('.md') ? rel : `${rel}.md`),
	]) {
		try {
			content = readFileSync(file, 'utf8');
			break;
		} catch {
			/* try next */
		}
	}
	if (content === null) {
		return new Response('not found', { status: 404 });
	}

	const encoder = new TextEncoder();
	let offset = 0;
	const chunkSize = 400;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const timer = setInterval(() => {
				if (offset >= content.length) {
					clearInterval(timer);
					controller.close();
					return;
				}
				const chunk = content.slice(offset, offset + chunkSize);
				offset += chunk.length;
				controller.enqueue(encoder.encode(chunk));
			}, 8);
		},
		cancel() {
			/* client aborted — nothing to release */
		},
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
}