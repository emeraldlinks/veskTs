interface ValidationRule {
	validate: (v: unknown) => boolean;
	message: string;
}

interface FieldProps {
	name: string;
	label?: string;
	rules?: ValidationRule[];
	children?: string;
	errorClass?: string;
	class?: string;
	style?: string;
	[k: string]: unknown;
}

interface FormProps {
	children?: string;
	onSubmit?: (data: Record<string, unknown>, form: HTMLFormElement) => void | Promise<void>;
	onError?: (err: unknown) => void;
	onSuccess?: (res: Response) => void;
	action?: string;
	method?: string;
	class?: string;
	style?: string;
	[k: string]: unknown;
}

function formIsSSR(): boolean {
	return typeof document === 'undefined';
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

export function Field(props: FieldProps): HTMLElement | string {
	const { name, label, rules = [], children, errorClass, class: className, style, ...rest } = props;

	if (formIsSSR()) {
		const labelHtml = label ? `<label>${label}</label>` : '';
		const errStyle = 'display:none';
		const errCls = errorClass ? ` class="${errorClass}"` : '';
		const wrapCls = className ? ` class="${className}"` : '';
		const wrapStyle = style ? ` style="${String(style).replace(/"/g, '&quot;')}"` : '';
		const fieldAttrs = ` data-vsk-field="${name}"`;
		const extra = Object.entries(rest).filter(([, v]) => v != null && v !== false).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
		return `<div${fieldAttrs}${wrapCls}${wrapStyle}${extra}>${labelHtml}${children || ''}<div data-vsk-error style="${errStyle}"${errCls}></div></div>`;
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
	if (children) wrapper.insertAdjacentHTML('beforeend', children);

	const errEl = document.createElement('div');
	errEl.setAttribute('data-vsk-error', '');
	errEl.style.display = 'none';
	if (errorClass) errEl.className = errorClass;
	wrapper.appendChild(errEl);

	return wrapper;
}

export function Form(props: FormProps): HTMLElement | string {
	const { children, onSubmit, onError, onSuccess, action, method = 'POST', class: className, style, ...rest } = props;

	if (formIsSSR()) {
		const attrs: Record<string, string | boolean> = { action: action || '', method };
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

	const form = document.createElement('form');
	if (action) form.action = action;
	if (method) form.method = method;
	if (className) form.className = className;
	if (style) form.style.cssText = style;
	for (const [k, v] of Object.entries(rest)) {
		if (typeof v === 'string') form.setAttribute(k, v);
	}

	if (children) form.insertAdjacentHTML('beforeend', children);

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
			const rules = ((el as unknown as Record<string, unknown>).__vsk_rules || []) as ValidationRule[];
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

		try {
			if (onSubmit) {
				const result = onSubmit(obj, form);
				if (result && typeof (result as Promise<void>).then === 'function') await (result as Promise<void>);
			} else if (action) {
				const res = await fetch(action, { method, body: data });
				if (!res.ok) throw res;
				form.dispatchEvent(new CustomEvent('vsk-success', { detail: { response: res } }));
				if (onSuccess) onSuccess(res);
			}
		} catch (err) {
			form.dispatchEvent(new CustomEvent('vsk-error', { detail: { error: err } }));
			if (onError) onError(err);
		} finally {
			form.classList.remove('vsk-submitting');
		}
	});

	return form;
}
