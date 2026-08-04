import type { HydrateWalker } from '@vesk/runtime/src/hydrate';

export interface ValidationRule {
	validate: (v: unknown) => boolean;
	message: string;
}

interface FieldProps {
	name: string;
	label?: string;
	rules?: ValidationRule[];
	children?: string | Node;
	errorClass?: string;
	class?: string;
	style?: string;
	[k: string]: unknown;
}

interface FormProps {
	children?: string | Node;
	onSubmit?: (data: Record<string, unknown>, form: HTMLFormElement) => void | Promise<void>;
	onError?: (err: unknown) => void;
	onSuccess?: (res: Response) => void;
	action?: string | Record<string, unknown>;
	method?: string;
	class?: string;
	style?: string;
	[k: string]: unknown;
}

function appendChildren(parent: HTMLElement, children: unknown): void {
	if (children == null) return;
	if (typeof children === 'string' || typeof children === 'number') {
		parent.insertAdjacentHTML('beforeend', String(children));
	} else if (children instanceof Node) {
		parent.appendChild(children);
	} else if (Array.isArray(children)) {
		for (const c of children) appendChildren(parent, c);
	}
}

function formIsSSR(): boolean {
	return typeof document === 'undefined';
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function actionUrl(action: unknown): string {
	if (typeof action === 'string') return action;
	if (action && typeof action === 'object') {
		const a = action as { __veskAction?: unknown; url?: unknown };
		if (a.__veskAction === true || typeof a.url === 'string') return String(a.url || '');
	}
	return '';
}

function readServerFieldErrors(): Record<string, string> {
	return (globalThis as { __vesk_action_errors?: Record<string, string> }).__vesk_action_errors || {};
}

export function required(msg?: string): ValidationRule {
	return { validate: (v) => v != null && v !== '', message: msg || 'This field is required' };
}

export function email(msg?: string): ValidationRule {
	return { validate: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v as string), message: msg || 'Invalid email address' };
}

export function minLength(n: number, msg?: string): ValidationRule {
	return { validate: (v) => !v || (v as string).length >= n, message: msg || `Must be at least ${n} characters` };
}

export function maxLength(n: number, msg?: string): ValidationRule {
	return { validate: (v) => !v || (v as string).length <= n, message: msg || `Must be at most ${n} characters` };
}

export function pattern(re: RegExp, msg?: string): ValidationRule {
	return { validate: (v) => !v || re.test(v as string), message: msg || 'Invalid format' };
}

export function custom(fn: (v: unknown) => boolean, msg?: string): ValidationRule {
	return { validate: fn, message: msg || 'Invalid value' };
}

