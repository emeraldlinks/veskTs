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
    slug: "native-libraries",
    title: "Native Libraries (.vsklib)",
    description:
      "The .vsklib library system: libraries.json, the curated registry, vesk add/install/update/remove, auto-generated bindings, and using Kotlin libraries from .vsk.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "Native apps can install real Kotlin/Android libraries and use them from `.vsk` files. Installed libraries are tracked in a committed `libraries.json` manifest, resolved against a curated `.vsklib` registry (for common libraries like Coil, Retrofit, and Room), with auto-generated typed bindings for anything else.",
      },
      { kind: "h2", text: "The two file surfaces" },
      {
        kind: "table",
        head: ["File", "Role"],
        rows: [
          ["libraries.json", "Committed manifest of installed libraries — like package.json. Written only by `vesk add/remove/update/install`."],
          [".vsklib/", "Gitignored, disposable per-library record cache (AAR metadata, signatures, generated .d.ts declarations)."],
        ],
      },
      { kind: "h2", text: "Installing a library" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `# Install from the curated registry by id
vesk-native add lottie
vesk-native add coil

# Pin a version
vesk-native add lottie@6.5.2

# Bare Maven coordinates (auto-generates a typed binding)
vesk-native add com.squareup.okhttp3:okhttp
vesk-native add com.google.code.gson:gson@2.11.0`,
      },
      {
        kind: "list",
        items: [
          "Spec forms: `id`, `id@version`, `group:artifact`, `group:artifact@version` (`parseLibrarySpec`).",
          "Curated registry records are trusted verbatim; unknown `group:artifact` coordinates re-download the AAR/JAR and auto-generate a binding.",
          "The next build derives the library's gradle dependency, manifest permissions, and minimum SDK automatically.",
          "The app's `minSdk` is raised to the max across installed libraries — never a `tools:overrideLibrary` workaround.",
        ],
      },
      { kind: "h2", text: "libraries.json format" },
      {
        kind: "code",
        filename: "libraries.json",
        language: "json",
        code: `{
  "version": 1,
  "libraries": {
    "lottie": {
      "id": "lottie",
      "name": "Lottie",
      "description": "Airbnb Lottie animations for Compose",
      "group": "essential",
      "artifact": "com.airbnb.android:lottie-compose",
      "version": "6.5.2",
      "gradle": ["com.airbnb.android:lottie-compose:6.5.2"],
      "multiplatform": false,
      "permissions": [],
      "exports": ["LottieComposition"],
      "libType": "utility",
      "essential": true,
      "curated": true
    }
  }
}`,
      },
      {
        kind: "list",
        items: [
          "`gradle` — the `implementation` dependencies added to the build.",
          "`multiplatform` — true when the library publishes a Gradle common variant (`metadataApiElements`); decides whether importing pages land in `commonMain` vs `androidMain`.",
          "`permissions` — manifest permissions the library needs, merged with the usage scan.",
          "`exports` — composable tags / JS exports the library makes available to `.vsk`.",
          "`minSdk` — raised across installed libraries.",
          "`esssential` / `curated` — registry-authoring flags.",
        ],
      },
      { kind: "h2", text: "Using a library from .vsk" },
      {
        kind: "p",
        text: "A library is only in scope in a file that explicitly imports it — installing a library never puts its tags in every page:",
      },
      {
        kind: "code",
        filename: "app/lib/page.vsk",
        language: "tsx",
        code: `import { LottieComposition } from '@vesk/lottie'

export component LibExample() {
  <LottieComposition src="/animations/loading.json" class="w-40 h-40" />
}`,
      },
      {
        kind: "list",
        items: [
          "Import specifier is always `@vesk/<libraryId>`.",
          "The typed `.d.ts` declarations are regenerated into `.vsklib/` on every add/install, giving editor autocomplete and typecheck coverage.",
          "Binding auto-generation parses the AAR's Kotlin @Metadata, class files, and AndroidManifest.xml to produce composable tags and signatures — never guessed from the name.",
        ],
      },
      { kind: "h2", text: "Curated registry" },
      {
        kind: "p",
        text: "The registry ships committed `.vsklib` records in categories, authored from real library metadata — never invented:",
      },
      {
        kind: "table",
        head: ["Category", "Libraries"],
        rows: [
          ["animations", "animation-core, animation-graphics, material-ripple, shimmer"],
          ["charts", "vico, ycharts"],
          ["device", "billing, biometric, camera-camera2, camera-lifecycle, firebase-messaging, in-app-review, media3-exoplayer, mlkit-barcode, play-services-auth, play-services-location, play-services-maps"],
          ["essential", "coil, datastore, gson, kotlinx-serialization, lottie, moshi, okhttp, retrofit, room, workmanager"],
          ["icons", "icons-lucide, material-icons"],
          ["images", "coil3, coil-gif, coil-svg, coil-video, exifinterface, glide, glide-compose"],
          ["json", "jackson"],
          ["network", "apollo, chucker, ktor-client, okhttp-logging, okio, picasso, retrofit-gson, retrofit-moshi"],
          ["tools", "accompanist-permissions, flexbox, leakcanary, palette, timber, zxing"],
          ["utilities", "activity-compose, browser, constraintlayout-compose, core-ktx, coroutines, datetime, foundation, foundation-layout, immutable-collections, material, material3, navigation, preference-ktx, security-crypto, ui, viewmodel-compose"],
        ],
      },
      { kind: "h2", text: "Permission derivation" },
      {
        kind: "p",
        text: "Library permissions come from two sources, merged by `deriveLibraryPermissions`:",
      },
      {
        kind: "list",
        items: [
          "The AAR's packaged AndroidManifest.xml (via the binary AXML parser) — network libraries declare INTERNET themselves.",
          "`LIBRARY_PERMISSION_RULES`, group-based autos: `io.coil-kt`, `com.github.bumptech.glide`, `com.squareup.okhttp(3)`, `com.squareup.retrofit2`, `com.squareup.picasso`, `io.ktor` → INTERNET.",
        ],
      },
      { kind: "h2", text: "Offline behavior" },
      {
        kind: "list",
        items: [
          "`vesk-native install` is fully offline — libraries.json is trusted as authored; it's exactly what the build compiles against.",
          "`vesk-native add` falls back to the pinned registry record when Maven is unreachable (with a warning).",
          "`vesk-native verify` reports unreachable registries as skip/warn, but hard-fails on `not-found` and `version-missing` (CI-safe).",
        ],
      },
      { kind: "h2", text: "Workflows" },
      {
        kind: "table",
        head: ["Task", "Command"],
        rows: [
          ["Install a registry library", "vesk-native add coil"],
          ["Pin an exact version", "vesk-native add lottie@6.5.2"],
          ["Use an arbitrary Maven artifact", "vesk-native add com.google.code.gson:gson"],
          ["Materialize pinned libraries (after scaffold)", "vesk-native install"],
          ["Update everything", "vesk-native update"],
          ["Update one library", "vesk-native update okhttp"],
          ["Remove a library", "vesk-native remove lottie"],
          ["Check all coordinates resolve", "vesk-native verify"],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "Registry signatures are never guessed — every `.vsklib` field comes from real AAR/JAR metadata, Kotlin @Metadata, GitHub sources, or the runtime. A wrong signature is worse than a missing one; unknowns fail closed.",
      },
    ],
  },
];