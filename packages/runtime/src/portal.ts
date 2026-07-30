interface PortalProps {
	target: string | HTMLElement;
	children?: Node | ((frag: DocumentFragment) => void);
	[k: string]: unknown;
}

export function Portal(props: PortalProps, _registry?: Map<string, unknown>, _ctx?: unknown): Node | string {
	if (typeof document === 'undefined') return '';
	const target = typeof props.target === 'string'
		? document.querySelector(props.target)
		: props.target;
	if (!target) return document.createComment('portal: no target');
	if (props.children != null) {
		if (typeof props.children === 'function') {
			const frag = document.createDocumentFragment();
			(props.children as (frag: DocumentFragment) => void)(frag);
			target.appendChild(frag);
		} else {
			target.appendChild(props.children as Node);
		}
	}
	return document.createComment('portal');
}
