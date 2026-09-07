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
  "Core",
  "Platform",
  "Reference",
] as const;

export const docPages: DocPage[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    description:
      "What Vesk is, how the compiler-first model differs from runtime frameworks, and how to scaffold your first project.",
    group: "Introduction",
    blocks: [
      {
        kind: "p",
        text: "Vesk is a compiler-first application framework. You write one declarative component model in .vsk files, and the compiler emits optimized output for each target: plain JavaScript for the web, Kotlin for Android. There is no diffing runtime shipped to your users.",
      },
      { kind: "h2", text: "Create a project" },
      {
        kind: "code",
        filename: "terminal",
        code: `npx create-vesk@latest my-app
cd my-app
vesk dev`,
      },
      {
        kind: "note",
        tone: "info",
        text: "vesk dev starts the incremental compiler with hot module replacement. First compile is typically under 400ms on a mid-range laptop.",
      },
      { kind: "h2", text: "Project layout" },
      {
        kind: "code",
        filename: "my-app/",
        code: `app/
  routes/
    index.vsk
    about.vsk
  components/
    Button.vsk
  styles.css
vesk.config.ts
package.json`,
      },
      { kind: "h2", text: "What you already know applies" },
      {
        kind: "list",
        items: [
          "TypeScript for all logic and props",
          "Tailwind-style utility classes for styling",
          "npm packages for anything pure-JS",
          "Material 3 semantics when targeting native",
        ],
      },
    ],
  },
  {
    slug: "installation",
    title: "Installation",
    description:
      "Install the Vesk toolchain, configure targets, and verify your environment for web and native builds.",
    group: "Introduction",
    blocks: [
      { kind: "h2", text: "Toolchain" },
      {
        kind: "tabs",
        tabs: [
          { label: "npm", filename: "terminal", code: `npm install -D vesk\nnpx vesk doctor` },
          { label: "pnpm", filename: "terminal", code: `pnpm add -D vesk\npnpm vesk doctor` },
          { label: "bun", filename: "terminal", code: `bun add -d vesk\nbunx vesk doctor` },
        ],
      },
      {
        kind: "p",
        text: "vesk doctor inspects your environment and reports missing native prerequisites without failing the install.",
      },
      { kind: "h2", text: "Configuration" },
      {
        kind: "code",
        filename: "vesk.config.ts",
        code: `import { defineConfig } from "vesk";

export default defineConfig({
  targets: ["web", "android"],
  web: { output: "static", hydration: "islands" },
  android: { package: "com.example.myapp", material: 3 },
});`,
      },
      {
        kind: "note",
        tone: "warn",
        text: "The android target requires JDK 17+ and the Android SDK. Web builds have no external prerequisites.",
      },
      { kind: "h2", text: "Requirements" },
      {
        kind: "table",
        head: ["Requirement", "Web", "Android"],
        rows: [
          ["Node.js 20+", "required", "required"],
          ["JDK 17+", "—", "required"],
          ["Android SDK 34", "—", "required"],
          ["Disk (cold cache)", "~90 MB", "~1.2 GB"],
        ],
      },
    ],
  },
  {
    slug: "core-concepts",
    title: "Core Concepts",
    description:
      "Components, state, effects, and the compilation boundary that decides what runs at build time versus runtime.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "Every Vesk concept exists to move work from the user's device to your build machine. Understanding the compilation boundary is the whole model.",
      },
      { kind: "h2", text: "Components" },
      {
        kind: "code",
        filename: "components/Counter.vsk",
        code: `component Counter(start: Int = 0) {
  val count = state(start)

  Column(gap: 8) {
    Text("Count: \${count.value}")
    Button(onPress: { count.value += 1 }) {
      Text("Increment")
    }
  }
}`,
      },
      { kind: "h2", text: "The compilation boundary" },
      {
        kind: "list",
        items: [
          "Static markup collapses into string templates at build time",
          "Reactive reads become direct DOM or view bindings — no virtual tree",
          "Unreachable branches are dropped from the emitted bundle",
          "Type errors are compile errors, never runtime surprises",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "state() is a compiler intrinsic, not a library call. The compiler knows every read site, so updates are surgical.",
      },
      { kind: "h2", text: "Effects" },
      {
        kind: "code",
        filename: "components/Clock.vsk",
        code: `component Clock() {
  val now = state(Date.now())

  effect(on: []) {
    val id = interval(1000) { now.value = Date.now() }
    cleanup { clear(id) }
  }

  Text(format(now.value, "HH:mm:ss"))
}`,
      },
    ],
  },
  {
    slug: "components",
    title: "Components",
    description:
      "Props, slots, composition rules, and how Vesk components map to platform primitives on each target.",
    group: "Core",
    blocks: [
      { kind: "h2", text: "Props and defaults" },
      {
        kind: "code",
        filename: "components/Card.vsk",
        code: `component Card(title: String, elevated: Bool = false) {
  Surface(elevation: elevated ? 2 : 0) {
    Text(title, style: "title")
    Slot()
  }
}`,
      },
      { kind: "h2", text: "Primitive mapping" },
      {
        kind: "table",
        head: ["Vesk", "Web output", "Android output"],
        rows: [
          ["Column", "div (flex column)", "Column composable"],
          ["Text", "span", "Text composable"],
          ["Button", "button", "Button (Material 3)"],
          ["Surface", "div", "Surface composable"],
          ["Image", "img (lazy)", "AsyncImage"],
        ],
      },
      {
        kind: "p",
        text: "Primitives are not a lowest common denominator. When a target has a richer capability, the compiler uses it and provides a documented fallback elsewhere.",
      },
    ],
  },
  {
    slug: "styling",
    title: "Styling",
    description:
      "Utility classes, design tokens, and how Vesk translates the same styling model into native theming.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "Styling uses a utility model familiar from Tailwind. On web it compiles to atomic CSS; on Android it resolves into Material 3 theme values.",
      },
      {
        kind: "code",
        filename: "components/Badge.vsk",
        code: `component Badge(label: String) {
  Text(label, class: "px-2 py-1 text-xs bg-accent text-accent-fg")
}`,
      },
      { kind: "h2", text: "Tokens" },
      {
        kind: "code",
        filename: "styles.css",
        code: `@theme {
  --color-accent: oklch(0.63 0.13 45);
  --color-accent-fg: oklch(0.16 0.01 60);
  --spacing-gutter: 1.25rem;
}`,
      },
      {
        kind: "note",
        tone: "warn",
        text: "Arbitrary CSS values that have no native equivalent compile with a warning and are ignored on the android target.",
      },
    ],
  },
  {
    slug: "animations",
    title: "Animations",
    description:
      "A single spring-based animation model that compiles to Web Animations API and Compose animation APIs.",
    group: "Core",
    blocks: [
      {
        kind: "code",
        filename: "components/Sheet.vsk",
        code: `component Sheet(open: Bool) {
  val y = animate(open ? 0 : 100, spring(stiffness: 220, damping: 26))

  Surface(transform: translateY(y.pct)) {
    Slot()
  }
}`,
      },
      {
        kind: "list",
        items: [
          "spring(), tween(), and keyframes() are the only three curves",
          "Transitions are interruptible and velocity-preserving",
          "Enter and exit are described in one place, not two",
          "Reduced-motion preferences are honoured automatically",
        ],
      },
    ],
  },
  {
    slug: "native",
    title: "Vesk Native",
    description:
      "Compile the same component tree into an idiomatic Kotlin application with Material 3 design semantics.",
    group: "Platform",
    blocks: [
      {
        kind: "p",
        text: "Vesk Native is not a web view. The compiler emits Kotlin source that you can read, review and step through in a debugger.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "Source",
            filename: "app/routes/index.vsk",
            code: `component Home() {
  Column(gap: 12, class: "p-6") {
    Text("Vesk", style: "headline")
    Button(onPress: { navigate("/about") }) {
      Text("About")
    }
  }
}`,
          },
          {
            label: "Kotlin output",
            filename: "build/android/Home.kt",
            code: `@Composable
fun Home(nav: Navigator) {
  Column(
    verticalArrangement = Arrangement.spacedBy(12.dp),
    modifier = Modifier.padding(24.dp),
  ) {
    Text("Vesk", style = MaterialTheme.typography.headlineMedium)
    Button(onClick = { nav.push("/about") }) { Text("About") }
  }
}`,
          },
        ],
      },
      { kind: "h2", text: "Device capabilities" },
      {
        kind: "list",
        items: [
          "Camera, location, biometrics and notifications via typed capability modules",
          "Permissions declared in code and validated at compile time",
          "Platform-only branches with target() guards",
        ],
      },
    ],
  },
  {
    slug: "compiler",
    title: "Compiler",
    description:
      "The five-stage Vesk pipeline: parse, resolve, analyze, optimize, and emit — plus diagnostics.",
    group: "Platform",
    blocks: [
      {
        kind: "table",
        head: ["Stage", "Input", "Responsibility"],
        rows: [
          ["parse", ".vsk source", "typed syntax tree"],
          ["resolve", "syntax tree", "bindings, imports, props"],
          ["analyze", "bound tree", "reactivity graph, diagnostics"],
          ["optimize", "graph", "static collapse, dead-code removal"],
          ["emit", "IR", "JS bundle or Kotlin source"],
        ],
      },
      { kind: "h2", text: "Reading diagnostics" },
      {
        kind: "code",
        filename: "terminal",
        code: `error[V0412]: reactive read outside a tracked scope
  --> components/Counter.vsk:7:14
   |
 7 |     Text("Count: " + count.value)
   |                      ^^^^^^^^^^^ read is not tracked
   |
help: wrap the expression in a template: "Count: \${count.value}"`,
      },
      {
        kind: "note",
        tone: "info",
        text: "Every diagnostic has a stable V-code and a documented remedy. No diagnostic ships without a help line.",
      },
    ],
  },
  {
    slug: "packages",
    title: "npm Packages",
    description:
      "Use existing npm packages inside Vesk projects, including on the native target, with clear compatibility rules.",
    group: "Platform",
    blocks: [
      {
        kind: "code",
        filename: "app/lib/money.ts",
        code: `import Dinero from "dinero.js";

export const price = (cents: number) =>
  Dinero({ amount: cents, currency: "USD" }).toFormat();`,
      },
      {
        kind: "table",
        head: ["Package kind", "Web", "Android"],
        rows: [
          ["Pure TypeScript / JS", "yes", "yes (bundled runtime)"],
          ["DOM-dependent", "yes", "no"],
          ["Node built-ins", "polyfilled", "no"],
          ["Native addons (.node)", "no", "no"],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "The compiler reports V0730 when a package reachable from a native route touches the DOM, before you ever build the APK.",
      },
    ],
  },
  {
    slug: "api",
    title: "API Reference",
    description:
      "Compiler intrinsics, configuration options and CLI commands available in the Vesk toolchain.",
    group: "Reference",
    blocks: [
      { kind: "h2", text: "Intrinsics" },
      {
        kind: "table",
        head: ["Intrinsic", "Signature", "Notes"],
        rows: [
          ["state", "state<T>(initial: T)", "tracked mutable cell"],
          ["derive", "derive<T>(() => T)", "cached computed value"],
          ["effect", "effect(on, body)", "runs after commit"],
          ["animate", "animate(to, curve)", "interruptible value"],
          ["target", "target(name, body)", "platform-only branch"],
        ],
      },
      { kind: "h2", text: "CLI" },
      {
        kind: "code",
        filename: "terminal",
        code: `vesk dev            # incremental compiler + HMR
vesk build --target web
vesk build --target android --release
vesk doctor         # environment check
vesk explain V0412  # diagnostic detail`,
      },
    ],
  },
  {
    slug: "deployment",
    title: "Deployment",
    description:
      "Ship web output to any static host or edge runtime, and native output through standard Android release channels.",
    group: "Reference",
    blocks: [
      { kind: "h2", text: "Web" },
      {
        kind: "code",
        filename: "terminal",
        code: `vesk build --target web
# → dist/  static assets + optional edge handler`,
      },
      {
        kind: "list",
        items: [
          "Static output works on any CDN with no server",
          "Island hydration keeps the default JS payload under 8 KB",
          "Edge handler is emitted only when a route uses server logic",
        ],
      },
      { kind: "h2", text: "Android" },
      {
        kind: "code",
        filename: "terminal",
        code: `vesk build --target android --release
# → build/android/app-release.aab`,
      },
      {
        kind: "note",
        tone: "info",
        text: "The emitted Gradle project is a normal Android project. You can open it in Android Studio and sign it however you already do.",
      },
    ],
  },
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
