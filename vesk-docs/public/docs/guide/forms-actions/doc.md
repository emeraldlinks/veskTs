# Forms & Server Actions

Progressive-enhancement forms: they work without JavaScript (native POST
round-trip with server-rendered validation errors) and upgrade to JSON
fetch round-trips when hydrated. Auto-imported inside components.

## `<Form>` and `<Field>`

Actions are defined at **module top level** in the `.vsk` file — the
compiler rewrites them per bundle: the server keeps `execute`, the client
bundle gets a lightweight stub `{ id, url }` (`execute` never ships to the
browser).

```vsk
import { Form, Field, required, email, minLength, defineAction } from '@vesk/runtime'

const signup = defineAction({
	input: {
		name: required('Name is required'),
		email: [required('Email is required'), email('Enter a valid email')],
		password: minLength(6, 'Password must be at least 6 characters'),
	},
	execute: async (input) => {
		await createUser(input);
		return { ok: true };
	},
})

component Signup() {
	<Form action={signup} onSuccess={() => console.log('done')}>
		<Field name="name" label="Name">
			<input name="name" />
		</Field>
		<Field name="email" label="Email">
			<input name="email" type="email" />
		</Field>
		<Field name="password" label="Password">
			<input name="password" type="password" />
		</Field>
		<button type="submit">Sign up</button>
	</Form>
}
```

```ts
/**
 * Progressive-enhancement form.
 * action: URL string (FormData POST) OR a defineAction() result/stub
 *         (JSON POST to the action endpoint).
 * method: default 'POST'.
 *
 * Submit priority: onSubmit > object action descriptor > string action URL.
 * Events dispatched on the form element:
 *   vsk-loading { detail: { loading } }
 *   vsk-success { detail: { response, data } }
 *   vsk-error   { detail: { issues } | { error } | { errors: true } }
 * While submitting: class vsk-submitting added, submit button disabled.
 */
function Form(props: {
	children?: unknown;
	onSubmit?: (data: Record<string, unknown>, form: HTMLFormElement) => void | Promise<void>;
	onError?: (err: unknown) => void;
	onSuccess?: (res: Response) => void;
	action?: string | Record<string, unknown>;
	method?: string;
	class?: string;
	style?: string;
	[k: string]: unknown;    // extra attrs render on SSR
}): Node | string;

/**
 * Field wrapper: label + input slot + hidden error div.
 * SSR marks it data-vsk-field="{name}"; client validation writes the
 * first failing rule message into data-vsk-error and reveals it.
 * After a no-JS post-back failure the server re-renders the page with
 * __vesk_action_errors set, so errors appear server-side too.
 */
function Field(props: {
	name: string;              // required
	label?: string;            // HTML-escaped on SSR
	rules?: ValidationRule[];  // extra client rules
	children?: string | Node;
	errorClass?: string;
	class?: string;
	style?: string;
	[k: string]: unknown;
}): Node | string;
```

## Validators

All take an optional custom message last. All except `required`/`custom`
**pass when the value is empty** (optional fields):

```ts
/**
 * Validation rule: { validate(v): boolean, message: string }.
 */
interface ValidationRule {
	validate: (v: unknown) => boolean;
	message: string;
}

/** Non-null, non-empty. Default message 'This field is required'. */
function required(msg?: string): ValidationRule;

/** Email shape check. Default 'Invalid email address'. */
function email(msg?: string): ValidationRule;

/** String/array length >= n. */
function minLength(n: number, msg?: string): ValidationRule;

/** String/array length <= n. */
function maxLength(n: number, msg?: string): ValidationRule;

/** RegExp test. Default 'Invalid format'. */
function pattern(re: RegExp, msg?: string): ValidationRule;

/** Your own predicate. Default 'Invalid value'. */
function custom(fn: (v: unknown) => boolean, msg?: string): ValidationRule;
```

## `defineAction` — server actions

Actions are defined in `.vsk` component code. The compiler gives each one
a **stable id derived from its source text**, keeps `execute` server-only
(stripped from client bundles), and exposes an endpoint
`POST /_vesk/action/:id`.

```ts
/**
 * Define a server action.
 *   defineAction(id, { input?, execute })  — explicit stable id
 *   defineAction({ input?, execute })      — id from source hash
 * Returns { id, url: '/_vesk/action/<id>', input, execute }.
 * execute(input, ctx) runs ONLY on the server.
 */
function defineAction(config: ActionConfig | string, config2?: ActionConfig): ActionDefinition;

/** Look up a registered action by id (server side). */
function getAction(id: string): ActionConfig | null;

/** Test-time helper: clear the registry. */
function clearActions(): void;

/** Type guard for ActionDefinition | stub. */
function isFormAction(action: unknown): boolean;

/** Run input schema against values → [{ field, message }] */
function validateActionInput(def: ActionConfig, input: Record<string, unknown>): ActionIssue[];

/** Convert issues to { fieldName: firstMessage } map. */
function issuesToFieldMap(issues: ActionIssue[]): Record<string, string>;

interface ActionContext {
	request: Request;
	params: Record<string, string>;
	url: string;
	headers(): Map<string, string>;      // lower-cased keys
	cookies(): Record<string, string>;
	locals(): Record<string, unknown>;
	redirect(url: string, status?: number): Response;  // default 303
}

interface ActionConfig {
	input?: Record<string, ValidationRule | ValidationRule[]>;
	execute: (input: Record<string, unknown>, ctx: ActionContext) => unknown | Promise<unknown>;
}
```

## Round-trip behavior

| Client | Server response |
| --- | --- |
| JS fetch (`<Form action={action}>`) | `200 { ok: true, data }` or `200 { ok: false, issues: [{field,message}] }` — messages map onto matching fields |
| No-JS native POST | validation failure re-renders the referer page with visible field errors; success **303-redirects back** to the referer (+query) |
| Cross-site browser submission | **403** `{ ok:false, error:'Cross-origin request blocked' }` (same-origin CSRF assert) |
| Unknown action id | `404 { ok:false, error:'Action not found' }` |

Body parsing accepts JSON, multipart/form-data, urlencoded, or text→JSON.
Request bodies are capped (default 1 MiB → 413).

## Plain forms (no actions)

```vsk
component Contact() {
	<Form action="/api/contact" onError={(e) => console.error(e)}>
		<Field name="message" label="Message">
			<textarea name="message"></textarea>
		</Field>
		<button>Send</button>
	</Form>
}
```

String actions POST raw FormData to the URL — pair with an API route that
calls `req.formData()`.
