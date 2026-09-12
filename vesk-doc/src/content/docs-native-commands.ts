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
    slug: "native-commands",
    title: "Native CLI Commands",
    description:
      "Every vesk-native command: init, build, bundle, verify, setup, update-tools, dev, and the library verbs (add, install, update, remove).",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "The `vesk-native` binary (package `@vesk/native-cli`) runs from inside your project directory — commands operate on the current working directory. There is no project-name positional.",
      },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `Usage: vesk-native <command> [options]

  init                    Scaffold a native app in the current directory
  build                   Regenerate Kotlin from .vsk sources + gradle assembleDebug
  bundle <android|ios>    Build release artifacts (default: android)
  verify [bundle [android|ios]]   Check libraries and signing pre-flight
  dev [--port N] [--desktop|--web]  Dev loop (on-device / desktop / web preview)
  add <spec>              Install a Kotlin library into libraries.json
  install                 Materialize all pinned libraries offline
  update [spec]           Update installed libraries
  remove <spec>           Uninstall a library
  setup                   Provision the toolchain (Gradle + SDK)
  update-tools            Upgrade the managed Gradle + SDK`,
      },
      { kind: "h2", text: "Commands" },
      {
        kind: "table",
        head: ["Command", "Flags", "Behavior"],
        rows: [
          ["vesk-native init", "—", "Scaffold into the current directory. Refuses non-empty dirs; copies gradle scaffolding from the template, writes local.properties (sdk.dir), writes the default `veskconfig.ts`, copies the sample .vsk tree into app/, and generates the project."],
          ["vesk-native build", "—", "loadConfig → generateProject → `gradle assembleDebug`. Prints the debug APK path and every generated Kotlin source root (shared commonMain/androidMain + MainActivity.kt)."],
          ["vesk-native bundle", "android | ios (default android)", "Release packaging. Android: pre-flight signing checks, then aab/apk per `config.bundle.android`. iOS: signing checks → regenerate → archive → export .ipa (macOS + Xcode required)."],
          ["vesk-native verify", "bundle | bundle <platform> | without args", "Read-only gate: every pinned library coordinate resolves on Google Maven / Maven Central. `verify bundle` additionally pre-flights Android signing and iOS signing/scheme setup; exits non-zero on any FAIL."],
          ["vesk-native setup", "—", "Provisions JDK detection, Android SDK (cmdline-tools, packages, licenses), Gradle 9.7.0, and the aapt2 override under the toolchain root."],
          ["vesk-native update-tools", "—", "Refreshes the SDK via sdkmanager --update, reinstalls Gradle, prunes older managed distributions, rewrites env.sh."],
          ["vesk-native dev", "--port N (default 5173 web) · --desktop · --web", "Three dev modes — see the Native Dev page."],
          ["vesk-native add <spec>", "spec: id · id@version · group:artifact · group:artifact@version", "Installs a Kotlin library from the builtin .vsklib registry or auto-generates a typed binding for arbitrary group:artifact coordinates."],
          ["vesk-native install", "—", "Offline, idempotent materialization of every library pinned in the committed libraries.json. Runs once after scaffolding."],
          ["vesk-native update [spec]", "spec optional", "Re-pin installed libraries to newer versions: explicit spec wins, then registry pin, then latest Maven. No spec → bumps everything. Curated records resync without a version bump."],
          ["vesk-native remove <spec>", "spec: id or group:artifact", "Drops a library from libraries.json; the next build removes its gradle dependency and manifest permissions."],
        ],
      },
      { kind: "h2", text: "Toolchain resolution" },
      {
        kind: "list",
        items: [
          "Toolchain root precedence: `VESK_HOME` → `/opt/vesk-native-toolchain` → `~/.vesk-native`.",
          "Termux is detected via `$TERMUX_VERSION`/`$PREFIX`; the SDK resolves to `$PREFIX/sdk`.",
          "Gradle: the managed `gradle-9.7.0` wins; PATH/GRADLE_HOME gradle is used only if `isSupportedGradle`. Otherwise the CLI exits pointing at `update-tools`.",
          "JDK: `JAVA_HOME` → `java` on PATH → error; keytool resolution mirrors this.",
          "`env:NAME` secrets (store/keys) resolve from environment variables at use time, never written into generated files.",
        ],
      },
      { kind: "h2", text: "Exit codes" },
      {
        kind: "table",
        head: ["Code", "Meaning"],
        rows: [
          ["0", "Success (verify: all checks PASS; dev: running until interrupted)."],
          ["1", "Failure — missing config, failed build, failed verify, unsupported toolchain, unknown command."],
        ],
      },
      { kind: "h2", text: "Programmatic surface" },
      {
        kind: "p",
        text: "`@vesk/native-cli` also exports the machinery behind the commands for tooling and CI:",
      },
      {
        kind: "list",
        items: [
          "`loadConfig`, `writeDefaultConfig` — config loading & authoring.",
          "`generateAppKt`, `generateAppBuildGradleKts`, `generateMainActivity`, `generateManifest`, `generateProject`, `generateRouterKt`, `generateRuntimeKt`, `generateSettingsGradleKts`, `generateThemeKt`, `generateThemes` — the generators.",
          "`addLibrary`, `removeLibrary`, `updateLibraries`, `installAllLibraries`, `verifyApp`, `verifyBundle` — the command logic.",
          "`collectDeviceApiUsage`, `collectBrowserApiUsage`, `collectRuntimeUsage`, `API_PERMISSIONS` — usage analysis.",
          "`LIBRARY_REGISTRY`, `installedLibraries`, `loadLibraries`, `parseLibrarySpec`, `resolveLibrary`, `saveLibraries`, `verifyLibraries`, `writeVsklibCache` — the .vsklib system.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "Scaffolding is the separate `create-vesk-native` binary — see the Native Getting Started page. `vesk-native init` only works in an empty directory.",
      },
    ],
  },
];