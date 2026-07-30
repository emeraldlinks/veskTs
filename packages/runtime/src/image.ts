interface ImageProps {
	src: string;
	alt?: string;
	width?: number | string;
	height?: number | string;
	priority?: boolean;
	loading?: 'lazy' | 'eager';
	decoding?: 'sync' | 'async';
	fetchpriority?: 'high' | 'low' | 'auto';
	sizes?: string;
	widths?: number[];
	class?: string;
	style?: string;
	placeholder?: string;
	[k: string]: unknown;
}

function generateSrcset(src: string, widths: number[]): string {
	if (!src || widths.length === 0) return '';
	const ext = src.lastIndexOf('.') > src.lastIndexOf('/') ? src.slice(src.lastIndexOf('.')) : '';
	const base = ext ? src.slice(0, -ext.length) : src;
	return widths.map(w => `${base}-${w}w${ext} ${w}w`).join(', ');
}

export function Image(props: ImageProps): Node | string {
	const {
		src,
		alt = '',
		width,
		height,
		priority = false,
		loading = priority ? 'eager' : 'lazy',
		decoding = priority ? 'sync' : 'async',
		fetchpriority = priority ? 'high' : 'auto',
		sizes = '100vw',
		widths = [640, 768, 1024, 1280, 1536],
		class: className = '',
		style = '',
		placeholder,
		...rest
	} = props;

	const srcset = generateSrcset(src, widths);
	const attrs: Record<string, string | boolean | undefined> = {
		src,
		alt,
		loading,
		decoding,
		fetchpriority,
		sizes,
		width: width ? String(width) : undefined,
		height: height ? String(height) : undefined,
		class: className || undefined,
		style: style || undefined,
		...rest,
	};
	if (srcset) attrs.srcset = srcset;

	if (typeof document === 'undefined') {
		const attrStr = Object.entries(attrs)
			.filter(([, v]) => v != null && v !== false)
			.map(([k, v]) => v === true ? k : `${k}="${String(v).replace(/"/g, '&quot;')}"`)
			.join(' ');
		const phStyle = placeholder ? `background:${placeholder};background-size:cover;` : '';
		const wrapperStyle = width && height ? `display:inline-block;width:${typeof width === 'number' ? width + 'px' : width};height:${typeof height === 'number' ? height + 'px' : height};overflow:hidden;${phStyle}` : phStyle;
		return `<span style="${wrapperStyle}"><img ${attrStr} /></span>`;
	}

	const el = document.createElement('span');
	const img = document.createElement('img');
	for (const [k, v] of Object.entries(attrs)) {
		if (v != null && v !== false) img.setAttribute(k, v === true ? '' : String(v));
	}
	if (placeholder) el.style.background = placeholder;
	if (width && height) {
		el.style.display = 'inline-block';
		el.style.width = typeof width === 'number' ? width + 'px' : width;
		el.style.height = typeof height === 'number' ? height + 'px' : height;
		el.style.overflow = 'hidden';
	}
	el.appendChild(img);
	return el;
}