export function Field(props: FieldProps, registry?: Map<string, unknown>, hydrate?: HydrateWalker): Node | string {
	const { name, label, rules = [], children, errorClass, class: className, style, ...rest } = props;

	if (formIsSSR()) {
		const labelHtml = label ? `<label>${label}</label>` : '';
		const serverErrors = readServerFieldErrors();
		const serverErr = serverErrors[name] ? String(serverErrors[name]) : '';
		const errStyle = serverErr ? '' : 'display:none';
		const errText = serverErr ? escapeHtml(serverErr) : '';
		const errCls = errorClass ? ` class="${errorClass}"` : '';
		const wrapCls = className ? ` class="${className}"` : '';
		const wrapStyle = style ? ` style="${String(style).replace(/"/g, '&quot;')}"` : '';
		const fieldAttrs = ` data-vsk-field="${name}"`;
		const extra = Object.entries(rest).filter(([, v]) => v != null && v !== false).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
		return `<div${fieldAttrs}${wrapCls}${wrapStyle}${extra}>${labelHtml}${children || ''}<div data-vsk-error style="${errStyle}"${errCls}>${errText}</div></div>`;
	}

	if (hydrate && hydrate.nextElement) {
		let wrapper = hydrate.nextElement('div') as HTMLElement;
		if (wrapper && !wrapper.parentNode && hydrate.root) {
			const existing = hydrate.root.querySelector(`[data-vsk-field="${name}"]`);
			if (existing) wrapper = existing as HTMLElement;
		}
		const inner = wrapper ? wrapper.querySelector(`[data-vsk-field="${name}"]`) : null;
		const fieldEl = inner || wrapper;
		if (fieldEl) (fieldEl as unknown as Record<string, unknown>).__vsk_rules = rules;
		return document.createDocumentFragment();
	}

	const wrapper = document.createElement('div');
	wrapper.setAttribute('data-vsk-field', name);
	if (className) wrapper.className = className;
	if (style) wrapper.style.cssText = style;
	for (const [k, v] of Object.entries(rest)) {
		if (v != null && v !== false) wrapper.setAttribute(k, v === true ? '' : String(v));
	}
	(wrapper as unknown as Record<string, unknown>).__vsk_rules = rules;

	if (label) {
		const lbl = document.createElement('label');
		lbl.textContent = label;
		wrapper.appendChild(lbl);
	}
	if (children) appendChildren(wrapper, children);

	const errEl = document.createElement('div');
	errEl.setAttribute('data-vsk-error', '');
	errEl.style.display = 'none';
	if (errorClass) errEl.className = errorClass;
	wrapper.appendChild(errEl);

	return wrapper;
}

interface FormSubmitOptions {
	action?: string | Record<string, unknown>;
	method: string;
	onSubmit?: (data: Record<string, unknown>, form: HTMLFormElement) => void | Promise<void>;
	onError?: (err: unknown) => void;
	onSuccess?: (res: Response) => void;
}

function bindFormSubmit(form: HTMLFormElement, { action, method, onSubmit, onError, onSuccess }: FormSubmitOptions): void {
	const resolvedAction = actionUrl(action);
	const actionSchema = (typeof action === 'object' && action !== null && (action as Record<string, unknown>).input)
		? (action as Record<string, unknown>).input as Record<string, ValidationRule | ValidationRule[]>
		: undefined;

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const data = new FormData(form);
		const obj: Record<string, unknown> = {};
		for (const [k, v] of data.entries()) {
			if (k in obj) {
				if (!Array.isArray(obj[k])) obj[k] = [obj[k]];
				(obj[k] as unknown[]).push(v);
			} else {
				obj[k] = v;
			}
		}

		const fields = form.querySelectorAll('[data-vsk-field]');
		let hasErrors = false;
		for (const el of fields) {
			const fieldName = el.getAttribute('data-vsk-field');
			const propRules = ((el as unknown as Record<string, unknown>).__vsk_rules || []) as ValidationRule[];
			const schemaRules = fieldName && actionSchema && actionSchema[fieldName]
				? (Array.isArray(actionSchema[fieldName]) ? actionSchema[fieldName] : [actionSchema[fieldName]] as ValidationRule[])
				: [];
			const rules = [...propRules, ...schemaRules];
			const errEl = el.querySelector('[data-vsk-error]');
			let errMsg = '';
			for (const rule of rules) {
				if (!rule.validate(obj[fieldName || ''])) { errMsg = rule.message; break; }
			}
			if (errEl) {
				errEl.textContent = errMsg;
				(errEl as HTMLElement).style.display = errMsg ? '' : 'none';
			}
			if (errMsg) hasErrors = true;
		}
		if (hasErrors) { form.dispatchEvent(new CustomEvent('vsk-error', { detail: { errors: true } })); return; }

		form.classList.add('vsk-submitting');
		const submitBtn = form.querySelector<HTMLElement>('[type="submit"], button[type="submit"]');
		if (submitBtn) (submitBtn as HTMLButtonElement).disabled = true;
		form.dispatchEvent(new CustomEvent('vsk-loading', { detail: { loading: true } }));
		const isActionDescriptor = typeof action === 'object' && action !== null;

		try {
			if (onSubmit) {
				const result = onSubmit(obj, form);
				if (result && typeof (result as Promise<void>).then === 'function') await (result as Promise<void>);
			} else if (isActionDescriptor) {
				const res = await fetch(resolvedAction, {
					method,
					headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify(obj),
				});
				const payload = await res.json().catch(() => null);
				if (payload && payload.ok === false && Array.isArray(payload.issues)) {
					const byField: Record<string, string> = {};
					for (const issue of payload.issues) {
						if (issue && typeof issue.field === 'string' && !(issue.field in byField)) {
							byField[issue.field] = String(issue.message || 'Invalid value');
						}
					}
					let hasServerErrors = false;
					for (const el of fields) {
						const fieldName = el.getAttribute('data-vsk-field');
						const errEl = el.querySelector('[data-vsk-error]');
						const msg = fieldName ? byField[fieldName] : '';
						if (errEl) {
							errEl.textContent = msg;
							(errEl as HTMLElement).style.display = msg ? '' : 'none';
						}
						if (msg) hasServerErrors = true;
					}
					if (hasServerErrors) {
						form.dispatchEvent(new CustomEvent('vsk-error', { detail: { issues: payload.issues } }));
						return;
					}
				}
				if (!res.ok) throw res;
				form.dispatchEvent(new CustomEvent('vsk-success', { detail: { response: res, data: payload } }));
				if (onSuccess) onSuccess(res);
			} else if (resolvedAction) {
				const res = await fetch(resolvedAction, { method, body: data });
				if (!res.ok) throw res;
				form.dispatchEvent(new CustomEvent('vsk-success', { detail: { response: res } }));
				if (onSuccess) onSuccess(res);
			}
		} catch (err) {
			form.dispatchEvent(new CustomEvent('vsk-error', { detail: { error: err } }));
			if (onError) onError(err);
		} finally {
			if (submitBtn) (submitBtn as HTMLButtonElement).disabled = false;
			form.classList.remove('vsk-submitting');
			form.dispatchEvent(new CustomEvent('vsk-loading', { detail: { loading: false } }));
		}
	});
}

