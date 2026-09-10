export type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export type DocPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  blocks: Block[];
};

export const docGroups = [
  "Introduction",
  "Language",
  "Compiler",
  "Runtime",
  "Native",
  "Tooling",
] as const;

import { pages as dataFetchingPages } from "./docs-data-fetching";
import { pages as middlewarePages } from "./docs-middleware";
import { pages as routingPages } from "./docs-routing";
import { pages as serverApisPages } from "./docs-server-apis";
import { pages as configPluginPages } from "./docs-config-plugin";
import { pages as apiRoutesPages } from "./docs-api-routes";
import { pages as cliPages } from "./docs-cli";
import { pages as nativePages } from "./docs-native";

const basePages: DocPage[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    description:
      "What Vesk is, what .vsk files look like, how to scaffold a project, and the commands that drive the compiler.",
    group: "Introduction",
    blocks: [
      {
        kind: "p",
        text: "Vesk is a compiler-first framework. You write one component model in .vsk files (a TypeScript superset), and the compiler emits optimized output per target: server-rendered HTML plus direct-DOM client code for the web, and Kotlin for native. There is no diffing runtime shipped to your users.",
      },
      {
        kind: "p",
        text: "The compiler process is explicit — it has no hidden evaluator. Source is preprocessed, parsed, lowered to an intermediate representation, then codegen'd to platform code.",
      },
      { kind: "h2", text: "Create a project" },
      {
        kind: "code",
        filename: "terminal",
        code: `npx create-vesk@latest my-app
cd my-app
npm install
npm run dev`,
      },
      {
        kind: "p",
        text: "create-vesk scaffolds a complete app (routes, layout, middleware, API routes, Tailwind entry). The package scripts then drive the compiler. The dev server prints its address when it starts and reports each rebuild:",
      },
      {
        kind: "code",
        filename: "terminal",
        code: `vesk dev server at http://localhost:3000 (listening on localhost)
vesk dev: rebuilt in 11ms`,
      },
      {
        kind: "note",
        tone: "info",
        text: "The dev server watches app/ and public/, recompiles affected routes on change, serves /api/* routes and middleware, and pushes HMR updates over a WebSocket.",
      },
      { kind: "h2", text: "Project layout" },
      {
        kind: "code",
        filename: "my-app/",
        code: `app/
  layout.vsk              # root layout — wraps every route via {props.children}
  page.vsk                # /
  about/page.vsk          # /about
  blog/page.vsk           # /blog
  blog/[slug]/page.vsk    # /blog/:slug
  posts/page.vsk          # data-fetching example (useFetch + tracked cell)
  statements/page.vsk     # statement-mode example
  not-found.vsk           # rendered when a route throws NotFoundError
  error.vsk               # route error boundary
  middleware.ts           # app middleware (onion model)
  api/posts/route.ts      # GET /api/posts
  api/hello/route.ts      # GET /api/hello
src/global.css            # Tailwind entrypoint
public/                   # static assets
vesk.config.ts
package.json`,
      },
      { kind: "h2", text: "CLI commands" },
      {
        kind: "table",
        head: ["Command", "What it does"],
        rows: [
          ["vesk dev [-p <port>]", "HMR dev server on app/ (default port 3000)"],
          ["vesk build [--platform <name>]", "Production build into .vesk/ (platform auto-detected, defaults to node)"],
          ["vesk start [-p <port>]", "Production server serving the .vesk/ build (default port 3000)"],
          ["vesk typecheck", "Typechecks .vsk/.ts in app/ via tsc-in-.vsk (strict by default)"],
          ["vesk seo [--strict]", "Runs the SEO audit against app/"],
          ["vesk init", "Creates src/global.css (Tailwind entrypoint) if missing"],
        ],
      },
      { kind: "h2", text: "Type safety" },
      {
        kind: "p",
        text: "Every .vsk file is a TypeScript superset: all TS constructs parse, survive codegen, and pass through vskToTsx for tsc. Types are checked on the component boundary just like exported functions, and `vesk typecheck` runs the same tsc-in-.vsk pipeline.",
      },
    ],
  },
  {
    slug: "components",
    title: "Component Declarations",
    description:
      "The component keyword, typed params, generics, async and island modifiers, and the two body modes.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "`component` is the Vesk component keyword — the unit of markup, state and effects. The compiler transforms a component body into IR and generates both server (SSR) and client (hydration) code from it.",
      },
      { kind: "h2", text: "Syntax" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Greeting.vsk",
            code: `component App {
  <div>Hello World</div>
}

component Greeting(props: { name: string }) {
  <div>Hello, {props.name}!</div>
}

export default async component Page(props: { id: string }) {
  const res = await fetch(\`/api/items/\${props.id}\`);
  const item = await res.json();
  <p>{item.title}</p>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Greeting.vsk",
            code: `component App {
  return <div>Hello World</div>;
}

component Greeting(props: { name: string }) {
  return <div>Hello, {props.name}!</div>;
}

export default async component Page(props: { id: string }) {
  const res = await fetch(\`/api/items/\${props.id}\`);
  const item = await res.json();
  return <p>{item.title}</p>;
}`,
          },
        ],
      },
      {
        kind: "list",
        items: [
          "`component` is a reserved keyword — using it as an identifier raises a compiler error.",
          "Params are optional and fully TypeScript-typed; `component Name { }` is the same as `component Name() { }`.",
          "Generic type parameters are supported: `component List<T>(props: { items: T[] }) { ... }`.",
          "`async` may appear directly before `component` or after `export`: `export default async component X() { ... }`.",
          "`client` (the island modifier) may appear after the closing paren or after `component` — both parse to the same `client: true` flag.",
        ],
      },
      { kind: "h2", text: "Body modes" },
      {
        kind: "p",
        text: "A component body is either expression mode — it ends with `return <jsx>;` — or statement mode — markup and control flow appear directly as statements (bare JSX, `if`, `for`, `switch`, `try`, guard-clause early returns). Both modes produce the same IR nodes, so every feature works in both.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Counter.vsk",
            code: `component Counter(props: { initial: number }) {
  let &[count] = track(props.initial);
  <button onClick={() => count++}>Count: {count}</button>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Counter.vsk",
            code: `component Counter(props: { initial: number }) {
  let &[count] = track(props.initial);
  return <button onClick={() => count++}>Count: {count}</button>;
}`,
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "The parser emits a `ComponentDeclaration` node with id, params, body, async, client and optional typeParameters fields — the AST shape the IR generator consumes.",
      },
    ],
  },
  {
    slug: "track-declarations",
    title: "Track Declarations",
    description:
      "The &[] sugar for creating reactive cells: auto-tracked bindings, raw-cell bindings, and how the compiler rewrites reads and writes.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "The `&[]` track-declaration syntax is Vesk's sugar for creating reactive cells — it combines cell creation with variable binding in a single statement.",
      },
      { kind: "h2", text: "Syntax" },
      {
        kind: "code",
        filename: "app/components/Counter.vsk",
        code: `let &[count] = track(0);           // count is the auto-tracked cell
const &[items] = track<string[]>([]);  // works with const too
let &[total, rawTotal] = track(0);     // rawTotal is the raw Tracked<number>`,
      },
      {
        kind: "list",
        items: [
          "The first name is the reactive value — reads inside effects or component bodies subscribe, writes schedule an update automatically.",
          "The optional second name is the raw cell object, used with `untrack()`, `peek()` or when passing the cell around.",
          "Each `&[]` creates its own cell; there is no multi-cell shorthand.",
          "`&[]` can only appear at the top level of a component body, or inside a `block()`/`effect()`/`root()` call.",
        ],
      },
      { kind: "h2", text: "How the compiler rewrites it" },
      {
        kind: "table",
        head: ["User code", "Compiled output"],
        rows: [
          ["count", "get(count)"],
          ["count = 5", "set(count, 5)"],
          ["count++", "set(count, get(count) + 1)"],
          ["count + 1", "get(count) + 1"],
        ],
      },
      {
        kind: "p",
        text: "You never call `get()` or `set()` manually when using `&[]` bindings — the compiler inserts them for you. The `&[]` binding atom is parsed with `lazy: true` and becomes a `TrackDecl` IR node.",
      },
      { kind: "h2", text: "Derived cells" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Price.vsk",
            code: `component Price(props: { qty: number, unit: number }) {
  let &[total] = derived(() => props.qty * props.unit);
  <p>Total: {total}</p>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Price.vsk",
            code: `component Price(props: { qty: number, unit: number }) {
  let &[total] = derived(() => props.qty * props.unit);
  return <p>Total: {total}</p>;
}`,
          },
        ],
      },
      {
        kind: "p",
        text: "`total` is read-only — writing to it throws. The function re-runs whenever a tracked dependency read inside it changes.",
      },
    ],
  },
  {
    slug: "reactivity",
    title: "Reactivity",
    description:
      "Tracked cells, the cell API, microtask-batched scheduling, effects, and the flushSync/tick escapes. No virtual DOM.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "Vesk reactivity is built on tracked cells created with `track()`. Reading a cell inside a component body or `effect()` subscribes; writing a cell schedules an update. There is no virtual DOM: the compiler emits per-cell DOM update code.",
      },
      { kind: "h2", text: "Cell API" },
      {
        kind: "table",
        head: ["Function", "Purpose"],
        rows: [
          ["track(initial)", "Create a reactive cell"],
          ["get(cell)", "Read a value (subscribes inside effects)"],
          ["set(cell, v)", "Write a value; Object.is-guarded, schedules subscribers"],
          ["increment(cell) / decrement(cell)", "Post-increment/decrement a numeric cell; returns the original value"],
          ["untrack(fn)", "Run fn without subscribing"],
          ["peek(cell)", "Read a cell value without subscribing"],
          ["derived(fn)", "Computed cell that re-runs fn when its dependencies change"],
          ["effect(fn)", "Run fn now and on every dependency change"],
          ["flushSync(fn)", "Run fn with the scheduler in synchronous mode"],
          ["tick()", "Resolve after the next animation frame"],
          ["on_destroy(fn)", "Register teardown cleanup for the current block/component"],
        ],
      },
      {
        kind: "p",
        text: "All of these are auto-imported from `@vesk/runtime` when used inside components — no import statement needed.",
      },
      { kind: "h2", text: "Scheduler semantics" },
      {
        kind: "list",
        items: [
          "`set()` does not update the DOM synchronously — updates are microtask-batched, and multiple writes in one turn produce one flush.",
          "`effect()` runs immediately on creation, then on dependency change.",
          "`flushSync(fn)` flushes pending updates, runs fn with immediate DOM writes, and restores the async mode afterwards.",
          "`await tick()` resolves after the frame the flush has painted.",
          "The scheduler guards against effect loops — after 1001 flush rounds it throws: \"Maximum update depth exceeded. This typically indicates that an effect reads and writes the same piece of state.\"",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "`batch` does not exist in the runtime. For synchronous multi-write flushes use `flushSync(fn)` — importing `batch` from `@vesk/runtime` does not resolve.",
      },
      { kind: "h2", text: "Example" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Counter.vsk",
            code: `component Counter {
  let &[count] = track(0);

  effect(() => {
    console.log("count is", count);
  });

  <button onClick={() => count++}>
    Count: {count}
  </button>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Counter.vsk",
            code: `component Counter {
  let &[count] = track(0);

  effect(() => {
    console.log("count is", count);
  });

  return (
    <button onClick={() => count++}>
      Count: {count}
    </button>
  );
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "expression-mode",
    title: "Expression Mode",
    description:
      "The classic component body style: a single return <jsx> at the end, with guard clauses, .map() lists and ternaries before it.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "Expression mode is the classic component body style: the body computes a single `return <jsx>;` expression. It is the simplest way to write a component and the default for one-liners.",
      },
      { kind: "h2", text: "Rules" },
      {
        kind: "list",
        items: [
          "The body must end with `return <jsx>;`.",
          "Guard-clause early returns are allowed before the final return.",
          "`.map()` callbacks render collections; a `key` prop is recommended for reconciliation — the compiler extracts the key expression from the JSX child.",
          "Ternary and `&&` expressions work inside `{}`.",
          "Fragments are supported; adjacent top-level JSX is not.",
        ],
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/TodoList.vsk",
            code: `component TodoList(props: { todos: Todo[] }) {
  if (props.todos.length === 0) return <EmptyState />;
  <div class="todo-list">
    {props.todos.map((todo) => (
      <TodoItem key={todo.id} todo={todo} />
    ))}
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/TodoList.vsk",
            code: `component TodoList(props: { todos: Todo[] }) {
  if (props.todos.length === 0) return <EmptyState />;

  return (
    <div class="todo-list">
      {props.todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </div>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "Relationship to statement mode" },
      {
        kind: "p",
        text: "Statement mode is the statement-level equivalent — bare JSX, `if`, `for`, `switch`, `try`, and guard clauses without a wrapper return. Every body feature available in expression mode is available in statement mode and vice versa.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/TodoList.vsk",
            code: `component TodoList(props: { todos: Todo[] }) {
  if (props.todos.length === 0) return <EmptyState />;
  for (const todo of props.todos; key todo.id) {
    <TodoItem todo={todo} />
  }
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/TodoList.vsk",
            code: `component TodoList(props: { todos: Todo[] }) {
  if (props.todos.length === 0) return <EmptyState />;

  return (
    <div class="todo-list">
      {props.todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </div>
  );
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "statement-mode",
    title: "Statement Mode",
    description:
      "Markup and control flow directly as statements: bare JSX, if/for/while/switch/try, guard-clause returns, and for-key/index clauses.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "Statement mode is a first-class component body style: markup and control flow appear directly as statements, no `return` wrapper required. Every feature that works in expression mode also works in statement mode, and vice versa.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/List.vsk",
            code: `component List(props: { items: string[] }) {
  let &[filter] = track("");

  if (filter !== "") {
    <p>Filtered by: {filter}</p>
  }

  for (const item of props.items; key item) {
    <div>{item}</div>
  } empty {
    <p>No items.</p>
  }
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/List.vsk",
            code: `component List(props: { items: string[] }) {
  let &[filter] = track("");

  return (
    <>
      {filter !== "" && <p>Filtered by: {filter}</p>}
      {props.items.length === 0 ? (
        <p>No items.</p>
      ) : (
        props.items.map((item) => <div>{item}</div>)
      )}
    </>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "Statements the compiler understands" },
      {
        kind: "table",
        head: ["Statement", "IR handling"],
        rows: [
          ["Bare JSX element / fragment", "rendered, tracked"],
          ["{expr} expression container", "rendered; .map() calls become a MapRegion"],
          ["if / else", "conditional region"],
          ["for...of, for...in, classic for", "loop region"],
          ["while / do...while", "loop region"],
          ["switch", "switch region"],
          ["try / catch", "try region (fallback content on error)"],
          ["return <jsx>", "guard-clause early return — renders and stops"],
          ["{#server} / {#client} blocks", "client-boundary regions"],
          ["let &[x] = track(0)", "TrackDecl"],
          ["Anything else", "preserved verbatim as a runtime statement"],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "`class Foo {}` inside a component body raises a compiler error — components are markup/state units, not class containers.",
      },
      { kind: "h2", text: "for key / index clauses" },
      {
        kind: "code",
        filename: "app/components/Table.vsk",
        code: `component Table(props: { rows: Row[] }) {
  for (const row of props.rows; key row.id; index i) {
    <Row data={row} index={i} />
  } empty {
    <p>No rows.</p>
  }
}`,
      },
      {
        kind: "list",
        items: [
          "`; key <expr>` sets the reconciliation key expression.",
          "`; index <ident>` binds the loop index to an identifier.",
          "Clauses are optional and combinable; only for...of/for...in headers may carry them (classic `for` keeps its normal semicolons).",
          "The compiler blanks the clause text before parsing and recovers it from annotations, preserving source offsets.",
        ],
      },
      { kind: "h2", text: "Guard-clause early returns" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Page.vsk",
            code: `component Page(props: { user: User | null }) {
  if (!props.user) return <Login />;
  <h1>Welcome, {props.user.name}</h1>;
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Page.vsk",
            code: `component Page(props: { user: User | null }) {
  if (!props.user) return <Login />;
  return <h1>Welcome, {props.user.name}</h1>;
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "client-boundary",
    title: "Client Boundary & Islands",
    description:
      "Server-first rendering, the client island modifier, {#client}/{#server} blocks, and which blocks a component kind may use.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "Vesk is server-first by default: components render to HTML on the server, and interactivity is attached on the client through hydration. The `client` keyword and `{#client}`/`{#server}` blocks define that boundary explicitly.",
      },
      { kind: "h2", text: "Islands: the client keyword" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Clock.vsk",
            code: `component Clock() client {
  let &[now] = track(new Date());
  effect(() => { /* interval etc. */ });
  <time>{now.toLocaleTimeString()}</time>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Clock.vsk",
            code: `component Clock() client {
  let &[now] = track(new Date());
  effect(() => { /* interval etc. */ });
  return <time>{now.toLocaleTimeString()}</time>;
}`,
          },
        ],
      },
      {
        kind: "list",
        items: [
          "Marking a component `client` makes it an island: it renders on both server and client.",
          "The modifier goes after the params (`component X() client`) or directly after `component`.",
          "`client` composes with `export` and `async`: `export component X() client`.",
          "Event-handler attributes (`on*`) are excluded from the SSR HTML entirely — the server carries the markup, the client bundle attaches behavior.",
        ],
      },
      { kind: "h2", text: "{#client} / {#server} blocks" },
      {
        kind: "table",
        head: ["Component kind", "{#server}", "{#client}"],
        rows: [
          ["Server component (default)", "allowed", "error (clientBlockInServer)"],
          ["client island", "error (serverBlockInClient)", "allowed"],
        ],
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Robots.vsk",
            code: `component Robots() {
  {#server}
    <meta name="robots" content="noindex" />
  {/server}

  <p>Always rendered.</p>
}

component ClientOnly() client {
  {#client}
    <p>This markup only hydrates on the client.</p>
  {/client}

  <p>Also always rendered.</p>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Robots.vsk",
            code: `component Robots() {
  {#server}
    <meta name="robots" content="noindex" />
  {/server}

  return <p>Always rendered.</p>;
}

component ClientOnly() client {
  {#client}
    <p>This markup only hydrates on the client.</p>
  {/client}

  return <p>Also always rendered.</p>;
}`,
          },
        ],
      },
      {
        kind: "p",
        text: "`{#server}` blocks render in SSR and are stripped from the client bundle; `{#client}` blocks are stripped from SSR and render on the client. The `#server { ... }` / `#client { ... }` prefix forms parse to the identical VeskBlock node, and blocks nest and accept full statement-mode bodies.",
      },
      { kind: "h2", text: "What ships to the client" },
      {
        kind: "p",
        text: "A module produces a client bundle when any component is a `client` island or has a non-static body. A module where every component is fully static and non-client compiles to an empty client bundle.",
      },
    ],
  },
  {
    slug: "styles",
    title: "Styles",
    description:
      "Component-scoped CSS via a <style> element in the body, how it is extracted, and how it is emitted on server and client.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "Components carry their own CSS in a `<style>` element. The compiler extracts the element from the body and hoists it to component level.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Card.vsk",
            code: `component Card(props: { title: string }) {
  <div class="card">
    <h2>{props.title}</h2>
  </div>

  <style>
    .card { border: 1px solid #ccc; padding: 8px; }
    .card h2 { margin: 0; }
  </style>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Card.vsk",
            code: `component Card(props: { title: string }) {
  return (
    <>
      <div class="card">
        <h2>{props.title}</h2>
      </div>

      <style>
        .card { border: 1px solid #ccc; padding: 8px; }
        .card h2 { margin: 0; }
      </style>
    </>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "How it is compiled" },
      {
        kind: "list",
        items: [
          "The IR generator removes `<style>` nodes from the render body and stores their text as the component's style property (extractStyle).",
          "Server output emits a literal `<style>...</style>` block with the raw CSS.",
          "Client output creates a `<style>` element keyed by the component identifier and appends it to document.head.",
          "An unclosed `<style>` is a parse error: \"Unclosed `<style>` element: missing `</style>`\".",
        ],
      },
    ],
  },
  {
    slug: "markdown",
    title: "Markdown",
    description:
      "The built-in <Md> component and renderMarkdown(): tokenizer-based, with highlighting, GFM, streaming, and configurable HTML policies.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "Vesk includes a built-in `<Md>` component and `renderMarkdown()` function for rendering Markdown. The implementation is tokenizer-based (no regex) and supports syntax highlighting, GFM, and configurable HTML policies.",
      },
      {
        kind: "code",
        filename: "app/components/Docs.vsk",
        code: `<Md content="# Hello\\n\\nThis is **bold**." />`,
      },
      { kind: "h2", text: "Content types" },
      {
        kind: "table",
        head: ["Type", "Behavior"],
        rows: [
          ["string", "Literal markdown, rendered synchronously"],
          ["Tracked<string>", "Reactive — re-renders when the cell changes"],
          ["Resource<string> / useFetch.stream", "Streaming — progressively renders chunks"],
          ["\"/path/to/*.md\"", "Runtime-loaded from the public/ directory"],
        ],
      },
      { kind: "h2", text: "Props and options" },
      {
        kind: "table",
        head: ["Option", "Description"],
        rows: [
          ["css", "Built-in styles: true / false / custom CSS string"],
          ["lineNumbers / copy / highlight", "Code-block presentation (line numbers, copy button, highlighted lines)"],
          ["hardBreaks", "Treat newlines as <br>"],
          ["html", "'escape' (default) | 'allow' | 'allowlist' — inline HTML policy"],
          ["renderMarkdown(content, opts)", "Imperative render: chrome, ids, autolink, allowTags"],
          ["configureMd({ ... })", "Global defaults, e.g. { html: 'allowlist', allowTags: ['br', 'strong'] }"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "`<Md>` content is polymorphic: a string renders synchronously, a Tracked<string> re-renders when the cell changes, a Resource/useFetch.stream progressively renders chunks, and a \"/path/to/*.md\" string loads from public/ at runtime.",
      },
    ],
  },
  {
    slug: "not-in-the-grammar",
    title: "Not in the Grammar",
    description:
      "Explicit non-features. Vesk is a TypeScript superset — everything listed here is intentionally absent today, and the absence is a contract.",
    group: "Language",
    blocks: [
      {
        kind: "p",
        text: "Explicit non-features. Vesk is a TypeScript superset — everything listed here is intentionally absent today, and the absence is a contract: code relying on any of these will not compile.",
      },
      { kind: "h2", text: "Language" },
      {
        kind: "list",
        items: [
          "No `defer` / streaming boundaries — SSR output is a static template per component.",
          "No `class` declarations in component bodies — raises a compiler error.",
          "No adjacent top-level JSX — siblings must be wrapped in `<>...</>` or a parent element.",
          "`component` is reserved and cannot be used as an identifier.",
          "No `suspense` implementation — use the `if (loading)` + `createResource` pattern instead.",
        ],
      },
      { kind: "h2", text: "Reactivity" },
      {
        kind: "list",
        items: [
          "No `batch`. Synchronous multi-write flushes use `flushSync(fn)`; the default scheduler is microtask-batched.",
          "No React hooks. The equivalents are `track()`, `effect()`, `derived()`.",
          "No virtual DOM — updates compile to per-cell DOM mutations; there is no reconciliation tree at runtime.",
        ],
      },
      { kind: "h2", text: "Tooling" },
      {
        kind: "list",
        items: [
          "No `vite-plugin-vesk` — `vesk dev` / `vesk build` are the build entry points; Tailwind ships as `@vesk/plugin-tailwind`.",
          "The deprecated `packages/runtime/src/track.ts` module is dead code — never import it; the active API lives in ripple-runtime.ts.",
          "Server vs client exports are split: server-only APIs (cookies, headers, isr) are not in the client bundle; client-only APIs (hydrate, bindings, reconcile) are not in the server bundle.",
        ],
      },
    ],
  },
  {
    slug: "pipeline",
    title: "Compiler Pipeline",
    description:
      "Four stages, no hidden runtime: preprocess, parse, IR generation, and codegen to server and client JavaScript (or Kotlin).",
    group: "Compiler",
    blocks: [
      {
        kind: "p",
        text: "The compiler turns `.vsk` source into JavaScript targets from one intermediate representation: server codegen (SSR HTML) and client codegen (real DOM construction + hydration wiring). A native Kotlin path walks the same IR.",
      },
      { kind: "h2", text: "Pipeline stages" },
      {
        kind: "table",
        head: ["Stage", "Module", "What happens"],
        rows: [
          ["[1] Preprocess", "parser.ts", "preprocessForClauses() blanks `; key <expr>` / `; index <ident>` clauses in for-of headers, preserving source offsets with VeskAnnotations"],
          ["[2] Parse", "acorn + acorn-ts-plugin + VeskPlugin", "ESTree-compatible AST with ComponentDeclaration, &[...] track atoms, statement-position JSX, VeskBlock islands, raw <style>"],
          ["[3] IR generation", "ir-generator.ts", "AST → typed IR node tree; statement-mode dispatch; validateBlocks; extractStyle"],
          ["[4] Codegen", "server-jsgen.ts / client-codegen.ts", "server emits HTML string chunks (event attrs stripped); client emits real DOM construction + tracked bindings + hydration wiring"],
        ],
      },
      { kind: "h2", text: "Notes" },
      {
        kind: "list",
        items: [
          "Statement mode and expression mode produce the same IR node types — `props.items.map(...)` and `for (...; key ...)` both become a MapRegion.",
          "`isStaticIR(body)` decides whether a subtree is fully static; static components skip runtime effect wiring entirely.",
          "User code in statement-mode bodies stays raw — unrecognized statements are preserved as RuntimeStatement and re-emitted verbatim.",
          "There is no regex anywhere in parsing or codegen — tokenizer/character scans only.",
        ],
      },
    ],
  },
  {
    slug: "ir-format",
    title: "IR Format",
    description:
      "The ephemeral typed IR: a class hierarchy in ir.ts, consumed by the server and client codegen visitors and by vesk-native-compiler.",
    group: "Compiler",
    blocks: [
      {
        kind: "p",
        text: "The compiler IR is a typed class hierarchy in `packages/compiler/src/ir.ts`. It is ephemeral: created per compilation by ir-generator.ts, consumed immediately by the server and client codegen visitors. Nodes dispatch via `instanceof`.",
      },
      { kind: "h2", text: "Root nodes" },
      {
        kind: "list",
        items: [
          "IRRoot — components, imports, staticProps (hoisted `export const props = {...}`), loadFn, topLevelCode.",
          "ComponentIR — name, paramNames, propsType, isClient, isAsync, ssrAwait, mode ('expression' | 'statement'), body, style, exported flags.",
        ],
      },
      { kind: "h2", text: "Node types" },
      {
        kind: "table",
        head: ["Class", "Meaning"],
        rows: [
          ["Expression", "A source-text expression (raw, deps, ast)"],
          ["StaticNode", "HTML element with static attrs"],
          ["TextNode", "Literal text"],
          ["DynamicBinding", "Interpolated expression (text or attribute)"],
          ["OpaqueDynamicRegion", "Conditional region"],
          ["MapRegion", "List rendering (for...of or .map())"],
          ["ForLoop / WhileLoop", "Classic for, for...in, while, do...while"],
          ["SwitchBlock / TryCatch", "switch and try/catch fallback"],
          ["TrackDecl", "Tracked declaration (&[])"],
          ["ComponentRef / ComponentCall", "Child component reference or invocation"],
          ["SlotNode", "props.children rendering"],
          ["ServerBlock / ClientBlock", "{#server} / {#client} blocks"],
          ["HeadBlock / RuntimeStatement", "Head content / verbatim preserved statement"],
        ],
      },
      { kind: "h2", text: "Codegen contract" },
      {
        kind: "list",
        items: [
          "Server walks nodes pushing HTML string chunks to an `__out` array; ServerBlock renders, ClientBlock returns ''.",
          "Client walks nodes creating real DOM; ServerBlock returns null, ClientBlock renders.",
          "In hydrate mode, `<!--vsk-->` claim markers precede subtrees that need client JS.",
        ],
      },
    ],
  },
  {
    slug: "static-codegen",
    title: "Static Code Generation",
    description:
      "How the client codegen distinguishes fully-static subtrees from reactive ones, and how hydrate-mode markers work.",
    group: "Compiler",
    blocks: [
      {
        kind: "p",
        text: "The client codegen distinguishes fully-static subtrees from reactive ones at compile time. Static subtrees are constructed once and never touched by effects; reactive subtrees get per-cell DOM update wiring.",
      },
      { kind: "h2", text: "isStaticIR" },
      {
        kind: "list",
        items: [
          "`isStaticIR(body)` returns true only when every node is a StaticNode or TextNode and no attribute binding (including on* handlers) is dynamic.",
          "A component whose whole body is static gets no effect wiring — its DOM is built once, synchronously.",
          "A component with a `<style>` block is never static.",
          "A MapRegion counts as static only when both its template and alternate are static.",
        ],
      },
      { kind: "h2", text: "Hydrate-mode markers" },
      {
        kind: "code",
        filename: "subtreeNeedsJS",
        code: `subtreeNeedsJS = __vskHydrate && (forceClaim || !isStaticIR(node.children))`,
      },
      {
        kind: "list",
        items: [
          "Static subtrees: no marker, no client-side reconstruction — the server HTML is claimed as-is.",
          "Reactive subtrees: a `<!--vsk-->` marker tells the client hydrator where to attach effects and per-cell update code.",
          "forceClaim forces a claim marker even for a static-looking subtree (e.g. event delegation).",
        ],
      },
      { kind: "h2", text: "Static props" },
      {
        kind: "p",
        text: "Module-level `export const props = { ... }` static data is hoisted into IRRoot.staticProps and re-emitted once, shared by server and client outputs instead of being re-evaluated per component.",
      },
    ],
  },
  {
    slug: "client-reachability",
    title: "Client Reachability",
    description:
      "The compiler's answer to the client/server boundary: the needsClient check, per-block validation, and per-target stripping.",
    group: "Compiler",
    blocks: [
      {
        kind: "p",
        text: "\"Client reachability\" is the compiler's answer to: does this component need to exist on the client at all, and which parts of its body belong to which side? It is decided at compile time by three mechanisms.",
      },
      { kind: "h2", text: "Per-component island flag" },
      {
        kind: "code",
        filename: "client-codegen.ts",
        code: `const needsClient = ir.components.some((c) => c.isClient || !isStaticComponent(c));`,
      },
      {
        kind: "list",
        items: [
          "A `client` island always needs client code — it renders on both server and client.",
          "A non-client component needs client code only when its body is not fully static (reactive content, on* handlers, effects, bindings).",
          "A module where every component is static and non-client compiles to an empty client bundle (compileClient returns '' unless forceClient: true).",
        ],
      },
      { kind: "h2", text: "Per-block validation" },
      {
        kind: "p",
        text: "`validateBlocks(compName, isClient, body)` enforces the boundary statically per component kind: a `client` component containing `{#server}` raises serverBlockInClient; a server component containing `{#client}` raises clientBlockInServer. The check recurses through StaticNode, ServerBlock and ClientBlock children, so the rules apply at any nesting depth.",
      },
      { kind: "h2", text: "Per-target stripping" },
      {
        kind: "table",
        head: ["Node", "Server codegen", "Client codegen"],
        rows: [
          ["ServerBlock ({#server})", "rendered", "dropped"],
          ["ClientBlock ({#client})", "dropped", "rendered"],
        ],
      },
      { kind: "h2", text: "Client bundle" },
      {
        kind: "p",
        text: "The browser bundle is built from the runtime's index-client barrel (tree-shaken to the names actually used) plus hydration entry points: hydrate, hydrateViewport, hydrateIdle, hydrateOnInteraction, needsHydration, createHydrateWalker, collectVskMarkers, reactiveProps. In code-split mode it is split into per-route `page-<name>.js` chunks.",
      },
    ],
  },
  {
    slug: "errors",
    title: "Errors & Diagnostics",
    description:
      "VeskError, HttpError, TimeoutError and NotFoundError, plus error handling in components and server code.",
    group: "Compiler",
    blocks: [
      {
        kind: "p",
        text: "Vesk provides structured error types for common failure scenarios.",
      },
      { kind: "h2", text: "VeskError" },
      {
        kind: "code",
        filename: "compiler",
        code: `import { VeskError } from '@vesk/compiler';

throw new VeskError({
  code: 'V0412',
  message: 'Reactive read outside a tracked scope',
  file: 'app/page.vsk',
  line: 15,
  column: 3,
  help: 'Move the reactive read inside an effect() or component body.',
});`,
      },
      {
        kind: "list",
        items: [
          "Every VeskError carries a stable V-code, message, file, line, column and a suggested help line.",
          "`codeFrame()` returns a formatted code frame with the caret pointing at the problem.",
        ],
      },
      { kind: "h2", text: "Runtime error types" },
      {
        kind: "table",
        head: ["Type", "Properties", "When thrown"],
        rows: [
          ["HttpError", "status, statusText", "Non-2xx HTTP response"],
          ["TimeoutError", "timeout (ms)", "Request exceeded its timeout"],
          ["NotFoundError", "—", "notFound(); renders not-found.vsk"],
        ],
      },
      { kind: "h2", text: "In components" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/SafePage.vsk",
            code: `component SafePage() {
  try {
    <RiskyComponent />
  } catch (err) {
    <p>Error: {err.message}</p>
  }
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/SafePage.vsk",
            code: `component SafePage() {
  try {
    return <RiskyComponent />;
  } catch (err) {
    return <p>Error: {err.message}</p>;
  }
}`,
          },
        ],
      },
      { kind: "h2", text: "In server code" },
      {
        kind: "code",
        filename: "app/api/items/route.ts",
        code: `export async function GET(request: Request) {
  try {
    const data = await fetchExternalData();
    return Response.json(data);
  } catch (err) {
    if (err instanceof TimeoutError) {
      return Response.json(
        { error: \`Request timed out after \${err.timeout}ms\` },
        { status: 504 }
      );
    }
    throw err;
  }
}`,
      },
    ],
  },
  {
    slug: "hydration",
    title: "Hydration",
    description:
      "How Vesk attaches client behavior to server-rendered HTML: vsk markers, claim walkers, and the hydration entry points.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "Hydration attaches client behavior (event handlers, effects, tracked bindings) to server-rendered HTML. The server marks the parts of the DOM that need client JS; the client hydrator walks those markers and claims the existing DOM instead of rebuilding it.",
      },
      { kind: "h2", text: "Server side" },
      {
        kind: "code",
        filename: "server-jsgen.ts",
        code: `subtreeNeedsJS = __vskHydrate && (forceClaim || !isStaticIR(node.children))`,
      },
      {
        kind: "list",
        items: [
          "Fully static subtrees get no marker and no client-side reconstruction.",
          "Reactive subtrees get a `<!--vsk-->` marker; the hydrator claims them in place.",
          "Event-handler attributes are excluded from the SSR HTML entirely — the client bundle attaches them.",
        ],
      },
      { kind: "h2", text: "Client entry points" },
      {
        kind: "table",
        head: ["Entry", "Behavior"],
        rows: [
          ["hydrate(container, fn, props)", "Hydrate everything immediately"],
          ["hydrateViewport(container, fn, props, rootMargin)", "Hydrate visible markers now; hydrate the rest via IntersectionObserver"],
          ["hydrateIdle(container, fn, props, {chunkSize, timeout})", "Hydrate in chunks via requestIdleCallback; returns { cancel() }"],
          ["hydrateOnInteraction(container, fn, props, {events})", "Hydrate on the first click/touchstart/focus/mouseenter"],
          ["hydrateInitial(container, fn, props)", "Hydrate with a fresh walker (no marker list)"],
          ["needsHydration / hydrationCount(container)", "Whether the container still contains unhydrated vsk markers"],
        ],
      },
      {
        kind: "p",
        text: "Automated hydration uses `hydrateViewport` by default; `createHydrateWalker(container, markerList?)` walks from markers or from the container, and `reactiveProps(props)` makes server-rendered prop values reactive on the client.",
      },
    ],
  },
  {
    slug: "seo",
    title: "SEO",
    description:
      "Structured data via the JsonLd component and schema generator functions, plus vesk seo to audit your app.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "Vesk provides structured data (JSON-LD) components for search engine optimization. All auto-imported from `@vesk/runtime`.",
      },
      { kind: "h2", text: "JsonLd component" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/BlogPost.vsk",
            code: `component BlogPost(props: { title: string, date: string, author: string }) {
  <div>
    <h1>{props.title}</h1>
    <JsonLd schema={ArticleSchema({
      headline: props.title,
      datePublished: props.date,
      author: { name: props.author },
    })} />
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/BlogPost.vsk",
            code: `component BlogPost(props: { title: string, date: string, author: string }) {
  return (
    <div>
      <h1>{props.title}</h1>
      <JsonLd schema={ArticleSchema({
        headline: props.title,
        datePublished: props.date,
        author: { name: props.author },
      })} />
    </div>
  );
}`,
          },
        ],
      },
      {
        kind: "list",
        items: [
          "Renders a `<script type=\"application/ld+json\">` tag with the structured data.",
          "Schema generators return Record<string, unknown> objects with @type set: ArticleSchema, ProductSchema, FAQPageSchema, BreadcrumbListSchema, OrganizationSchema, LocalBusinessSchema, VideoSchema.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "`vesk seo` runs the SEO audit against app/ (RouteOutput checks); pass `--strict` to make audit errors fail the build or exit non-zero.",
      },
    ],
  },
  {
    slug: "bindings",
    title: "Two-Way Bindings",
    description:
      "bindValue, bindChecked and bindGroup for wiring tracked cells to DOM form elements.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "Vesk provides utilities for two-way data binding between reactive cells and DOM form elements. All auto-imported from `@vesk/runtime`.",
      },
      { kind: "h2", text: "bindValue" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/NameInput.vsk",
            code: `component NameInput() {
  let &[name] = track('');
  <input value={name} ref={bindValue(name)} />
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/NameInput.vsk",
            code: `component NameInput() {
  let &[name] = track('');
  return <input value={name} ref={bindValue(name)} />;
}`,
          },
        ],
      },
      {
        kind: "list",
        items: [
          "Reads the cell and sets the element's value; on input/change writes back.",
          "Handles `<input>` and `<select>` (including multiple); type=\"number\" and type=\"range\" coerce to numbers.",
          "Accepts a custom setter: `bindValue(count, (val) => Math.max(0, Number(val)))`.",
          "Returns a cleanup function, run when the element unmounts.",
        ],
      },
      { kind: "h2", text: "bindChecked / bindGroup" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/ColorPicker.vsk",
            code: `component ColorPicker() {
  let &[color] = track('blue');

  <div>
    <label><input type="radio" value="red" ref={bindGroup(color)} /> Red</label>
    <label><input type="radio" value="blue" ref={bindGroup(color)} /> Blue</label>
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/ColorPicker.vsk",
            code: `component ColorPicker() {
  let &[color] = track('blue');

  return (
    <div>
      <label><input type="radio" value="red" ref={bindGroup(color)} /> Red</label>
      <label><input type="radio" value="blue" ref={bindGroup(color)} /> Blue</label>
    </div>
  );
}`,
          },
        ],
      },
      {
        kind: "table",
        head: ["Function", "Target elements", "Binds"],
        rows: [
          ["bindValue(cell, setFn?)", "<input>, <select>", "value property"],
          ["bindChecked(cell, setFn?)", "<input type=\"checkbox\">", "checked property"],
          ["bindGroup(cell, setFn?)", "<input type=\"radio\">, checkbox", "group value"],
        ],
      },
    ],
  },
  {
    slug: "built-in-components",
    title: "Built-in Components",
    description:
      "Image, Portal, Experiment and LoadingIndicator — all auto-imported from @vesk/runtime.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "Vesk ships several built-in components, all auto-imported from `@vesk/runtime`.",
      },
      { kind: "h2", text: "Image" },
      {
        kind: "code",
        filename: "app/components/Hero.vsk",
        code: `<Image src="/hero.jpg" alt="Hero image" width={1200} height={600} priority />`,
      },
      {
        kind: "list",
        items: [
          "Responsive with automatic srcset generation and lazy loading by default.",
          "Props: src, alt, width, height, priority (preload + no lazy), loading ('lazy'|'eager'), sizes, widths, placeholder.",
          "SSR renders a `<span>` wrapper with `<img>`; priority images get `<link rel=\"preload\">` in `<head>`.",
        ],
      },
      { kind: "h2", text: "Portal" },
      {
        kind: "code",
        filename: "app/components/Modal.vsk",
        code: `<Portal target="#modal-root">
  <div class="modal">Hello from portal</div>
</Portal>`,
      },
      {
        kind: "list",
        items: [
          "Teleports children to another DOM node by CSS selector or element.",
          "SSR returns an empty string — client-only.",
        ],
      },
      { kind: "h2", text: "Experiment" },
      {
        kind: "code",
        filename: "app/components/Hero.vsk",
        code: `<Experiment name="hero-variant" variants={[
  { name: 'control', weight: 50, content: <OriginalHero /> },
  { name: 'challenger', weight: 50, content: <NewHero /> },
]} />`,
      },
      {
        kind: "list",
        items: [
          "A/B/n testing with sticky (cookie-based) assignment, default true.",
          "`track: true` records assignments to window.__vsk_experiments.",
        ],
      },
      { kind: "h2", text: "LoadingIndicator" },
      {
        kind: "list",
        items: [
          "Nuxt-style page-navigation progress bar: `<LoadingIndicator color=\"#ff6600\" height={3} />`.",
          "Programmatic control via `useLoadingIndicator()` (start/finish); global defaults via `configureLoadingIndicator({ duration, throttle, hideDelay })`.",
        ],
      },
    ],
  },
  {
    slug: "headless",
    title: "Headless Components",
    description:
      "Show, For, Switch and Match — composable render helpers with no markup and no styling.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Vesk provides headless render helpers for conditional rendering, list rendering, and pattern matching. These are composable building blocks — no markup, no styling.",
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Unlike `effect`, `derived`, `track` and the rest of the runtime surface, `Show`, `For`, `Switch` and `Match` are **not** auto-imported. Import them explicitly: `import { Show, For, Switch, Match } from '@vesk/runtime';`.",
      },
      { kind: "h2", text: "Show" },
      {
        kind: "p",
        text:
          "`Show` renders its children when `when` is truthy, otherwise its `fallback`. It is the composable, expression-position answer to `if` — useful inside a `return (...)`, inside `{...}` interpolation, or wherever you need a conditional that is itself just a value. The `fallback` is a string, an element, or omitted (`null`).",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Greeting.vsk",
            code: `import { Show } from '@vesk/runtime';

component Greeting(props: { name?: string }) {
  <Show when={props.name} fallback="Hello, stranger">
    <p>Hello, {props.name}</p>
  </Show>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Greeting.vsk",
            code: `import { Show } from '@vesk/runtime';

component Greeting(props: { name?: string }) {
  return (
    <Show when={props.name} fallback="Hello, stranger">
      <p>Hello, {props.name}</p>
    </Show>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "When to use Show vs. a plain if" },
      {
        kind: "p",
        text:
          "In statement position the headless helpers and the native control flow often achieve the same result, and you should pick whichever reads more naturally. The compiler lowers statement-mode `if`, `switch`, `for` and `while` directly to reactive IR, so they are always available — no import required.",
      },
      {
        kind: "list",
        items: [
          "`if (cond) return <p>Loading</p>` — guard-clause early return at the top of a body. This is idiomatic for `useFetch` loading/error guards and needs no helper.",
          "`{show ? <A/> : <B/>}` — a plain ternary in interpolation when both branches are simple.",
          "`<Show when={cond}>...</Show>` — prefer when the branch content is large, when you want a rich name (e.g. `<Show when={auth.user}>`), or when you are working in a purely expression-position context like a `map` callback.",
          "`<Switch><Match when=.../>...</Switch>` — prefer when there are three or more mutually exclusive branches; it stays flat where a nested ternary would indent.",
        ],
      },
      {
        kind: "p",
        text:
          "A one-to-one `Show`/`Switch` map is cheat-sheeted below. Both forms compile to the same rendering; choose the reading that matches the surrounding code.",
      },
      {
        kind: "table",
        head: ["Goal", "Statement-mode (native)", "Expression-mode helper"],
        rows: [
          ["conditional", "`if (cond) return <A/>;` or `if (cond) { <A/> }`", "`<Show when={cond}><A/></Show>`"],
          ["multi-way", "`switch (x) { case 'a': return <A/>; default: return <B/>; }`", "`<Switch><Match when={x==='a'}><A/></Match>...`"],
        ],
      },
      { kind: "h2", text: "For" },
      {
        kind: "p",
        text:
          "`For` takes an `each` list and a `children` render function `(item, index) => vnode`. In Vesk you should use the native `for...of` loop with a `; key` clause instead: it compiles to keyed reconciliation with far less ceremony and reads like plain JavaScript.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/TodoList.vsk",
            code: `import { For } from '@vesk/runtime';

interface Todo { id: number; text: string }

component TodoList(props: { items: Todo[] }) {
  if (props.items.length === 0) return <p>No items</p>;
  <ul>
    for (const todo of props.items; key todo.id) {
      <li>{todo.text}</li>
    }
  </ul>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/TodoList.vsk",
            code: `import { For } from '@vesk/runtime';

interface Todo { id: number; text: string }

component TodoList(props: { items: Todo[] }) {
  return (
    <ul>
      {props.items.map((todo) => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  );
}`,
          },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "`<For>` uses `props.children` as a render function, but JSX render-function children (a `{(item, index) => ...}` arrow directly inside the tag) do **not** compile in `.vsk`. Prefer the statement-mode `for...of ; key` loop, or `.map` with a `key` prop in expression mode. The `; key` clause you see in the statement-mode example is a Vesk extension and is covered on the List Rendering page.",
      },
      { kind: "h2", text: "Switch / Match" },
      {
        kind: "p",
        text:
          "`<Switch>` returns the first child that renders non-empty; `<Match when=...>` renders its children only when `when` is truthy, and a `<Match fallback>` matches the default arm. This is the expression-position analogue of a `switch` with `default`, useful when a ternary would nest.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/StatusBadge.vsk",
            code: `import { Switch, Match } from '@vesk/runtime';

component StatusBadge(props: { status: string }) {
  <Switch>
    <Match when={props.status === 'active'}>
      <span class="bg-green-100 text-green-800">Active</span>
    </Match>
    <Match when={props.status === 'off'}>
      <span class="bg-gray-100 text-gray-800">Off</span>
    </Match>
    <Match fallback>
      <span class="bg-gray-100 text-gray-800">Unknown</span>
    </Match>
  </Switch>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/StatusBadge.vsk",
            code: `import { Switch, Match } from '@vesk/runtime';

component StatusBadge(props: { status: string }) {
  return (
    <Switch>
      <Match when={props.status === 'active'}>
        <span class="bg-green-100 text-green-800">Active</span>
      </Match>
      <Match when={props.status === 'off'}>
        <span class="bg-gray-100 text-gray-800">Off</span>
      </Match>
      <Match fallback>
        <span class="bg-gray-100 text-gray-800">Unknown</span>
      </Match>
    </Switch>
  );
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "reactive-core",
    title: "Reactive Core",
    description:
      "The runtime reactivity engine: cells, the microtask scheduler, block trees, scoped flushing, and the flushSync/tick escapes.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "The runtime reactivity engine implements tracked cells, derived values, effects, and a block-tree scheduler. (The legacy `track.ts` module is dead code and must not be imported.)",
      },
      { kind: "h2", text: "Cells" },
      {
        kind: "list",
        items: [
          "`track(value)` creates a tracked cell. Reads register a dependency on the active reaction; writes mark the owning block dirty and schedule it.",
          "`untrack(fn)` runs fn with tracking disabled; `peek(cell)` reads without registering a dependency.",
          "`derived(fn)` is a computed cell: fn runs under an effect and its result is written to the derived cell. Mutating tracked state inside a derived evaluation is forbidden.",
        ],
      },
      { kind: "h2", text: "Scheduler" },
      {
        kind: "list",
        items: [
          "Default mode is microtask-batched: writes enqueue `queueMicrotask(flush_microtasks)`, and one flush runs all queued root blocks.",
          "More than 1001 consecutive flush rounds throw \"Maximum update depth exceeded\" — the effect read-write loop guard.",
          "`flushSync(fn)` switches to synchronous scheduling while fn runs; `tick()` resolves on the next requestAnimationFrame.",
          "Low-level control: `schedule_update`, `queue_microtask` are exported.",
        ],
      },
      { kind: "h2", text: "Blocks" },
      {
        kind: "p",
        text: "Every component body and effect compiles to a block in a doubly-linked tree: render blocks, branch blocks, effect blocks, user effects, pre-effects, root blocks and try blocks. `destroy_block(pause/resume)`, `pause_block`, `is_destroyed`, and `on_destroy(fn)` manage lifecycle.",
      },
      { kind: "h2", text: "Scoped flushing" },
      {
        kind: "p",
        text: "Each cell records its owning block. When a block reads a cell owned by another block the flush is scoped, unless the owner is not an ancestor (the `disable_scoped_flush` guard).",
      },
    ],
  },
  {
    slug: "reconcile",
    title: "Keyed Reconciliation",
    description:
      "The reconcile function: keyed list updates that operate directly on the real DOM with comment markers — no virtual DOM.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "Vesk provides `reconcile` for efficient keyed list updates without a virtual DOM. It operates directly on the real DOM using comment markers.",
      },
      { kind: "h2", text: "reconcile" },
      {
        kind: "code",
        filename: "app/lib/list.ts",
        code: `import { reconcile } from '@vesk/runtime';

const update = reconcile(
  anchor,              // start comment marker node
  endAnchor,           // end comment marker node
  items,               // initial items array
  (item) => item.id,   // key function
  (item, index, effects) => {
    const el = document.createElement('li');
    el.textContent = item.name;
    anchor.parentNode.insertBefore(el, endAnchor);
  }
);

update(newItems);      // efficient patch
update([]);            // clear the list`,
      },
      { kind: "h2", text: "How it works" },
      {
        kind: "list",
        items: [
          "Comment markers (`<!--k:key-->`) are inserted as boundaries.",
          "On update, the reconciler diffs keys: matching keys reuse DOM nodes, new keys create them, removed keys destroy their blocks, reordered keys move nodes.",
          "It diffs keys, not content — O(n) for the common case.",
        ],
      },
      {
        kind: "p",
        text: "The `For` headless component and statement-mode `for` loops both compile to keyed reconciliation; you typically don't call `reconcile` directly.",
      },
    ],
  },
  {
    slug: "deployment",
    title: "Deployment",
    description:
      "One SSR function + one client bundle, platform targets, the Node server, SSR rendering rules, and the browser bundle.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "Vesk builds one SSR function and one client bundle; how they are served depends on the target platform. The default is a standard Node.js server; `vesk build --platform <name>` switches the output shape.",
      },
      { kind: "h2", text: "Platforms" },
      {
        kind: "code",
        filename: "terminal",
        code: `type Platform = 'node' | 'vercel' | 'netlify' | 'cloudflare' | 'deno' | 'aws' | 'edge' | 'coxmos'`,
      },
      {
        kind: "list",
        items: [
          "Detection order: explicit `--platform` override, then well-known CI env (e.g. DENO_DEPLOYMENT_ID → deno), then `node`.",
          "Node: `vesk start` serves the `.vesk/` build with startProdServer (default port 3000).",
        ],
      },
      { kind: "h2", text: "SSR rendering" },
      {
        kind: "list",
        items: [
          "Rendered server-side: static HTML, dynamic interpolation, conditionals, .map()/for lists, child component HTML, {#server} blocks, styles.",
          "Not rendered server-side: event-handler attributes (on* — client-only) and {#client} blocks (stripped).",
          "Tracked state renders its initial value; reactivity is client-side.",
          "All dynamic text content is escaped with `escapeHtml()` (XSS-safe); static attribute values from source are trusted.",
        ],
      },
      { kind: "h2", text: "Browser" },
      {
        kind: "p",
        text: "The client bundle is built from the compiled client codegen plus the runtime's index-client barrel, tree-shaken to the exports actually used, with hydration entry points (hydrate, hydrateViewport, hydrateIdle, hydrateOnInteraction, needsHydration, createHydrateWalker, collectVskMarkers, reactiveProps).",
      },
    ],
  },
  {
    slug: "lsp",
    title: "Language Server",
    description:
      "@vesk/lsp provides LSP support for .vsk files: diagnostics, autocomplete, go to definition, hover and find references.",
    group: "Tooling",
    blocks: [
      {
        kind: "p",
        text: "`@vesk/lsp` provides Language Server Protocol support for `.vsk` files, enabling editor features like autocomplete, diagnostics, and go-to-definition.",
      },
      { kind: "h2", text: "Features" },
      {
        kind: "list",
        items: [
          "Syntax highlighting — .vsk files are recognized as a TypeScript superset with JSX/TSX grammar.",
          "Diagnostics — compiler errors reported inline in the editor.",
          "Autocomplete — component names, auto-imported runtime APIs (track, effect, derived), props on known components, CSS class names with the Tailwind plugin.",
          "Go to definition, hover type info, and find references.",
        ],
      },
      { kind: "h2", text: "How it works" },
      {
        kind: "list",
        items: [
          "The LSP wraps the compiler's vskToTsx transform to convert .vsk files to standard TypeScript for the editor.",
          "Diagnostics come from the same pipeline that `vesk typecheck` uses.",
          "Auto-import suggestions come from the VESK_BUILTINS list in the compiler.",
          "Setup: add `\"*.vsk\": \"typescriptreact\"` to VS Code file associations; any LSP editor can connect over stdio.",
        ],
      },
    ],
  },
  {
    slug: "prettier",
    title: "Prettier Plugin",
    description:
      "@vesk/prettier-plugin formats .vsk files in Prettier, preserving component, &[] and {#server}/{#client} syntax.",
    group: "Tooling",
    blocks: [
      {
        kind: "p",
        text: "`@vesk/prettier-plugin` provides formatting support for `.vsk` files in Prettier.",
      },
      { kind: "h2", text: "Setup" },
      {
        kind: "code",
        filename: "terminal",
        code: `npm install -D @vesk/prettier-plugin`,
      },
      {
        kind: "code",
        filename: ".prettierrc",
        code: `{
  "plugins": ["@vesk/prettier-plugin"]
}`,
      },
      { kind: "h2", text: "How it works" },
      {
        kind: "list",
        items: [
          "Registers .vsk as a handled extension.",
          "Transforms .vsk syntax to TypeScript/JSX for Prettier's parser, formats, then maps back.",
          "Vesk-specific syntax (`component`, `&[]`, `{#client}`/`{#server}`) is preserved through the format pass.",
        ],
      },
    ],
  }
];

const extendedPages: DocPage[] = [
  ...dataFetchingPages,
  ...middlewarePages,
  ...routingPages,
  ...serverApisPages,
  ...configPluginPages,
  ...apiRoutesPages,
  ...cliPages,
  ...nativePages,
];

const extendedBySlug = new Map(extendedPages.map((p) => [p.slug, p]));

const docSlugOrder = [
  "getting-started",
  "components",
  "track-declarations",
  "reactivity",
  "expression-mode",
  "statement-mode",
  "client-boundary",
  "styles",
  "markdown",
  "config",
  "not-in-the-grammar",
  "pipeline",
  "ir-format",
  "static-codegen",
  "client-reachability",
  "errors",
  "routing",
  "data-fetching",
  "hydration",
  "forms",
  "api-routes",
  "middleware",
  "isr",
  "server-apis",
  "seo",
  "network",
  "bindings",
  "built-in-components",
  "headless",
  "reactive-core",
  "reconcile",
  "deployment",
  "native",
  "cli",
  "plugin-api",
  "lsp",
  "prettier",
];

export const docPages: DocPage[] = [
  ...docSlugOrder.map((slug) => {
    const replacement = extendedBySlug.get(slug);
    if (replacement) return replacement;
    const base = basePages.find((p) => p.slug === slug);
    if (base) return base;
    throw new Error(`doc slug missing: ${slug}`);
  }),
  ...extendedPages.filter((p) => !(docSlugOrder as readonly string[]).includes(p.slug)),
];

export const docSlugs = docPages.map((p) => p.slug);

export function getDoc(slug: string) {
  return docPages.find((p) => p.slug === slug);
}

export function getNeighbours(slug: string) {
  const i = docPages.findIndex((p) => p.slug === slug);
  return {
    prev: i > 0 ? docPages[i - 1] : undefined,
    next: i >= 0 && i < docPages.length - 1 ? docPages[i + 1] : undefined,
  };
}

export function headingId(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}