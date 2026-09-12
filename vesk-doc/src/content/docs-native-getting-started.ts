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
    slug: "native-getting-started",
    title: "Getting Started (Native)",
    description:
      "Scaffold a native Android app with create-vesk-native, install the toolchain, write your first .vsk page, and build an APK.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "`create-vesk-native` scaffolds a complete native project: gradle build files, a sample `.vsk` page tree, `veskconfig.ts`, and `package.json` scripts. No Android Studio project setup — the CLI owns every generated file.",
      },
      { kind: "h2", text: "Scaffold a project" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `npx create-vesk-native my-app
cd my-app
npm install
npm run dev`,
      },
      {
        kind: "list",
        items: [
          "`--template blank` — minimal single-page app.",
          "`--template starter` — counter with a test notification button (default).",
          "`--template demo` — full showcase: shop, blog, animations, media, device APIs.",
          "`--app-id com.example.myapp` — override the Android application ID.",
          "`--primary '#FF5722'` — set the theme primary color.",
          "`-y` — non-interactive mode (uses defaults for all prompts).",
        ],
      },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `npx create-vesk-native my-app -y --template starter --app-id com.example.myapp`,
      },
      { kind: "h2", text: "Toolchain setup" },
      {
        kind: "p",
        text: "The CLI detects your OS, architecture, and whether you are on Termux, then resolves the Android SDK automatically. When the toolchain is missing it offers to install it:",
      },
      {
        kind: "list",
        items: [
          "JDK 17+ — detected via `JAVA_HOME` or `which java`.",
          "Android SDK — detected via `ANDROID_HOME`, `ANDROID_SDK_ROOT`, the toolchain root, or Termux `$PREFIX`.",
          "Gradle 9.7.0 — managed at the toolchain root; PATH gradle is used only if it is a supported version.",
          "Install commands: `vesk setup` provisions everything under the toolchain root; `vesk update-tools` refreshes SDK packages and Gradle.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "Termux users get native aapt2 proxy support — the CLI detects `$PREFIX` and syncs the aapt2 override automatically.",
      },
      { kind: "h2", text: "Project layout" },
      {
        kind: "code",
        filename: "my-app/",
        language: "text",
        code: `app/
  layout.vsk              # root layout — wraps every route via {props.children}
  page.vsk                # / (home)
  about/page.vsk          # /about
  blog/page.vsk           # /blog
  blog/[slug]/page.vsk    # /blog/:slug
  shop/page.vsk           # /shop
  shop/[id]/page.vsk      # /shop/:id
veskconfig.ts             # app config (defineConfig)
libraries.json            # installed Kotlin libraries (committed)
package.json              # scripts: build, dev, dev:web, dev:desktop
app/
  build.gradle.kts        # generated — do not edit
  src/main/
    AndroidManifest.xml   # generated from device API usage
    java/com/.../
      MainActivity.kt     # generated
shared/
  build.gradle.kts        # generated KMP module
  commonMain/             # generated shared Kotlin
  androidMain/            # generated Android-specific Kotlin`,
      },
      { kind: "h2", text: "First build" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `npm run build

# Output:
# app/build/outputs/apk/debug/app-debug.apk
# shared/commonMain/src/.../
# shared/androidMain/src/.../`,
      },
      {
        kind: "list",
        items: [
          "`build` regenerates all Kotlin sources from `.vsk` files, then runs `gradle assembleDebug`.",
          "Every generated file is owned by vesk-native and regenerated on every build — never hand-edit generated files.",
          "The debug APK is signed with the debug keystore automatically.",
        ],
      },
      { kind: "h2", text: "Scripts" },
      {
        kind: "table",
        head: ["Script", "What it does"],
        rows: [
          ["npm run build", "Regenerate + gradle assembleDebug → debug APK"],
          ["npm run dev", "On-device fast reload (requires adb + emulator/device)"],
          ["npm run dev:web", "Browser preview on localhost:5173"],
          ["npm run dev:desktop", "Desktop JVM preview with Compose Hot Reload"],
        ],
      },
      { kind: "h2", text: "Key conventions" },
      {
        kind: "list",
        items: [
          "All configuration lives in `veskconfig.ts` — no XML, no Kotlin, no gradle edits.",
          "All app code lives in `.vsk` component files — Tailwind classes become Compose Modifier chains.",
          "Permissions, gradle deps, and runtime helpers are derived from what the app actually uses — never added 'just in case'.",
          "Tracked state uses `track()` and `&[]` sugar — same as web. Reads auto-subscribe, writes schedule updates.",
          "The `component` keyword, statement mode, and expression mode all work exactly as they do on the web.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "CSS animation classes are unsupported in native — use motion.animate() instead. The compiler warns on unsupported web constructs and hard-errors on untranslatable constructs.",
      },
    ],
  },
];
