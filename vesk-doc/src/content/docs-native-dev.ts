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
    slug: "native-dev",
    title: "Native Dev Modes",
    description:
      "The three vesk-native dev loops: on-device fast reload, the desktop JVM preview with Compose Hot Reload, and the web browser preview with the device.* shim.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "`vesk-native dev` runs in three modes. The default targets a connected device with fast reload; `--desktop` opens a desktop window with Compose Hot Reload; `--web` previews in the browser. All three watch `.vsk` files, project modules, `veskconfig.*`, and `libraries.json`.",
      },
      { kind: "h2", text: "Mode comparison" },
      {
        kind: "table",
        head: ["Mode", "Flag", "Target", "Reload", "Cell state"],
        rows: [
          ["On-device", "(default)", "adb device / emulator", "Regenerate + installDebug + relaunch (5-15s)", "Reset on each relaunch"],
          ["Desktop", "--desktop", "JVM window", "Compose Hot Reload (ms)", "Preserved"],
          ["Web", "--web", "Browser", "Per-file HMR over WebSocket", "Preserved"],
        ],
      },
      { kind: "h2", text: "On-device fast reload (default)" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `vesk-native dev   # requires a connected adb device or emulator`,
      },
      {
        kind: "list",
        items: [
          "Verifies an adb device, runs `gradle installDebug`, and starts `MainActivity` via `am start`.",
          "Watches `.vsk`, project `.ts/.js/.mjs/.tsx/.jsx` modules (skipping node_modules/.vesk/.git), `veskconfig.*`, `libraries.json` with a 250ms debounce in a 500ms loop.",
          "On change: regenerates, reinstalls, relaunches. Target cycle: 5–15 seconds.",
          "Cell state is lost on each relaunch — effects and tracked values re-init.",
        ],
      },
      { kind: "h2", text: "Desktop preview (--desktop)" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `vesk-native dev --desktop`,
      },
      {
        kind: "list",
        items: [
          "Generates the project with `devDesktop: true`, then runs `:shared:hotRunJvm --auto` detached — a desktop window with Compose Hot Reload.",
          "Edits push in milliseconds and cells are preserved.",
          "JBR (JetBrains Runtime) 21 is auto-provisioned for the desktop target.",
          "On change the same watcher recompiles `:shared:compileKotlinJvm`.",
          "The desktop target is a preview convenience — the app ships as an Android APK.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "On some setups the desktop Compose Hot Reload orchestration-socket launch is blocked (see HMR-STATUS notes in the repo). The loop degrades to full-recompile reloads; the web preview is a reliable fallback for rapid iteration.",
      },
      { kind: "h2", text: "Web preview (--web)" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `vesk-native dev --web            # http://localhost:5173
vesk-native dev --web --port 8080`,
      },
      {
        kind: "list",
        items: [
          "Compiles `.vsk` with the web compiler (`@vesk/compiler`) and serves the result through the web adapter's client bundle pipeline on port 5173 by default.",
          "Per-file HMR over WebSocket — component edits hot-swap, no reload.",
          "`device.*` APIs map to real browser equivalents where possible through the `web-preview-shim`: Notification, file input, MediaRecorder, clipboard copy, vibrate, Web Share, speechSynthesis, geolocation, Battery Status, Network Information, OPFS, URL schemes.",
          "Unmapped device APIs warn instead of throwing — layout iteration never crashes the preview.",
          "The shim ships nowhere in a built app; it exists only in the dev toolchain.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "The web preview is for layout iteration and fast feedback, not a substitute for on-device testing — platform APIs degrade to nearest-browser equivalents and native look-and-feel differs.",
      },
      { kind: "h2", text: "Watcher rules" },
      {
        kind: "list",
        items: [
          "Watched extensions: `.vsk`, project `.ts`/`.js`/`.mjs`/`.tsx`/`.jsx` modules.",
          "Skipped directories: `node_modules`, `.vesk`, `.git`.",
          "Config changes (`veskconfig.*`, `libraries.json`) trigger a full regeneration.",
          "Edits are coalesced through a 250ms debounce.",
        ],
      },
    ],
  },
];