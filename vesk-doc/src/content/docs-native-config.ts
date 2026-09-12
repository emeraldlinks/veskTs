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
    slug: "native-config",
    title: "Native Configuration",
    description:
      "The full veskconfig.ts reference for native apps: identity, SDK targets, theme, back behavior, edge-to-edge, deep links, icon, splash, signing, and bundling.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "Native apps configure everything in `veskconfig.ts` with `defineConfig` from `@vesk/native`. The CLI loads `veskconfig.ts` first, falling back to a legacy `veskconfig.json`. Settings deep-merge over defaults, so most apps start with the generated file and change a few fields.",
      },
      { kind: "h2", text: "Basic config" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `import { defineConfig } from '@vesk/native'

export default defineConfig({
  appId: 'com.example.myapp',
  appName: 'My App',
  versionName: '1.0.0',
  versionCode: 1,
  compileSdk: 37,
  minSdk: 24,
  targetSdk: 36,
  theme: 'system',
})`,
      },
      { kind: "h2", text: "Identity & SDK" },
      {
        kind: "table",
        head: ["Option", "Type", "Default", "Description"],
        rows: [
          ["appId", "string", "com.vesk.demo", "Android application ID / iOS bundle identifier."],
          ["appName", "string", "Vesk Demo", "App display name (launcher label, iOS display name)."],
          ["versionName", "string", "0.1.0", "Human-readable version shown in stores."],
          ["versionCode", "number", "1", "Monotonic build number for Android versioning."],
          ["compileSdk", "number", "37", "Android SDK level used to compile."],
          ["minSdk", "number", "24", "Minimum supported Android version. Raised to the max across installed libraries."],
          ["targetSdk", "number", "36", "Behavior-change target; Android 15+ forces edge-to-edge."],
        ],
      },
      { kind: "h2", text: "Theme" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  theme: 'system', // 'system' | 'light' | 'dark'
  colors: {
    primary: '#3B82F6',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    onPrimary: '#FFFFFF',
    text: '#1F2937',
  },
  darkColors: {
    primary: '#60A5FA',
    background: '#0F172A',
    surface: '#1E293B',
    onPrimary: '#0F172A',
    text: '#E2E8F0',
  },
  typography: {
    fontFamily: 'sans-serif', // Android font family
    fontSize: 16,             // base sp size
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`colors` — light theme palette; `darkColors` — dark palette.",
          "`theme: 'system'` follows the device setting; `'light'`/`'dark'` force a mode.",
          "`typography.fontFamily` maps to the Compose font family; `fontSize` is the base sp size.",
        ],
      },
      { kind: "h2", text: "Layout" },
      {
        kind: "table",
        head: ["Option", "Type", "Default", "Description"],
        rows: [
          ["orientation", "'portrait' | 'landscape'", "portrait", "Screen orientation lock."],
          ["device", "'phone' | 'tablet'", "phone", "'tablet' constrains content to a centered 840dp column."],
          ["root", "string", "''", "Overrides the root component name (first component in the layout file when omitted)."],
          ["page", "string", "''", "Name of the page component rendered for the root route."],
        ],
      },
      { kind: "h2", text: "Back behavior" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  back: {
    mode: 'stack',       // 'stack' (history pop) | 'system' (OS default)
    doubleBackToExit: true,
    exitDelayMs: 2000,
    exitRoutes: [],      // routes where double-back exits (default: root)
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`mode: 'stack'` — the framework owns the back stack; `'system'` delegates to the OS.",
          "`doubleBackToExit` + `doubleBackToExit` delay — fast double-back at an exit route quits the app.",
          "`exitRoutes` are route patterns (`'/flight/{id}'`) where a double-back exits instead of popping.",
          "The stack bottom always exits, even when not listed — it's the deep-link escape hatch.",
        ],
      },
      { kind: "h2", text: "Edge-to-edge & system bars" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  edgeToEdge: {
    enabled: true,
    paddingBars: true,
    statusBarStyle: 'auto',       // 'auto' | 'light' | 'dark'
    navigationBarStyle: 'auto',
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`enabled: true` draws content behind the system bars (Android's modern default).",
          "`paddingBars: true` reserves insets so content never sits under the bars; `false` is full-bleed.",
          "`statusBarStyle` / `navigationBarStyle` control icon color: `'auto'` follows the theme, `'light'` dark icons, `'dark'` light icons.",
          "Android 15+ forces edge-to-edge regardless of `enabled` — the framework still pads content so nothing is hidden.",
        ],
      },
      { kind: "h2", text: "Media" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  media: {
    broadcast: true, // system media session + lock-screen controls (default)
  },
})`,
      },
      {
        kind: "p",
        text: "`media.broadcast: true` exposes `<video>`/`<audio>` playback as an Android media session — lock screen, media buttons, and headset controls. Set `false` to opt out.",
      },
      { kind: "h2", text: "Routes & screens" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  // Manual routes (file-based routes are automatic)
  routes: [
    { path: '/settings', component: 'SettingsPage' },
    { path: '/profile/:userId', component: 'ProfilePage', exitOnBack: true },
  ],

  // Per-screen props (override in-file pageProps defaults)
  screens: {
    '/about': { props: { title: 'About us' } },
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`routes` — manual routes; dynamic segments use `:paramName`. File-based routes take precedence on path collision.",
          "`screens` — keyed by route path; values are passed to the route's page component as props.",
          "Pages can also declare `export const pageProps = { ... }` defaults in-file; config values override them.",
        ],
      },
      { kind: "h2", text: "Icon & splash" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  icon: {
    foreground: 'assets/icon.png', // 432x432 PNG recommended
    backgroundColor: '#3B82F6',
  },
  splash: {
    enabled: true,
    backgroundColor: '#FFFFFF',
    logo: 'assets/splash-logo.png',
    animationDurationMs: 0,
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`icon.foreground` — adaptive icon foreground (PNG, 432x432). Omitted → the app name's first letter on the primary color.",
          "`icon.backgroundColor` — adaptive icon background, defaults to `colors.primary`.",
          "`splash.enabled` — Android 12+ uses the system SplashScreen; older devices use core-splashscreen.",
          "`splash.logo` defaults to the adaptive icon foreground when omitted.",
        ],
      },
      { kind: "h2", text: "Deep links" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  deepLinks: {
    scheme: 'myapp',   // defaults to appId-derived scheme when omitted
    host: '',          // empty host = any host matches
    pathPrefix: '/flight', // restrict to paths under /flight
  },
})`,
      },
      {
        kind: "list",
        items: [
          "An external URL `scheme://host/pathPrefix...` launches the app at the matching route.",
          "Scheme defaults to the appId-derived scheme (`com.vesk.demo3` → `vesk.demo3`).",
          "Omitted `host` = any host matches; omitted `pathPrefix` = every path under the scheme/host matches.",
          "When `deepLinks` is entirely omitted, no intent-filter is emitted — deep links are disabled.",
        ],
      },
      { kind: "h2", text: "Permissions" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  // Extra <uses-permission> entries emitted verbatim into AndroidManifest.xml
  permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
})`,
      },
      {
        kind: "p",
        text: "Storage, media, recording, camera, contacts, and network permissions are derived automatically from the device APIs and element tags the app actually uses — see the Native APIs page. `permissions` only adds extras the usage scan can't infer.",
      },
      { kind: "h2", text: "Signing & bundle" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  signing: {
    android: {
      storeFile: 'keystore.jks',
      storePassword: 'env:KEYSTORE_PASSWORD',  // never commit plain secrets
      keyAlias: 'upload',
      keyPassword: 'env:KEY_PASSWORD',
    },
    ios: {
      teamId: 'A1B2C3D4E5',
      style: 'automatic', // 'automatic' | 'manual'
    },
  },
  bundle: {
    android: ['aab', 'apk'],
    ios: {
      method: 'app-store-connect', // 'app-store-connect' | 'ad-hoc' | 'development' | 'enterprise'
      destination: 'export',       // 'export' | 'upload'
      uploadSymbols: true,
      scheme: 'VeskApp',
    },
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`signing.android` — upload-key keystore; passwords reference env vars (`env:NAME`). No config → debug keystore (dev flow only).",
          "`signing.ios` — Apple team id + automatic (Xcode-managed) or manual (cert + profile) signing.",
          "`bundle.android` — which release artifacts to build (default `['aab', 'apk']`).",
          "`bundle.ios` — export method, destination, dSYMs, and Xcode scheme.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "Details, requirements and the full pre-flight checks live on the Native Signing & Bundling page. Play App Signing makes the AAB mandatory for new apps since August 2021; the Android key must be RSA 2048-bit with validity past 2033-10-22.",
      },
      { kind: "h2", text: "Config loading" },
      {
        kind: "list",
        items: [
          "The CLI resolves `veskconfig.ts` first (dynamic import, logs `module: vesk-native defineConfig`), then a legacy `veskconfig.json` (logs `legacy — migrate to veskconfig.ts`).",
          "Missing both → exit 1.",
          "`colors`, `darkColors`, and `edgeToEdge` are deep-merged over the defaults; every other field is replaced wholesale when present.",
        ],
      },
    ],
  },
];