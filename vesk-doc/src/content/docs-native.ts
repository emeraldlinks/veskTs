type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: { slug: string; title: string; description: string; group: string; blocks: Block[] }[] = [
  {
    slug: "native",
    title: "Vesk Native",
    description:
      "Compile .vsk components to Kotlin with Jetpack Compose and Material 3 — real Android views, real platform APIs, no WebView.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "`@vesk/native-compiler` translates `.vsk` files (Markup + Tailwind + scripts) into native Kotlin/Compose Android apps. No Android Studio needed: the compiler walks the same `@vesk/compiler` IR the web compiler produces and emits readable Kotlin source using Jetpack Compose with Material 3 defaults. Every generated artifact — code, manifest permissions, assets — is derived from what the app's `.vsk` pages actually use, never copied wholesale.",
      },
      { kind: "h2", text: "Packages" },
      {
        kind: "table",
        head: ["Package", "Role"],
        rows: [
          ["@vesk/native", "App-facing API: `defineConfig` and the `VeskConfig`/`VeskSigning`/`VeskBundle`/`VeskThemeMode` types for a native app's `vesk.config.ts`."],
          ["@vesk/native-compiler", "Compiler — walks @vesk/compiler IR and emits Kotlin `.kt` source (`compileVsk`, `compileVskResult`)."],
          ["@vesk/native-cli", "CLI — the `vesk-native` binary: init/build/bundle/verify/dev plus library management."],
          ["navigation-native", "Device routing types (`RouteConfig`, `RouterState`, `createRouter`) shared by the toolchain."],
        ],
      },
      { kind: "h2", text: "One source, Kotlin output" },
      {
        kind: "code",
        filename: "About.vsk",
        language: "tsx",
        code: `export component About {
  <div class="max-w-3xl mx-auto px-4 py-14">
    <h1 class="text-3xl font-semibold text-ink">About Vesk</h1>
    <p class="text-muted">Some text here.</p>
  </div>
}`,
      },
      {
        kind: "p",
        text: "The compiler emits each component as a `@Composable` function plus a generated props data class. Tailwind classes become Compose `Modifier` chains and `TextStyle`s; block elements fill the parent width in column flow like the web.",
      },
      {
        kind: "code",
        filename: "About.kt",
        language: "kotlin",
        code: `@Composable
fun About(props: AboutProps = AboutProps()) {
  Column(
    modifier = Modifier.widthIn(max = 768.dp).padding(horizontal = 16.dp).padding(vertical = 56.dp),
  ) {
    Text(
      text = "About Vesk",
      modifier = Modifier.fillMaxWidth(),
      style = TextStyle(fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold),
    )
    Text(
      text = "Some text here.",
      modifier = Modifier.fillMaxWidth(),
    )
  }
}`,
      },
      { kind: "h2", text: "The native docs" },
      {
        kind: "list",
        items: [
          "Getting started — scaffolding, the toolchain, project layout, and the build/dev commands.",
          "Config — the full `veskconfig.ts` reference: identity, SDK levels, theme, back handling, deep links, media, permissions, signing, and bundling.",
          "Routing — file-based routes in `app/`, manual routes, dynamic segments, and the navigation API.",
          "Device APIs — the `device.*` surface, tangible elements, and how permissions are derived from usage.",
          "Web API mappings — fetch, storage, sqlite, auth, and web-platform constructs and their native equivalents.",
          "Framework components — Link, NavLink, Outlet, PullToRefresh, SwipeToDismiss, and CardStack.",
          "Motion — `motion.animate()` and friends mapped to Compose.",
          "Libraries — the `libraries.json` system and `vesk add/install/update/remove`.",
          "Dev modes — on-device fast reload, the desktop JVM preview, and the web preview shim.",
          "Signing & bundling — release packaging for Android (AAB/APK) and iOS (.ipa).",
          "Compiler — the `compileVsk` surface and Kotlin codegen behavior.",
          "CLI reference — every `vesk-native` command and flag.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "CSS animation classes are not supported in native — the compiler warns on them and points to motion.animate() instead, which maps to the runtime's motion helpers.",
      },
    ],
  },
];