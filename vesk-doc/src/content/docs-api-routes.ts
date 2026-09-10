export type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: {
  slug: string;
  title: string;
  description: string;
  group: string;
  blocks: Block[];
}[] = [
  {
    slug: "api-routes",
    title: "API Routes",
    description:
      "Server-side endpoints under app/api/: route conventions, method handler exports, dynamic segments, body parsing, validation and VeskResponse.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "API routes provide server-side endpoints for data. They live under `app/api/` as `route.ts` (or `route.js`) files and export HTTP method handlers. The scanner maps folder structure to URL paths: a folder named `[id]` becomes a dynamic segment `:id`, `[...slug]` a catch-all `:slug`, folders starting with `_` are private and skipped, and `(group)` folders are route groups whose segment is dropped from the URL.",
      },
      { kind: "h2", text: "Route conventions" },
      {
        kind: "table",
        head: ["File path", "URL"],
        rows: [
          ["app/api/posts/route.ts", "/api/posts"],
          ["app/api/hello/route.ts", "/api/hello"],
          ["app/api/users/[id]/route.ts", "/api/users/:id"],
          ["app/api/blogs/[...slug]/route.ts", "/api/blogs/:slug*"],
          ["app/api/(marketing)/prices/route.ts", "/api/prices"],
        ],
      },
      { kind: "h2", text: "Method handlers" },
      {
        kind: "code",
        filename: "app/api/posts/route.ts",
        code: `export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || 10;
  const posts = await db.findPosts({ limit });
  return Response.json(posts);
}

export async function POST(request: Request) {
  const post = await request.json();
  const created = await db.insertPost(post);
  return Response.json(created, { status: 201 });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await request.json();
  return Response.json(await db.updatePost(id, body));
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.deletePost(id);
  return new Response(null, { status: 204 });
}`,
      },
      {
        kind: "list",
        items: [
          "Export named functions per HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (and `HEAD`). `OPTIONS` is generated automatically from the exported set; unknown methods get a `405` with an `Allow` header.",
          "Handlers are called as `handler(request, ctx)` where `ctx.params` is a `Promise<Record<string, string>>` — await it to read dynamic segments: `const { id } = await ctx.params`.",
          "Returning anything that is not a `Response` (a plain object or value) is serialized as JSON with status 200 automatically.",
          "A route module may export `config` (`{ csrf, maxDuration }`), `beforeRequest` and `afterRequest` hook arrays — see Route config & hooks below.",
        ],
      },
      { kind: "h2", text: "Dynamic segments" },
      {
        kind: "code",
        filename: "app/api/users/[id]/route.ts",
        code: `export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await db.findUser(id);
  if (!user) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json(user);
}`,
      },
      {
        kind: "p",
        text: "An `[...slug]` folder is a catch-all: the remainder of the path after the previous segment is captured as one parameter joined with `/` (e.g. `app/api/files/[...path]/route.ts` → `GET /api/files/a/b.md` gives `{ path: 'a/b.md' }`). URL-encoded segment values are decoded automatically.",
      },
      { kind: "h2", text: "Returning responses" },
      {
        kind: "table",
        head: ["Return", "Effect"],
        rows: [
          ["Response.json(data, init?)", "JSON body with your status/headers"],
          ["new Response(body, { status, headers })", "Arbitrary body (text, html, stream, null for 204)"],
          ["VeskResponse.json(...).setStatus(201).setCookie(...).build()", "Fluent response builder"],
          ["VeskResponse.redirect(url, 307) / VeskResponse.next()", "Redirect / pass-through responses"],
          ["any non-Response value", "Auto-serialized to JSON, status 200"],
        ],
      },
      {
        kind: "code",
        filename: "app/api/session/route.ts",
        code: `import { VeskResponse } from '@vesk/runtime';

export async function GET(request: Request) {
  return VeskResponse.json({ ok: true })
    .setStatus(200)
    .setCookie('session', 'abc123', { httpOnly: true, maxAge: 3600, sameSite: 'Lax' })
    .setCsp("default-src 'self'")
    .cache(60)
    .build();
}`,
      },
      {
        kind: "list",
        items: [
          "`VeskResponse` is a fluent `Response` subclass (exported from `@vesk/runtime`). Chain `.setStatus(code)`, `.setCookie(name, value, opts)`, `.clearCookie(name)`, `.cache(ttlSeconds)`, `.noCache()`, `.cors(...)`, `.setCsp(policy)`, `.setSecurityHeader(name, value)` and end with `.build()`. Statics: `json`, `html`, `stream`, `redirect` (default 307), `rewrite`, `next`.",
          "Cookie options: `httpOnly` (default true), `secure` (default true), `sameSite` (default 'Lax'), `maxAge`, `path`, `domain`.",
          "Security headers set via `setCsp`/`setSecurityHeader` are flushed by `.build()` (or lazily on `.text()`/`.json()`).",
          "A thrown `Redirect` error (status + url) or `NotFoundError` is turned into a 30x/404 response by the runtime.",
        ],
      },
      { kind: "h2", text: "Body parsing & validation" },
      {
        kind: "code",
        filename: "app/api/notes/route.ts",
        code: `import { VeskResponse, useBody } from '@vesk/runtime';

export async function POST() {
  const body = await useBody();
  // Parsed by content-type: JSON -> object, x-www-form-urlencoded -> record, otherwise text.
  const note = await db.saveNote(body);
  return VeskResponse.json(note).setStatus(201).build();
}`,
      },
      {
        kind: "code",
        filename: "app/api/login/route.ts",
        code: `import { withValidation } from '@vesk/runtime';
import { z } from 'zod';

const schema = z.object({
  email: z.string().min(1, 'Email is required'),
  password: z.string().min(8, 'Minimum 8 characters'),
});

export async function POST(request: Request) {
  const data = await withValidation(request, schema);
  if (data instanceof Response) return data; // 400 { error, issues: [{ path, message }] }

  const user = await db.verifyLogin(data.email, data.password);
  return Response.json({ ok: Boolean(user) });
}`,
      },
      {
        kind: "p",
        text: "`withValidation(request, schema, { jsonOnly? })` reads the request body (JSON, form-encoded, or text), runs `schema.safeParse(data)`, and returns either the parsed data or a 400 `ServerResponse.json({ error, issues })` response that you can short-circuit. `jsonOnly: true` forces JSON parsing. Body-reading failures return a 400 `Invalid request body` response.",
      },
      { kind: "h2", text: "Cookies, headers, locals" },
      {
        kind: "code",
        filename: "app/api/session/route.ts",
        code: `import { VeskResponse, cookies, headers, locals } from '@vesk/runtime';

export async function GET() {
  const session = cookies().get('session');
  const clientIp = headers().get('x-forwarded-for');
  const user = locals().user; // seeded by middleware via ctx.set('user', ...)

  return VeskResponse.json({ session, clientIp, user }).build();
}`,
      },
      {
        kind: "p",
        text: "`cookies()` returns a CookieStore with `get(name)`, `getAll()` and `toString()`; `headers()` a case-insensitive read proxy (`get`/`has`/`entries`); `locals()` the per-request store shared with middleware and the render. `useRequest()` returns the full request context and `useParams()` the current params.",
      },
      { kind: "h2", text: "Route config & hooks" },
      {
        kind: "code",
        filename: "app/api/webhooks/stripe/route.ts",
        code: `export const config = {
  csrf: false,      // skip the same-origin check (webhooks have no browser origin)
  maxDuration: 30,  // abort the request after 30 seconds
};

export async function POST(request: Request) {
  const event = await request.json();
  return Response.json({ received: true });
}`,
      },
      {
        kind: "note",
        tone: "info",
        text: "Mutating API calls (anything except GET/HEAD/OPTIONS) are checked for same-origin by default via `assertSameOrigin` — cross-origin requests get a 403. Opt out per route with `export const config = { csrf: false }`. `config.maxDuration` (seconds) aborts the request signal when exceeded. A route can also export `beforeRequest`/`afterRequest` arrays of hooks that may short-circuit or replace the response.",
      },
    ],
  },
  {
    slug: "isr",
    title: "Incremental Static Regeneration",
    description:
      "Page-, component- and data-level ISR with stale-while-revalidate, page config via export const, and targeted invalidation by path, tag or component.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "ISR renders pages, component snippets and data once and serves them cached, refreshing in the background after a TTL. The runtime caches are in-memory per server instance: a fresh entry is served until it expires; an expired entry is served immediately as `stale` while a background revalidation runs (stale-while-revalidate). If the background refresh fails, the stale entry stays in place. Setting `revalidate` to 0 (the default) disables caching for that call entirely.",
      },
      { kind: "h2", text: "Page-level ISR" },
      {
        kind: "code",
        filename: "app/loaders/home.ts",
        code: `import { pageIsr } from '@vesk/runtime';

export async function Loader() {
  return pageIsr(
    'homepage',
    async () => {
      const data = await fetchHomeData();
      return {
        html: renderHomeHtml(data),
        headers: { 'content-type': 'text/html' },
      };
    },
    { tags: ['home'], revalidate: 60 },
  );
}`,
      },
      {
        kind: "p",
        text: "`pageIsr(path, renderFn, opts?)` — the path is the cache key (trailing slashes collapse to `/`), `renderFn` returns `Promise<{ html, headers? }>`, and the result is `{ html, headers, stale }`. A cached hit serves `html` + `headers` without re-rendering. When expired, the stale HTML is served and `renderFn` runs again in the background.",
      },
      { kind: "h2", text: "Page-level config (export const)" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/page.vsk",
            code: `export const revalidate = 60;
export const isrTags = ['home'];

component Home() {
  <main>
    <h1>Home</h1>
    <p>This page is cached for 60 seconds and tagged "home".</p>
  </main>
}`,
          },
          {
            label: "expression mode",
            filename: "app/page.vsk",
            code: `export const revalidate = 60;
export const isrTags = ['home'];

component Home() {
  return (
    <main>
      <h1>Home</h1>
      <p>This page is cached for 60 seconds and tagged "home".</p>
    </main>
  );
}`,
          },
        ],
      },
      {
        kind: "p",
        text: "Declaring `export const revalidate = <seconds>` and `export const isrTags = [...]` in `page.vsk` enables page-level ISR for that route: the build records the TTL and tags, and the production server serves the page through `pageIsr` with the path as key. Configs that arrive as an object (platform manifests) are normalized with `isrConfigToRevalidate(config: unknown)`, which returns the number when given a number or a `{ revalidate }` object, else 0.",
      },
      { kind: "h2", text: "Component-level ISR" },
      {
        kind: "code",
        filename: "app/loaders/sidebar.ts",
        code: `import { componentIsr } from '@vesk/runtime';

export async function getSidebarHtml() {
  return componentIsr(
    'sidebar',
    async () => {
      const links = await getNavLinks();
      return \`<ul>\${links.map((l) => \`<li><a href="\${l.href}">\${l.label}</a></li>\`).join('')}</ul>\`;
    },
    { tags: ['nav'], revalidate: 120 },
  );
}`,
      },
      {
        kind: "p",
        text: "`componentIsr(key, renderFn, opts?)` caches a component snippet by `key` in a dedicated component cache (separate from the data and page caches). `renderFn` may be sync or async and returns the HTML string; `revalidate <= 0` skips caching. Component entries are indexed under tags as `comp:<key>`, so `revalidateTag('nav')` invalidates them along with any matching data/page entries.",
      },
      { kind: "h2", text: "Data-level ISR" },
      {
        kind: "code",
        filename: "app/loaders/products.ts",
        code: `import { isr } from '@vesk/runtime';

const { data, stale } = await isr(
  'product-list',
  async () => {
    const res = await fetch('https://api.store.com/products');
    return res.json();
  },
  { tags: ['products'], revalidate: 300 },
);`,
      },
      {
        kind: "p",
        text: "`isr(key, fetcher, opts?)` caches arbitrary data: `fetcher: () => Promise<unknown>` and the result is `{ data, stale }`. First call populates the cache; fresh calls return cached data with `stale: false`; after the TTL the cached data is returned with `stale: true` while the fetcher re-runs in the background.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/pricing/page.vsk",
            code: `import { isr } from '@vesk/runtime';

async component Pricing(props: { plans: { name: string }[] }) {
  {#server}
    const { data } = await isr('pricing', async () => {
      return await fetchPlans();
    }, { revalidate: 3600, tags: ['pricing'] });
  {/server}
  <ul>
    {props.plans.map((p) => <li>{p.name}</li>)}
  </ul>
}`,
          },
          {
            label: "expression mode",
            filename: "app/pricing/page.vsk",
            code: `import { isr } from '@vesk/runtime';

async component Pricing(props: { plans: { name: string }[] }) {
  {#server}
    const { data } = await isr('pricing', async () => {
      return await fetchPlans();
    }, { revalidate: 3600, tags: ['pricing'] });
  {/server}
  return (
    <ul>
      {props.plans.map((p) => <li>{p.name}</li>)}
    </ul>
  );
}`,
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "Wrap the `isr()` call in a `{#server}` block and mark the component `async component` so it only executes during server rendering — the block is stripped from the client bundle. Async data you only need on the server belongs here.",
      },
      { kind: "h2", text: "Revalidation" },
      {
        kind: "code",
        filename: "app/actions/publish.ts",
        code: `import { revalidatePath, revalidateTag, revalidateComponent, clearIsrCache } from '@vesk/runtime';

await revalidatePath('/products');   // drop keys equal to or starting with /products
await revalidateTag('products');     // drop every entry tagged 'products'
revalidateComponent('sidebar');      // drop just the 'sidebar' component entry
clearIsrCache();                     // wipe data + page + component caches and the tag index`,
      },
      {
        kind: "table",
        head: ["Function", "Signature", "Purpose"],
        rows: [
          ["pageIsr", "pageIsr(path, renderFn, { tags?, revalidate? })", "Cache a whole page's HTML + headers"],
          ["componentIsr", "componentIsr(key, renderFn, { tags?, revalidate? })", "Cache a component HTML snippet"],
          ["isr", "isr(key, fetcher, { tags?, revalidate? })", "Cache arbitrary data"],
          ["isrConfigToRevalidate", "isrConfigToRevalidate(config) => number", "TTL from a number or { revalidate } config"],
          ["revalidatePath", "revalidatePath(path) => Promise<void>", "Invalidate by path (exact + prefix)"],
          ["revalidateTag", "revalidateTag(tag) => Promise<void>", "Invalidate everything tagged"],
          ["revalidateComponent", "revalidateComponent(key) => void", "Invalidate one component entry"],
          ["clearIsrCache", "clearIsrCache() => void", "Clear data, page, component caches + tag index"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "All opts are `{ tags?: string[], revalidate?: number }` with `revalidate` in seconds. `revalidatePath` normalizes the path (trailing slashes collapse) and deletes the exact key plus every key that starts with it. `revalidateTag` deletes data/page entries and component entries (`comp:<key>`) sharing the tag, then removes the tag index itself.",
      },
    ],
  },
  {
    slug: "forms",
    title: "Forms & Validation",
    description:
      "The Form and Field components, validation rules, and server actions with defineAction, validateActionInput and issuesToFieldMap.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "Vesk's `<Form>` and `<Field>` components render `novalidate` HTML with validation error slots and wire client-side submit handling: field rules are validated first, then the form either runs `onSubmit`, posts to a server action descriptor, or does a plain `fetch` to `action`. Field/server errors appear inline via each field's `[data-vsk-error]` slot.",
      },
      { kind: "h2", text: "Form component" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/SignupForm.vsk",
            code: `import { Form, Field, required, email, minLength } from '@vesk/runtime';

component SignupForm() {
  <Form action="/api/signup" method="POST">
    <Field name="name" label="Name" rules={[required('Name is required')]} />
    <Field name="email" label="Email" rules={[required(), email('Invalid email')]} />
    <Field name="password" label="Password" rules={[minLength(8, 'Min 8 chars')]} />
    <button type="submit">Sign up</button>
  </Form>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/SignupForm.vsk",
            code: `import { Form, Field, required, email, minLength } from '@vesk/runtime';

component SignupForm() {
  return (
    <Form action="/api/signup" method="POST">
      <Field name="name" label="Name" rules={[required('Name is required')]} />
      <Field name="email" label="Email" rules={[required(), email('Invalid email')]} />
      <Field name="password" label="Password" rules={[minLength(8, 'Min 8 chars')]} />
      <button type="submit">Sign up</button>
    </Form>
  );
}`,
          },
        ],
      },
      {
        kind: "table",
        head: ["Prop", "Type", "Description"],
        rows: [
          ["action", "string | Record<string, unknown>", "Submit URL, or a server action descriptor (defineAction result / ActionStub)"],
          ["method", "string", "HTTP method, defaults to 'POST'"],
          ["onSubmit", "(data: Record<string, unknown>, form: HTMLFormElement) => void | Promise<void>", "Runs with the validated data in place of any fetch"],
          ["onError", "(err: unknown) => void", "Called when the submission throws"],
          ["onSuccess", "(res: Response) => void", "Called after a successful fetch"],
          ["class / style", "string", "Forwarded to the <form> element"],
          ["children", "string | Node", "Fields and submit control"],
        ],
      },
      {
        kind: "p",
        text: "During SSR the form renders `<form action=... method=... novalidate>` with a `[data-vsk-field]` wrapper per field. On the client, submit is intercepted: field rules are validated, submitting states are announced through `vsk-loading`/`vsk-submitting` and outcomes through `vsk-success`/`vsk-error` custom events. When `onSubmit` is set it runs instead of a fetch. A plain string `action` posts `FormData` with `fetch`; an action descriptor posts JSON and maps `issues` back onto fields.",
      },
      { kind: "h2", text: "Field component" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/UsernameForm.vsk",
            code: `import { Form, Field, required, minLength, maxLength, pattern } from '@vesk/runtime';

component UsernameForm() {
  <Form action={usernameAction} method="POST">
    <Field
      name="username"
      label="Username"
      errorClass="border-red-500"
      rules={[
        required('Username is required'),
        minLength(3, 'Min 3 characters'),
        maxLength(20, 'Max 20 characters'),
        pattern(/^[a-z0-9_]+$/, 'Lowercase letters, digits and underscores only'),
      ]}
    >
      <input name="username" type="text" />
    </Field>
    <button type="submit">Save</button>
  </Form>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/UsernameForm.vsk",
            code: `import { Form, Field, required, minLength, maxLength, pattern } from '@vesk/runtime';

component UsernameForm() {
  return (
    <Form action={usernameAction} method="POST">
      <Field
        name="username"
        label="Username"
        errorClass="border-red-500"
        rules={[
          required('Username is required'),
          minLength(3, 'Min 3 characters'),
          maxLength(20, 'Max 20 characters'),
          pattern(/^[a-z0-9_]+$/, 'Lowercase letters, digits and underscores only'),
        ]}
      >
        <input name="username" type="text" />
      </Field>
      <button type="submit">Save</button>
    </Form>
  );
}`,
          },
        ],
      },
      {
        kind: "table",
        head: ["Prop", "Type", "Description"],
        rows: [
          ["name", "string", "Field key in the submitted data and issue mapping"],
          ["label", "string", "Rendered as a <label> above the field"],
          ["rules", "ValidationRule[]", "Rules validated in order; first failure wins"],
          ["errorClass", "string", "Class applied to the error slot when a message is showing"],
          ["class / style", "string", "Forwarded to the wrapping element"],
          ["children", "string | Node", "Your input element; extra attrs are forwarded to the wrapper"],
        ],
      },
      {
        kind: "p",
        text: "Each field renders a `<div data-vsk-field=\"name\">` wrapper with a `<div data-vsk-error>` slot. `errorClass` lands on the error slot whenever a message is displayed, and server-side validation errors from a re-render (e.g. a failed server action) are pre-rendered into the slot through the SSR error channel.",
      },
      { kind: "h2", text: "Validation rules" },
      {
        kind: "list",
        items: [
          "`required(msg?)` — non-null and not `''`. Default message: \"This field is required\".",
          "`email(msg?)` — empty ok, otherwise matches an email pattern. Default: \"Invalid email address\".",
          "`minLength(n, msg?)` — empty ok or length >= n. Default: \"Must be at least n characters\".",
          "`maxLength(n, msg?)` — empty ok or length <= n. Default: \"Must be at most n characters\".",
          "`pattern(re, msg?)` — empty ok or matches the RegExp. Default: \"Invalid format\".",
          "`custom(fn, msg?)` — empty ok or `fn(value)` returns true. Default: \"Invalid value\".",
        ],
      },
      {
        kind: "p",
        text: "Every rule builder returns `{ validate: (v: unknown) => boolean, message: string }` so you can assemble your own `ValidationRule`s too. Rules run in order and the first failure wins; a Field's `rules` prop and the action descriptor's per-field schema rules are combined on submit.",
      },
      { kind: "h2", text: "Server actions" },
      {
        kind: "code",
        filename: "app/actions/signup.ts",
        code: `import { defineAction, required, email, minLength } from '@vesk/runtime';

export const signup = defineAction({
  input: {
    name: required('Name required'),
    email: [required(), email()],
    password: minLength(8, 'Min 8 characters'),
  },
  async execute(input, ctx) {
    const user = await createUser(input);
    ctx.redirect('/dashboard');
    return { user };
  },
});`,
      },
      {
        kind: "p",
        text: "`defineAction(config)` returns an `ActionDefinition` `{ id, url: '/_vesk/action/<id>', input, execute }`. Inside a `.vsk` file the compiler rewrites the call to `defineAction(\"<stable-id>\", config)` so the client stub and the server registration share one id; called directly (`defineAction(id, config)`), the id falls back to a hash of the `execute` function source.",
      },
      {
        kind: "table",
        head: ["ActionContext member", "Description"],
        rows: [
          ["request", "The incoming platform `Request`"],
          ["params", "Route params as `Record<string, string>`"],
          ["url", "The request URL string"],
          ["headers()", "() => Map<string, string> of response headers"],
          ["cookies()", "() => Record<string, string> of request cookies"],
          ["locals()", "() => Record<string, unknown> per-request data"],
          ["redirect(url, status?)", "Return a redirect `Response` (default status 307)"],
        ],
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/SignupForm.vsk",
            code: `import { Form, Field, defineAction, required, email, minLength } from '@vesk/runtime';

const signup = defineAction({
  input: {
    name: required('Name required'),
    email: [required(), email('Invalid email')],
    password: minLength(8, 'Min 8 characters'),
  },
  async execute(input, ctx) {
    const user = await createUser(input);
    ctx.redirect('/dashboard');
    return { user };
  },
});

component SignupForm() {
  <Form action={signup} method="POST">
    <Field name="name" label="Name" />
    <Field name="email" label="Email" />
    <Field name="password" label="Password" />
    <button type="submit">Sign up</button>
  </Form>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/SignupForm.vsk",
            code: `import { Form, Field, defineAction, required, email, minLength } from '@vesk/runtime';

const signup = defineAction({
  input: {
    name: required('Name required'),
    email: [required(), email('Invalid email')],
    password: minLength(8, 'Min 8 characters'),
  },
  async execute(input, ctx) {
    const user = await createUser(input);
    ctx.redirect('/dashboard');
    return { user };
  },
});

component SignupForm() {
  return (
    <Form action={signup} method="POST">
      <Field name="name" label="Name" />
      <Field name="email" label="Email" />
      <Field name="password" label="Password" />
      <button type="submit">Sign up</button>
    </Form>
  );
}`,
          },
        ],
      },
      {
        kind: "p",
        text: "When `action` is an action object (`__veskAction` or a definition with `url`), the client posts `{ 'Content-Type': 'application/json' }` with the collected `FormData` as a JSON object. A response of `{ ok: false, issues: [{ field, message }] }` maps each issue onto its field's error slot (first message per field wins) and re-displays them without leaving the page; any other non-ok response throws into `onError`. A server-side validation failure also re-renders the page with issues converted through `issuesToFieldMap`. `onSubmit(data, form)` runs instead of the fetch when provided.",
      },
      { kind: "h2", text: "Manual validation" },
      {
        kind: "code",
        filename: "app/actions/signup.ts",
        code: `import { validateActionInput, issuesToFieldMap } from '@vesk/runtime';

const issues = validateActionInput(signup, inputData);
// [{ field: 'email', message: 'Invalid email address' }, ...]

const fieldErrors = issuesToFieldMap(issues);
// { email: 'Invalid email address', password: 'Min 8 characters' }`,
      },
      {
        kind: "p",
        text: "`validateActionInput(actionDef, inputData)` runs each field's schema rules and returns `ActionIssue[]` (`{ field, message }`), stopping at the first failed rule per field. `issuesToFieldMap(issues)` collapses them into a per-field map you can feed straight back into a re-render — the same map the SSR error channel uses to pre-fill field errors.",
      },
      {
        kind: "note",
        tone: "info",
        text: "Field `rules` and the action descriptor's `input` schema both apply: the descriptor schema is read from `action.input` and merged with each Field's `rules` on submit. Keep the shape in sync — fields not present in the descriptor still validate against their own `rules`.",
      },
    ],
  },
];