interface ExperimentVariant {
	name?: string;
	weight?: number;
	children?: unknown;
	content?: unknown;
	[k: string]: unknown;
}

interface ExperimentProps {
	name: string;
	variants?: ExperimentVariant[];
	default?: unknown;
	sticky?: boolean;
	track?: boolean;
}

function getUserId(): string {
	if (typeof document === 'undefined') return '';
	let id = sessionStorage.getItem('vsk_exp_user');
	if (!id) {
		id = Math.random().toString(36).slice(2, 10);
		sessionStorage.setItem('vsk_exp_user', id);
	}
	return id;
}

function selectVariant(variants: ExperimentVariant[], seed: string): ExperimentVariant | undefined {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		const char = seed.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash;
	}
	const r = (Math.abs(hash) % 10000) / 10000;
	const totalWeight = variants.reduce((s, v) => s + (v.weight || 1), 0);
	let cumulative = 0;
	for (const v of variants) {
		cumulative += (v.weight || 1) / totalWeight;
		if (r <= cumulative) return v;
	}
	return variants[variants.length - 1];
}

function isSSR(): boolean {
	return typeof document === 'undefined';
}

function getCookie(name: string): string | null {
	if (isSSR()) return null;
	const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
	return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, maxAge = 86400): void {
	if (isSSR()) return;
	document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};SameSite=Lax`;
}

export function Experiment(props: ExperimentProps): unknown {
	const {
		name,
		variants = [],
		default: defaultContent = null,
		sticky = true,
		track = true,
	} = props;

	const cookieName = `vsk_exp_${name}`;
	let assignedVariant: ExperimentVariant | undefined;

	if (isSSR()) {
		const seed = name;
		assignedVariant = selectVariant(variants, seed);
		return assignedVariant ? assignedVariant.children || assignedVariant.content || null : defaultContent;
	}

	const userId = getUserId();
	const seed = name + userId;

	if (sticky) {
		const stored = getCookie(cookieName);
		if (stored) {
			assignedVariant = variants.find(v => v.name === stored);
		}
	}

	if (!assignedVariant) {
		assignedVariant = selectVariant(variants, seed);
		if (sticky && assignedVariant) {
			setCookie(cookieName, assignedVariant.name || 'default', 86400 * 30);
		}
	}

	if (track && assignedVariant && typeof window !== 'undefined') {
		const w = window as unknown as Record<string, unknown>;
		const existing = w.__vsk_experiments || (w.__vsk_experiments = []) as unknown[];
		(existing as { experiment: string; variant: string }[]).push({ experiment: name, variant: assignedVariant.name || 'default' });
	}

	return assignedVariant ? assignedVariant.children || assignedVariant.content || null : defaultContent;
}
