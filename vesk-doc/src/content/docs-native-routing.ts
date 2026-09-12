export type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: { slug: string; title: string; description: string; group: string; blocks: Block[] }[] = [
  {
    slug: "native-routing",
    title: "Native Routing",
    description:
      "File-based and manual routing in vesk-native: layout/page conventions, dynamic params, manual routes in veskconfig.ts, Link/NavLink/Outlet, and programmatic navigation.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "Vesk Native uses file-based routing by default — the folder structure under `app/` maps directly to navigation routes. Manual routes can be added in `veskconfig.ts` for cases that don't fit the filesystem.",
      },
      { kind: "h2", text: "File-based routing" },
      {
        kind: "p",
        text: "Place `.vsk` files in `app/` to create routes. The convention is identical to the web framework:",
      },
      {
        kind: "table",
        head: ["File path", "Route"],
        rows: [
          ["app/page.vsk", "/ (root)"],
          ["app/about/page.vsk", "/about"],
          ["app/blog/page.vsk", "/blog"],
          ["app/blog/[slug]/page.vsk", "/blog/:slug"],
          ["app/shop/[id]/page.vsk", "/shop/:id"],
          ["app/layout.vsk", "Layout wrapper (not a route)"],
        ],
      },
      {
        kind: "list",
        items: [
          "`layout.vsk` is skipped as a route — it wraps child routes via `{props.children}`.",
          "`page.vsk` inside a folder maps to that folder's path.",
          "`[paramName]` folders create dynamic route segments — the param is extracted from the URL.",
          "Nested folders create nested paths: `app/blog/[slug]/page.vsk` → `/blog/:slug`.",
        ],
      },
      { kind: "h2", text: "Layout file" },
      {
        kind: "code",
        filename: "app/layout.vsk",
        language: "tsx",
        code: `component Layout(props) {
  <div class="flex-col w-full h-full">
    <nav class="bg-white px-4 py-2 border-b">
      <NavLink href="/">
        <span class="text-base font-bold">MyApp</span>
      </NavLink>
      <div class="flex gap-3">
        <NavLink href="/about" class="text-sm">About</NavLink>
        <NavLink href="/shop" class="text-sm">Shop</NavLink>
      </div>
    </nav>
    <main class="flex-1">
      {props.children}
    </main>
  </div>
}`,
      },
      { kind: "h2", text: "Dynamic params" },
      {
        kind: "p",
        text: "Use `[paramName]` in the folder name to create a dynamic segment. Access the param value with `useParams()` in the page script:",
      },
      {
        kind: "code",
        filename: "app/blog/[slug]/page.vsk",
        language: "tsx",
        code: `export component BlogPost() {
  const params = useParams()
  const slug = params.slug

  <div class="p-4">
    <h1 class="text-xl font-bold">Post: {slug}</h1>
  </div>
}`,
      },
      {
        kind: "note",
        tone: "info",
        text: "`useParams()` returns a `Record<string, string>` with the dynamic segment values. All values are strings.",
      },
      { kind: "h2", text: "Manual routes" },
      {
        kind: "p",
        text: "For routes that don't fit the filesystem, add them to `veskconfig.ts` under `routes`. Manual routes use `component` to reference a component name defined in a `.vsk` file:",
      },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `import { defineConfig } from '@vesk/native'

export default defineConfig({
  // ... other config
  routes: [
    { path: '/settings', component: 'SettingsPage' },
    { path: '/profile/:userId', component: 'ProfilePage' },
  ],
})`,
      },
      {
        kind: "list",
        items: [
          "Manual routes are merged with file-based routes — file-based routes take precedence for the same path.",
          "The `component` value is the name of a component declared in any `.vsk` file in your app.",
          "Dynamic segments use `:paramName` syntax — same as file-based `[paramName]` folders.",
          "Manual routes support `exitOnBack` to mark the route as a double-back-to-exit page.",
        ],
      },
      { kind: "h2", text: "Link and NavLink" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Nav.vsk",
            code: `component Nav() {
  <div class="flex gap-3 p-4">
    <Link href="/about">
      <span class="text-blue-600">About</span>
    </Link>
    <NavLink href="/shop" class="text-gray-600">
      Shop
    </NavLink>
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Nav.vsk",
            code: `component Nav() {
  return (
    <div class="flex gap-3 p-4">
      <Link href="/about">
        <span class="text-blue-600">About</span>
      </Link>
      <NavLink href="/shop" class="text-gray-600">
        Shop
      </NavLink>
    </div>
  );
}`,
          },
        ],
      },
      {
        kind: "list",
        items: [
          "`<Link href=\"/path\">` — a navigation link. Tap navigates to the route.",
          "`<NavLink href=\"/path\" class=\"...\">` — a link that also receives an active class when the route matches.",
          "Both accept `class` for styling.",
          "`<Outlet />` renders the child route inside a layout — use it in `layout.vsk` where you want `{props.children}` to appear.",
        ],
      },
      { kind: "h2", text: "Programmatic navigation" },
      {
        kind: "p",
        text: "In page scripts, navigate imperatively with the global helpers or the router hook:",
      },
      {
        kind: "table",
        head: ["Function", "Behavior"],
        rows: [
          ["navigate('/path')", "Push a new route onto the navigation stack."],
          ["goBack()", "Pop the navigation stack. Returns false at the root."],
          ["useParams()", "Return the current route's dynamic params as Record<string, string>."],
          ["useQuery()", "Return the current route's query string as Record<string, string>."],
          ["useRouter()", "Return the full router object: { currentPath, navigate, back, refresh }."],
        ],
      },
      {
        kind: "code",
        filename: "app/profile/page.vsk",
        language: "tsx",
        code: `export component ProfilePage() {
  const params = useParams()
  const query = useQuery()
  const router = useRouter()

  <div class="p-4">
    <h1>Profile: {params.userId}</h1>
    <p>Tab: {query.tab}</p>
    <button onClick={() => goBack()} class="mt-4 text-blue-600">
      Go back
    </button>
    <button onClick={() => navigate('/settings')} class="mt-2 text-blue-600">
      Settings
    </button>
  </div>
}`,
      },
      { kind: "h2", text: "Back navigation behavior" },
      {
        kind: "p",
        text: "The back behavior is configured in `veskconfig.ts` under `back`:",
      },
      {
        kind: "list",
        items: [
          "`mode: 'stack'` — custom stack-based navigation with double-back-to-exit.",
          "`mode: 'system'` — delegates to the OS back button (Android default).",
          "`doubleBackToExit: true` — tapping back twice within `exitDelayMs` exits the app.",
          "`exitRoutes` — routes where a double-back exits; interior routes always pop the stack first.",
          "`exitRoutes` defaults to the root page (`/`) — add `{ path: '/shop', exitOnBack: true }` in manual routes to change this.",
        ],
      },
      { kind: "h2", text: "Scroll restoration" },
      {
        kind: "p",
        text: "The router automatically saves and restores scroll position per route. Each route's scroll state is stored in the `NavController` and restored when navigating back.",
      },
      {
        kind: "code",
        filename: "app/components/ScrollList.vsk",
        language: "tsx",
        code: `export component ScrollList() {
  const scrollState = rememberRouteScrollState(0)

  <div class="overflow-y-auto flex-1" scrollState={scrollState}>
    {props.children}
  </div>
}`,
      },
      { kind: "h2", text: "Generated Kotlin router" },
      {
        kind: "p",
        text: "The build generates a `Router.kt` with a `NavController` class that holds the navigation state as Compose `mutableStateOf` properties. Route matching strips `?query` and `#fragment` segments, matches `{param}` segments, and returns `null` for unknown routes (renders nothing).",
      },
      {
        kind: "note",
        tone: "info",
        text: "The `navigation-native` npm package provides the JS-side types (`RouteConfig`, `RouterState`, `createRouter`) — the real navigation is the generated Kotlin `NavController` running on the device.",
      },
    ],
  },
];
