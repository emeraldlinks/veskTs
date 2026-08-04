import type { ValidationRule } from './form';

export interface ActionIssue {
	field: string;
	message: string;
}

export type ActionInputSchema = Record<string, ValidationRule | ValidationRule[]>;

export interface ActionContext {
	request: Request;
	params: Record<string, string>;
	url: string;
	headers: () => Map<string, string>;
	cookies: () => Record<string, string>;
	locals: () => Record<string, unknown>;
	redirect: (url: string, status?: number) => Response;
}

export interface ActionConfig {
	input?: ActionInputSchema;
	execute: (input: Record<string, unknown>, ctx: ActionContext) => unknown | Promise<unknown>;
}

export interface ActionDefinition extends ActionConfig {
	id: string;
	url: string;
}

export interface ActionStub {
	__veskAction: true;
	id: string;
	url: string;
}

export type FormAction = string | ActionDefinition | ActionStub;

const registryKey = '__vesk_actions';

function getActionRegistry(): Record<string, ActionConfig> {
	const g = globalThis as Record<string, unknown>;
	if (!g[registryKey]) g[registryKey] = {};
	return g[registryKey] as Record<string, ActionConfig>;
}

function hashString(str: string): string {
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		h1 ^= c;
		h1 = Math.imul(h1, 0x01000193) >>> 0;
		h2 ^= c;
		h2 = Math.imul(h2, 0x01000193) >>> 0;
	}
	return (h1 ^ h2).toString(36).slice(0, 12);
}

function computeActionId(def: ActionConfig): string {
	return hashString(String(def.execute || ''));
}

/**
 * Define a server action from a page component.
 *
 * Generated server code calls `defineAction("<stable-id>", { input, execute })`
 * so both the client stub and the server registration share one id. When called
 * directly (no compiler transform), the id is derived from the `execute` source.
 */
export function defineAction(config: ActionConfig | string, config2?: ActionConfig): ActionDefinition {
	let def: ActionConfig;
	let id: string | null = null;
	if (typeof config === 'string') {
		id = config;
		def = config2!;
	} else {
		def = config;
	}
	if (!def || typeof def.execute !== 'function') {
		throw new Error('defineAction requires an object with an `execute` function');
	}
	if (!id) id = computeActionId(def);
	const registry = getActionRegistry();
	if (!registry[id]) registry[id] = def;
	return { id, url: `/_vesk/action/${id}`, input: def.input, execute: def.execute };
}

export function getAction(id: string): ActionConfig | null {
	return getActionRegistry()[id] || null;
}

export function clearActions(): void {
	const g = globalThis as Record<string, unknown>;
	g[registryKey] = {};
}

export function isFormAction(action: unknown): action is ActionDefinition | ActionStub {
	return (
		typeof action === 'object' &&
		action !== null &&
		((action as ActionStub).__veskAction === true ||
			(typeof (action as ActionDefinition).id === 'string' &&
				typeof (action as ActionDefinition).url === 'string'))
	);
}

export function validateActionInput(def: ActionConfig, input: Record<string, unknown>): ActionIssue[] {
	const issues: ActionIssue[] = [];
	for (const [field, ruleOrRules] of Object.entries(def.input || {})) {
		const rules = Array.isArray(ruleOrRules) ? ruleOrRules : [ruleOrRules];
		for (const rule of rules) {
			if (rule && !rule.validate(input[field])) {
				issues.push({ field, message: rule.message });
				break;
			}
		}
	}
	return issues;
}

export function issuesToFieldMap(issues: ActionIssue[]): Record<string, string> {
	const map: Record<string, string> = {};
	for (const issue of issues) {
		if (!(issue.field in map)) map[issue.field] = issue.message;
	}
	return map;
}
