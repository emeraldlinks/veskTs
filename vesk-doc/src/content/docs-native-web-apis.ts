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
    slug: "native-web-apis",
    title: "Native Web API Mappings",
    description:
      "How browser and web-platform APIs compile to native Kotlin: fetch, WebSocket, EventSource, storage, sqlite, auth, JS semantics, and the platform seam.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "Vesk Native maps the browser/web-platform APIs you write in `.vsk` onto real Android/Kotlin equivalents — never a JS shim in a built app. `fetch` → OkHttp/HttpURLConnection, `localStorage` → SharedPreferences/DataStore, timers → coroutines, and so on.",
      },
      { kind: "h2", text: "Network" },
      {
        kind: "table",
        head: ["API", "Kotlin mapping", "Manifest"],
        rows: [
          ["fetch(url, opts)", "OkHttp client with the same promise semantics", "INTERNET (when used)"],
          ["new WebSocket(url)", "OkHttp WebSocket client", "INTERNET (when used)"],
          ["new EventSource(url)", "OkHttp SSE streaming client", "INTERNET (when used)"],
        ],
      },
      {
        kind: "code",
        filename: "app/labs/web/page.vsk",
        language: "tsx",
        code: `export component WebLab() {
  const &[quote] = track('')
  const &[messages] = track<string[]>([])

  <button
    class="bg-blue-600 text-white rounded-xl px-4 py-2"
    onClick={() => {
      fetch('/api/quote').then((res) => res.json()).then((data) => { quote = data.text })
    }}
  >
    Fetch a quote
  </button>

  <p>{quote}</p>
}`,
      },
      { kind: "h2", text: "Storage" },
      {
        kind: "table",
        head: ["API", "Kotlin mapping", "Notes"],
        rows: [
          ["localStorage.getItem/setItem/removeItem", "SharedPreferences / DataStore", "Persists across app launches"],
          ["sessionStorage", "In-memory session store", "Cleared on process death"],
          ["navigator.storage / OPFS-style files", "App-internal files", "Same app-file permission model as writeFile/readFile"],
        ],
      },
      {
        kind: "code",
        filename: "app/labs/storage/page.vsk",
        language: "tsx",
        code: `export component StorageLab() {
  const &[note] = track(localStorage.getItem('note') ?? '')

  <input
    value={note}
    onChange={(e) => {
      note = e.target.value
      localStorage.setItem('note', note)
    }}
    class="border rounded-xl px-3 py-2"
    placeholder="Type something..."
  />
}`,
      },
      { kind: "h2", text: "SQLite" },
      {
        kind: "p",
        text: "`openDatabase(name)` — the web-style SQLite API — maps to the Android SQLite engine. `bindArgs`/row access goes through the JS-semantics runtime so the exact coercion behavior matches the browser:",
      },
      {
        kind: "code",
        filename: "app/labs/sqlite/page.vsk",
        language: "tsx",
        code: `export component SqliteLab() {
  const db = openDatabase('store.db')

  db.run(\`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)\`)
  db.run(\`INSERT INTO items (name) VALUES (?)\`, ['hello'])

  const rows = db.all(\`SELECT * FROM items\`)
  <ul>
    for (const row of rows; key row.id) {
      <li>{row.name}</li>
    }
  </ul>
}`,
      },
      { kind: "h2", text: "Auth" },
      {
        kind: "p",
        text: "The `@vesk/browser` auth surface (`signUp`, `signIn`, `signOut`, `currentUser`, `isSignedIn`) maps to the `VeskAuth` runtime helper — an interface you wire to your identity provider. Using it pulls the auth helper into the app's runtime; the exact provider is yours to implement.",
      },
      { kind: "h2", text: "JS semantics runtime" },
      {
        kind: "p",
        text: "Where native Kotlin types can't express JavaScript behavior exactly, the compiler emits the JS-semantics helpers — `jsString`, `jsSafe`, `jsTypeof`, `jsGlobalIsNaN`, `jsParseInt`, `jsRegexExec`, `jsStringify`, `jsParseJson`, `jsMapOf`, `jsIndex`, `jsLength`, `jsForEach` — so coercion, truthiness, equality, and property lookup behave exactly like the browser engine. These are pruned to the ones the app actually uses.",
      },
      { kind: "h2", text: "Timers & console" },
      {
        kind: "table",
        head: ["API", "Kotlin mapping", "Notes"],
        rows: [
          ["setTimeout / setInterval / clearTimeout / clearInterval", "JVM / Android coroutine timers (VeskTimers)", "Same callback semantics"],
          ["console.log / warn / error / info / count / time / ...", "Android logcat (JsConsole)", "Structured per-level logging"],
          ["alert(message)", "Android dialog (jsAlert)", "Blocking dialog"],
        ],
      },
      { kind: "h2", text: "Platform seam" },
      {
        kind: "p",
        text: "`veskPlatformSeams` is the runtime's platform boundary — where web-API calls route to Android services (activity, compose view tree, system services, shared preferences, OkHttp, coroutines) versus JVM/desktop equivalents. Platform `expect`/`actual` pairs live in the shared KMP module; the web preview uses `web-preview-shim.ts` only in dev, never in a built app.",
      },
      {
        kind: "note",
        tone: "warn",
        text: "Every accepted construct must produce the exact result the browser engine would. Constructs the compiler cannot translate yet are hard build errors (`TODO(...)` fails the build) — never a silent miscompile or a runtime JS fallback.",
      },
      { kind: "h2", text: "Usage-driven shipping" },
      {
        kind: "list",
        items: [
          "`collectBrowserApiUsage(appDir)` detects `fetch`, `localStorage`/`sessionStorage`, `openSqlite`, auth, `WebSocket`, `EventSource` and wires the right runtime helpers + INTERNET permission.",
          "`collectRuntimeUsage(appDir)` picks exactly the helpers actually called — a page with no timers ships no timer runtime.",
          "Runtime helpers are dependency-ordered (`RUNTIME_ORDER`) so pruned output stays acyclic.",
        ],
      },
    ],
  },
];