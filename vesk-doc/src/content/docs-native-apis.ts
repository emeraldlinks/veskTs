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
    slug: "native-apis",
    title: "Native Device APIs",
    description:
      "The device.* API surface, the three access patterns (state bindings, callbacks, markup elements), the permission mapping tables, and every tangible element tag.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "The native framework exposes Android device capabilities three ways — the page picks whichever fits the shape of its code: state bindings recompose automatically, callbacks hand results to vesk cells, and markup elements compile directly to native composables.",
      },
      { kind: "h2", text: "Access patterns" },
      {
        kind: "list",
        items: [
          "**A — state bindings**: `device.lastPhoto` reads drive recomposition. Use for values that change and should re-render automatically.",
          "**B — callbacks**: `device.pickImage((uri) => { ... })` hands results to a vesk cell. Use for one-shot actions.",
          "**C — markup elements**: `<camera video />`, `<battery-status />`, `<qr-scanner />`, `<contacts />` compile to native composables with the same runtime surface.",
        ],
      },
      { kind: "h2", text: "Script API reference" },
      {
        kind: "p",
        text: "All device APIs are available on the `device` object in `.vsk` scripts. The full method surface:",
      },
      {
        kind: "table",
        head: ["Group", "APIs"],
        rows: [
          ["Imaging", "pickImage, pickAudio, pickFile, capturePhoto, captureVideo, captureScreenshot, generateQrCode, scanQr, setWallpaper, toggleTorch"],
          ["Recorder", "startRecording, stopRecording, playSound"],
          ["Notification", "notify, toast, vibrate"],
          ["Power", "getBattery, setKeepAwake"],
          ["Network", "refreshNetwork, openUrl"],
          ["Location", "getLocation, openMaps"],
          ["Files", "listFiles, writeFile, readFile, deleteFile"],
          ["Apps", "listApps, openApp, openSettings"],
          ["Contacts & call", "listContacts, listCallLogs, dial, sendSms"],
          ["Messages & email", "listMessages, sendEmail"],
          ["Accounts", "listAccounts"],
          ["Clipboard", "readClipboard, copyToClipboard, shareText, shareFile"],
          ["Security", "checkBiometrics, authenticate"],
          ["Bluetooth", "refreshBluetooth, toggleBluetooth, scanBluetooth"],
          ["NFC", "refreshNfc"],
          ["Display", "setScreenBrightness, resetScreenBrightness, lockOrientation"],
          ["Volume & ringer", "refreshVolume, setVolume, setRingerMode"],
          ["Storage", "refreshStorage"],
          ["Sensors", "readSensor"],
          ["Media session", "startScreenRecord, stopScreenRecord"],
          ["Telephony", "refreshTelephony"],
          ["SIM", "refreshDeviceInfo"],
          ["Calendar", "listCalendarEvents, setAlarm"],
          ["Speech", "speak, openLink"],
        ],
      },
      { kind: "h2", text: "Permissions" },
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
          ["`setVolume` / `setRingerMode` / `<set-volume>`", "MODIFY_AUDIO_SETTINGS"],
          ["`setWallpaper` / `<wallpaper>`", "SET_WALLPAPER"],
          ["Bluetooth (refresh/toggle/scan)", "BLUETOOTH_CONNECT, BLUETOOTH_SCAN + legacy BLUETOOTH/BLUETOOTH_ADMIN (maxSdkVersion-scoped)"],
          ["`listCalendarEvents` / `<calendar>`", "READ_CALENDAR"],
          ["`checkBiometrics` / `authenticate` / `<biometric-auth>`", "USE_BIOMETRIC"],
          ["`startScreenRecord` / `<screen-record>`", "FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PROJECTION"],
          ["`fetch` / WebSocket / EventSource", "INTERNET"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "Legacy permissions that only exist for a bounded SDK range are maxSdkVersion-scoped: READ_EXTERNAL_STORAGE to SDK 32 and the Bluetooth pair (BLUETOOTH/BLUETOOTH_ADMIN) to SDK 30. FileProvider / queries / service declarations and bundled assets are added only when a page actually needs them.",
      },
      {
        kind: "note",
        tone: "info",
        text: "On iOS the same device-API usage drives Info.plist usage keys — NSCameraUsageDescription, NSMicrophoneUsageDescription, NSLocationWhenInUseUsageDescription, NSContactsUsageDescription, NSFaceIDUsageDescription, NSBluetoothAlwaysUsageDescription — never emitted 'just in case'.",
      },
      { kind: "h2", text: "Tangible elements" },
      {
        kind: "p",
        text: "The declarative device elements compile to the same runtime surface as the script `device.*` API. Each tag maps to a composable and feeds the manifest scan:",
      },
      {
        kind: "code",
        filename: "app/camera/page.vsk",
        language: "tsx",
        code: `export component Camera() {
  <camera video ondone={(uri) => { lastShot = uri }} />
  <battery-status />
  <qr-scanner onresult={(text) => { code = text }} />
  <contacts onresult={(list) => { people = list }} />
}`,
      },
      {
        kind: "p",
        text: "Available tags: `<photo-picker>`, `<camera>` (with `video` attribute), `<recorder>`, `<file-input>`, `<notification>`, `<battery-status>`, `<network-status>`, `<location>`, `<apps>`, `<contacts>`, `<call-log>`, `<messages>`, `<accounts>`, `<clipboard>`, `<copy-to-clipboard>`, `<vibrate>`, `<torch>`, `<screenshot>`, `<share-text>`, `<share-file>`, `<biometric-auth>`, `<bluetooth>`, `<bluetooth-toggle>`, `<bluetooth-scan>`, `<screen-record>`, `<qr-code>`, `<qr-scanner>`, `<volume>`, `<set-volume>`, `<brightness>`, `<keep-awake>`, `<orientation>`, `<device-info>`, `<storage-status>`, `<sensor>`, `<toast>`, `<sound>`, `<wallpaper>`, `<calendar>`, `<nfc>`, `<sim>`, `<dial>`, `<sms>`, `<email>`, `<open-link>`, `<map>`, `<alarm>`, `<open-settings>`, `<open-app>`, `<speak>`.",
      },
      {
        kind: "list",
        items: [
          "Attributes pass through as named composable args — `<alarm hour='8' minute='30' title='Wake up'>`.",
          "Missing args fall back to the composable's Kotlin defaults, so `<battery-status/>` alone works.",
          "Tags feed the same API_PERMISSIONS scan as `device.*` calls.",
        ],
      },
      { kind: "h2", text: "Media element tiers" },
      {
        kind: "p",
        text: "Media and device elements split into three tiers by permission requirements:",
      },
      {
        kind: "table",
        head: ["Tier", "Elements", "Permission"],
        rows: [
          ["No permission", "<photo-picker>, <audio-picker>, <file-input>, video/audio playback", "None"],
          ["Runtime grant", "<recorder>", "RECORD_AUDIO (runtime prompt)"],
          ["User consent", "<camera>, <screen-record>, <notification>", "CAMERA / MediaProjection / POST_NOTIFICATIONS — user grants explicitly"],
        ],
      },
      { kind: "h2", text: "Drag & drop" },
      {
        kind: "p",
        text: "Markup-level native drag & drop: a `draggable` element becomes a drag source (payload from its `dragdata` attribute or text content); an `ondrop={(text) => { ... }}` element is a drop target. Payloads also land in other apps (`DRAG_FLAG_GLOBAL`).",
      },
      {
        kind: "code",
        filename: "app/dnd/page.vsk",
        language: "tsx",
        code: `export component DragDrop() {
  <div class="grid grid-cols-2 gap-4 p-6">
    <div class="rounded-2xl bg-blue-100 p-6 text-center"
         draggable dragdata="/media/photo.jpg">
      Drag me
    </div>
    <div class="rounded-2xl border-2 border-dashed p-6 text-center"
         ondrop={(text) => { droppedText = text }}>
      Drop here
    </div>
  </div>
}`,
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
          "`collectBrowserApiUsage(appDir)` — finds `fetch`, `localStorage`/`sessionStorage`, `openSqlite`, auth (`signUp`/`signIn`/`signOut`/`currentUser`/`isSignedIn`), `WebSocket`, `EventSource` to decide their manifest needs.",
          "`collectRuntimeUsage(appDir)` — scans generated Kotlin to pick exactly the runtime helpers actually called (video/audio helpers only when a page uses `<video>`/`<audio>`, the device runtime only when a device API or element appears).",
        ],
      },
      { kind: "h2", text: "Runtime permission prompts" },
      {
        kind: "p",
        text: "Dangerous permissions are requested at the point of use through the Compose runtime. When a page triggers a device API that needs runtime consent (camera, microphone, location, contacts), the framework shows the Android system prompt and resumes the callback with the grant result.",
      },
      {
        kind: "code",
        filename: "app/media/page.vsk",
        language: "tsx",
        code: `export component MediaLab() {
  const &[photoUri] = track('')

  <div class="p-4">
    <button onClick={() => {
      device.capturePhoto((uri) => { photoUri = uri })
    }} class="bg-blue-600 text-white rounded-xl px-4 py-2">
      Take a photo
    </button>
    if (photoUri !== '') {
      <img src={photoUri} class="mt-4 rounded-2xl w-full" />
    }
  </div>
}`,
      },
      {
        kind: "note",
        tone: "warn",
        text: "`{#head}` blocks are not supported in native, and `{#server}` blocks compile to an explicit `error(...)` so nothing silently miscompiles. Web-only `on*` attributes not backed by a native runtime surface are rejected at compile time.",
      },
    ],
  },
];