export function Form(props: FormProps, registry?: Map<string, unknown>, hydrate?: HydrateWalker): Node | string {
	const { children, onSubmit, onError, onSuccess, action, method = 'POST', class: className, style, ...rest } = props;

	if (formIsSSR()) {
		const attrs: Record<string, string | boolean> = { action: actionUrl(action), method, novalidate: true };
		if (className) attrs.class = className;
		if (style) attrs.style = style;
		for (const [k, v] of Object.entries(rest)) {
			if (v != null && v !== false) attrs[k] = v as string | boolean;
		}
		const attrStr = Object.entries(attrs)
			.filter(([, v]) => v != null && v !== false)
			.map(([k, v]) => v === true ? k : `${k}="${String(v).replace(/"/g, '&quot;')}"`)
			.join(' ');
		return `<form ${attrStr}>${children || ''}</form>`;
	}

	if (hydrate && hydrate.nextElement) {
		let form = hydrate.nextElement('form') as HTMLFormElement;
		if (form && !form.parentNode && hydrate.root) {
			const existing = hydrate.root.querySelector('form');
			if (existing) form = existing as HTMLFormElement;
		}
		if (form) {
			form.noValidate = true;
			bindFormSubmit(form, { action, method, onSubmit, onError, onSuccess });
		}
		return document.createDocumentFragment();
	}

	const form = document.createElement('form');
	const resolvedAction = actionUrl(action);
	if (resolvedAction) form.action = resolvedAction;
	if (method) form.method = method;
	form.noValidate = true;
	if (className) form.className = className;
	if (style) form.style.cssText = style;
	for (const [k, v] of Object.entries(rest)) {
		if (typeof v === 'string') form.setAttribute(k, v);
	}

	if (children) appendChildren(form, children);

	bindFormSubmit(form, { action, method, onSubmit, onError, onSuccess });

	return form;
}
