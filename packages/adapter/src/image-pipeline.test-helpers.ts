/**
 * Test helper exposing the srcset URL list that `collectImageRefs` /
 * `optimizeImages` must make reachable.
 *
 * `<Image>`'s `generateSrcset` lives inside the runtime package's private
 * scope, so the pipeline tests derive the same URLs here rather than
 * duplicating the rule by hand in every assertion.
 */
export function generateSrcsetForTest(
	src: string,
	widths: number[],
): Array<{ url: string; descriptor: string }> {
	if (!src || widths.length === 0) return [];
	const ext = src.lastIndexOf('.') > src.lastIndexOf('/') ? src.slice(src.lastIndexOf('.')) : '';
	const base = ext ? src.slice(0, -ext.length) : src;
	return widths.map(w => ({ url: `${base}-${w}w${ext}`, descriptor: `${w}w` }));
}