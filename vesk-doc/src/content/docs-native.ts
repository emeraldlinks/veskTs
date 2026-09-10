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
        text: "The native compiler emits each component as a `@Composable` function plus a generated props data class. Tailwind classes become Compose `Modifier` chains and `TextStyle`s; block elements fill the parent width in column flow like the web.",
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
      {
        kind: "note",
        tone: "info",
        text: "CSS animation classes are not supported in native — the compiler warns on them and points to motion.animate() instead, which maps to the runtime's motion helpers.",
      },
      { kind: "h2", text: "Compiler surface" },
      {
        kind: "list",
        items: [
          "`compileVsk(source, filename, options)` → the generated Kotlin as a string.",
          "`compileVskResult(source, filename, options)` → a `CompileResult` object: `{ kt, errors, notes, libraryIds, vskTargets, jsTsTargets, npmTargets }`.",
          "`getCompileErrors(source, filename, options)` → just the error list.",
          "`compileProjectModule(source, fileRel, err, opts)` → compiles a standalone JS/TS module to Kotlin plus its export registry (`ProjectModuleCompile`).",
          "`collectCustomCss`, `extractStylesheetLinks`, `extractImageSources`, `extractMediaSources` → usage/asset extraction helpers used by the build.",
        ],
      },
      {
        kind: "p",
        text: "`CompileOptions` carries packageName, componentsWithoutProps, componentNames, customClasses, imageResources/mediaResources, rootName, fileRel, appDir, and the module/npm/vsklib registries.",
      },
      {
        kind: "p",
        text: "The `vskTargets`, `jsTsTargets` and `npmTargets` fields record the project-relative `.vsk`/JS-TS modules and bare npm specifiers the file imports, so the build can keep transitive portability and source-set placement (`commonMain` vs `androidMain`) consistent — a page is portable only when everything it imports is portable too.",
      },
      { kind: "h2", text: "CLI commands" },
      {
        kind: "p",
        text: "The `vesk-native` binary runs from inside your project directory — commands operate on the current working directory (no project-name positional).",
      },
      {
        kind: "table",
        head: ["Command", "Effect"],
        rows: [
          ["vesk-native init", "Scaffold a native app in the current directory (refuses to overwrite a non-empty dir; copies gradle scaffolding, a sample .vsk page, local.properties and a default vesk.config.ts)."],
          ["vesk-native build", "Regenerate the whole project from .vsk source, then run gradle `assembleDebug`; prints the APK path and every generated Kotlin source root."],
          ["vesk-native bundle <android|ios>", "Release packaging. Android: AAB + release APK (signing from `vesk.config.ts` `signing.android`, otherwise the debug keystore). iOS: regenerates the Xcode project, archives and exports an .ipa (requires macOS + Xcode)."],
          ["vesk-native verify [bundle]", "Read-only check that every pinned library coordinate resolves on Google Maven (androidx) or Maven Central. `verify bundle` additionally pre-flights Android signing and iOS signing/scheme setup."],
          ["vesk-native add <spec>", "Install a Kotlin library from the builtin .vsklib registry. Specs: `id`, `id@version`, `group:artifact`, `group:artifact@version`. Auto-generates a typed binding from Kotlin metadata (composable tags, JS exports, signatures) for non-registry group:artifact coordinates."],
          ["vesk-native install", "Materialize every library pinned in the committed `libraries.json` — derive permissions, rewrite the .vsklib cache, regenerate @vesk/* declarations. Offline and idempotent."],
          ["vesk-native update [spec]", "Re-pin installed libraries at newer versions (explicit spec, registry pin, or latest Maven). With no spec, bumps every installed library."],
          ["vesk-native remove <spec>", "Uninstall a library — the next build drops its gradle dependency and manifest permissions."],
          ["vesk-native dev [--port N] [--desktop] [--web]", "Dev server in three modes (below)."],
          ["vesk-native setup", "Provision the toolchain (Gradle + Android SDK) under the vesk toolchain root."],
          ["vesk-native update-tools", "Install/upgrade the managed Gradle + SDK required by build/bundle."],
        ],
      },
      { kind: "h2", text: "Dev server modes" },
      {
        kind: "list",
        items: [
          "`vesk-native dev` — on-device fast reload (default): requires adb + a device/emulator. Watches .vsk files and project modules; on change it regenerates, runs gradle `installDebug` and relaunches via adb. Cell state is lost on each relaunch.",
          "`vesk-native dev --web` — browser preview on port 5173 (override with `--port N`). `device.*` APIs map to real browser APIs where possible; unmapped calls warn no-op. Good for layout iteration, not a substitute for on-device testing.",
          "`vesk-native dev --desktop` — desktop JVM preview window with Compose Hot Reload; edits push in ms and cell state is preserved (dev-gated foojay JetBrains Runtime). The desktop target is a preview convenience — the app ships as an Android APK.",
        ],
      },
      { kind: "h2", text: "Device APIs and permissions" },
      {
        kind: "p",
        text: "The framework exposes every capability three ways — the page picks whichever fits:",
      },
      {
        kind: "list",
        items: [
          "A — state: `device.lastPhoto` bindings recompose the UI.",
          "B — callbacks: `device.pickImage((uri) => { ... })` hands results to vesk cells.",
          "C — markup elements: `<camera video />`, `<battery-status />`, `<qr-scanner />`, `<contacts />`, ... compile to native composables.",
        ],
      },
      {
        kind: "table",
        head: ["Group", "APIs"],
        rows: [
          ["Identity & screen", "`getDeviceInfo` (model · Android · resolution), `listApps`, `openApp`"],
          ["Power", "`getBattery` (level, charging), `setKeepAwake`"],
          ["Storage & memory", "`refreshStorage`/RAM free+total, app-file `writeFile`/`readFile`/`listFiles`/`deleteFile`"],
          ["Network", "`refreshNetwork` (wifi/cellular/offline+online), wifi state"],
          ["Location", "`getLocation` (GPS/network fix), `openMaps`"],
          ["Display", "`setScreenBrightness`, `lockOrientation`, `setKeepAwake`"],
          ["Audio", "`refreshVolume`, `setVolume`, `setRingerMode`, `playSound`, `speak` (TTS)"],
          ["Security", "`checkBiometrics`, `authenticate` (fingerprint/face)"],
          ["Connectivity", "Bluetooth adapter/bonded devices/discovery, NFC state, `openSettings` sections"],
          ["Communication", "`dial`, `sendSms`, `sendEmail`, `shareText`/`shareFile`, `openUrl`"],
          ["Personal data", "`listContacts`, `listCallLogs`, `listMessages`, `listAccounts`, `listCalendarEvents`"],
          ["Input", "`readClipboard`, `copyToClipboard`, `toast`, `vibrate`"],
          ["Sensors", "`readSensor` (light, proximity, accelerometer, gyroscope, temperature)"],
          ["Imaging", "`captureScreenshot`, `generateQrCode` (ZXing), QR/barcode scan (CameraX + ML Kit), `setWallpaper`, torch"],
          ["Time & intent", "`setAlarm`, SIM/carrier state, drag & drop (`draggable` + `ondrop`)"],
        ],
      },
      {
        kind: "p",
        text: "Markup-level native drag & drop: a `draggable` element becomes a drag source (payload from its `dragdata` attribute or text content); an `ondrop={(text) => { ... }}` element is a drop target. Payloads also land in other apps (`DRAG_FLAG_GLOBAL`).",
      },
      {
        kind: "h2",
        text: "Permission mapping",
      },
      {
        kind: "p",
        text: "The build scans the `.vsk` pages (AST walks — no regex) and declares in the Android manifest only the permissions the used device APIs need. `device.*` calls and their element-tag counterparts map through the same `API_PERMISSIONS` table:",
      },
      {
        kind: "table",
        head: ["Used API", "Manifest permissions"],
        rows: [
          ["`startRecording` / `<recorder>`", "RECORD_AUDIO"],
          ["`notify` / `<notification>`", "POST_NOTIFICATIONS"],
          ["`scanQr` / `<qr-scanner>`", "CAMERA"],
          ["`getLocation` / `<location>`", "ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION"],
          ["`listContacts` / `<contacts>`", "READ_CONTACTS"],
          ["`listCallLogs` / `<call-log>`", "READ_CALL_LOG"],
          ["`listMessages` / `<messages>`", "READ_SMS"],
          ["`listAccounts` / `<accounts>`", "GET_ACCOUNTS"],
          ["`refreshNetwork` / `<network-status>`", "ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE"],
          ["`vibrate` / `<vibrate>`", "VIBRATE"],
          ["`setVolume`/`setRingerMode` / `<set-volume>`", "MODIFY_AUDIO_SETTINGS"],
          ["`setWallpaper` / `<wallpaper>`", "SET_WALLPAPER"],
          ["Bluetooth calls / `<bluetooth>` `<bluetooth-toggle>` `<bluetooth-scan>`", "BLUETOOTH_CONNECT + legacy BLUETOOTH/BLUETOOTH_ADMIN (maxSdkVersion-scoped), BLUETOOTH_SCAN"],
          ["`listCalendarEvents` / `<calendar>`", "READ_CALENDAR"],
          ["`checkBiometrics`/`authenticate` / `<biometric-auth>`", "USE_BIOMETRIC"],
          ["`startScreenRecord` / `<screen-record>`", "FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PROJECTION"],
          ["`fetch` / WebSocket / EventSource", "INTERNET"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "Legacy permissions that only exist for a bounded SDK range are maxSdkVersion-scoped in the manifest: READ_EXTERNAL_STORAGE to SDK 32 and the Bluetooth pair (BLUETOOTH/BLUETOOTH_ADMIN) to SDK 30. FileProvider/or queries/service declarations and bundled assets are added only when a page actually needs them. On iOS the same device-API usage drives Info.plist usage keys (NSMicrophoneUsageDescription, NSCameraUsageDescription, NSLocationWhenInUseUsageDescription, ...) — never emitted 'just in case'.",
      },
      { kind: "h2", text: "Tangible elements" },
      {
        kind: "p",
        text: "The declarative device elements compile to the same runtime surface as the script `device.*` API. Each tag maps to a composable and feeds the manifest scan:",
      },
      {
        kind: "code",
        filename: "Camera.vsk",
        language: "tsx",
        code: `export component Camera {
  <camera video ondone={(uri) => { lastShot = uri }} />
  <battery-status />
  <qr-scanner onresult={(text) => { code = text }} />
  <contacts onresult={(list) => { people = list }} />
}`,
      },
      {
        kind: "p",
        text: "Available tags include `<photo-picker>`, `<camera>` (with `video` attribute), `<recorder>`, `<file-input>`, `<notification>`, `<battery-status>`, `<network-status>`, `<location>`, `<apps>`, `<contacts>`, `<call-log>`, `<messages>`, `<accounts>`, `<clipboard>`, `<copy-to-clipboard>`, `<vibrate>`, `<torch>`, `<screenshot>`, `<share-text>`, `<share-file>`, `<biometric-auth>`, `<bluetooth>`, `<bluetooth-toggle>`, `<bluetooth-scan>`, `<screen-record>`, `<qr-code>`, `<qr-scanner>`, `<volume>`, `<set-volume>`, `<brightness>`, `<keep-awake>`, `<orientation>`, `<device-info>`, `<storage-status>`, `<sensor>`, `<toast>`, `<sound>`, `<wallpaper>`, `<calendar>`, `<nfc>`, `<sim>`, `<dial>`, `<sms>`, `<email>`, `<open-link>`, `<map>`, `<alarm>`, `<open-settings>`, `<open-app>`, `<speak>`. Attributes pass through as named composable args (e.g. `<alarm hour='8' minute='30' title='Wake up'>`), and missing args fall back to the composable's Kotlin defaults so `<battery-status/>` alone works.",
      },
      {
        kind: "note",
        tone: "warn",
        text: "`{#head}` blocks are not supported in native, and `{#server}` blocks compile to an explicit `error(...)` so nothing silently miscompiles.",
      },
      { kind: "h2", text: "Navigation" },
      {
        kind: "p",
        text: "Routing types come from `navigation-native`: `RouteConfig` (`{ path, component }`) declares a route, `createRouter(routes)` builds a `RouterState` (`{ currentPath, navigate, back }`).",
      },
      {
        kind: "code",
        filename: "navigation-native/src/index.ts",
        language: "typescript",
        code: `export interface RouteConfig {
  path: string;
  component: string;
}

export interface RouterState {
  currentPath: string;
  navigate: (path: string) => void;
  back: () => void;
}

export function createRouter(routes: RouteConfig[]): RouterState {
  const currentPath = { value: routes[0]?.path || '/' };
  return {
    get currentPath() {
      return currentPath.value;
    },
    navigate(path: string) {
      currentPath.value = path;
    },
    back() {
      currentPath.value = '/';
    },
  };
}`,
      },
      {
        kind: "p",
        text: "In page scripts the same navigation is available through the `@vesk/browser` surface and as globals: `navigate(path)` (history.pushState semantics), `back()`/`goBack()`, `useParams()`, `useQuery()`, and `useRouter()` with `push`/`back`/`refresh`. `<Link>`/`<NavLink>`/`<Outlet>` and the Material3-backed components `<PullToRefresh>`, `<SwipeToDismiss>` and `<CardStack>` are the only framework components emitted as named calls.",
      },
      { kind: "h2", text: "Usage analysis" },
      {
        kind: "p",
        text: "The CLI's `usage.ts` scans the compiled project and the `.vsk` sources to derive exactly what ships in the app:",
      },
      {
        kind: "list",
        items: [
          "`collectDeviceApiUsage(appDir)` — AST+IR walk over .vsk scripts for `device.<api>()` calls and device element tags; drives manifest permissions and runtime grants.",
          "`collectBrowserApiUsage(appDir)` — finds `fetch`, `localStorage`/`sessionStorage`, `openSqlite`, auth (`signUp`/`signIn`/`signOut`/`currentUser`/`isSignedIn`), `WebSocket`, `EventSource` to decide their manifest needs (INTERNET for fetch).",
          "`collectRuntimeUsage(appDir)` — scans generated Kotlin to pick exactly the runtime helpers actually called (video/audio helpers only when a page uses `<video>`/`<audio>`, the device runtime only when a device API or element appears).",
          "`API_PERMISSIONS` / `MAX_SDK_PERMS` — the manifest permission tables; `DEVICE_API_IOS_USAGE` maps the same usage to iOS Info.plist usage keys.",
        ],
      },
      { kind: "h2", text: "Installed libraries" },
      {
        kind: "p",
        text: "Installed Kotlin libraries are tracked in the app's root `libraries.json` — a committed manifest, like package.json. `vesk add <spec>` pins a library (id, group:artifact, or with @version), derives its manifest permissions from the AAR plus `LIBRARY_PERMISSION_RULES` (e.g. INTERNET for okhttp/retrofit/coil/glide network clients), and regenerates typed @vesk/* declarations. The `.vsklib/` cache is gitignored and disposable; a library is only in scope in a file that explicitly `import { Tag } from '@vesk/<id>'` — installing a library never puts its tags in every page.",
      },
    ],
  },
];