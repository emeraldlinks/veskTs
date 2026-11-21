export type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: {
  slug: string;
  title: string;
  description: string;
  group: string;
  blocks: Block[];
}[] = [
  {
    slug: "vesk-docs",
    title: "@vesk/docs",
    description:
      "Generate OpenAPI 3.1 specs, local Swagger UI, and terminal inspection from app/api/** routes with @vesk/docs and vesk inspect.",
    group: "Tooling",
    blocks: [
      {
        kind: "p",
        text: "@vesk/docs is Vesk's Intelligence Compiler. It reads app/api/** route modules and middleware with the TypeScript compiler API, builds a semantic project IR, and turns it into OpenAPI 3.1 JSON/YAML, a local Swagger UI, and `vesk inspect` output. Page routes are never included.",
      },
      {
        kind: "note",
        tone: "info",
        text: "You do not import @vesk/docs inside a route. The CLI, dev server, and production adapter load it when docs or inspection are enabled.",
      },
      { kind: "h2", text: "What it generates" },
      {
        kind: "table",
        head: ["Artifact", "Default location", "Purpose"],
        rows: [
          ["Project IR", ".vesk/intelligence/project.json", "Routes, operations, schemas, middleware, dependencies, diagnostics, and provenance."],
          ["OpenAPI JSON", "/openapi.json", "Machine-readable OpenAPI 3.1 document generated from API routes."],
          ["OpenAPI YAML", "/openapi.yaml", "The same document in YAML form."],
          ["Swagger UI", "/docs", "Local interactive documentation with Try it out and Authorize support."],
          ["Swagger assets", "/docs/swagger-ui/*", "Bundled swagger-ui-dist assets served locally; no runtime CDN."],
          ["Inspection", "vesk inspect", "Terminal views for routes, operations, schemas, diagnostics, and dependencies."],
        ],
      },
      { kind: "h2", text: "Install and enable" },
      {
        kind: "p",
        text: "New apps created with `npx create-vesk@latest` already install @vesk/docs and generate a docs config with dev/prod UI enabled. For an existing app, add the package and configure it in `vesk.config.ts`.",
      },
      {
        kind: "code",
        filename: "terminal",
        language: "bash",
        code: `npm install @vesk/docs@^0.3.0`,
      },
      {
        kind: "code",
        filename: "vesk.config.ts",
        code: `import { defineConfig } from '@vesk/compiler'

export default defineConfig({
  intelligence: {
    enabled: true,
    cacheDir: '.vesk/intelligence',
    exclude: ['**/*.test.ts'],
  },
  docs: {
    dev: true,
    prod: true,
    path: '/docs',
    playground: true,
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`docs.dev` defaults to true; `docs.prod` must be explicitly true for production Swagger UI.",
          "`docs.path` defaults to `/docs`. It must be an absolute static path: no query, hash, brackets, wildcards, backslashes, spaces, or trailing slash.",
          "`docs.playground` enables Swagger UI's Try it out controls and defaults to true.",
          "`security`, `securitySchemes`, and `auth` configure authorization documentation; see Authentication below.",
          "`openapi: false` suppresses both OpenAPI files. `docs: false`, `docs.enabled: false`, or `intelligence.enabled: false` disables all docs/OpenAPI output.",
        ],
      },
      {
        kind: "code",
        filename: "vesk.config.ts",
        code: `import { defineConfig } from '@vesk/compiler'

export default defineConfig({
  docs: {
    path: '/api-docs',
    dev: true,
    prod: true,
    openapi: {
      jsonPath: '/spec/openapi.json',
      yamlPath: '/spec/openapi.yaml',
    },
  },
})`,
      },
      {
        kind: "note",
        tone: "warn",
        text: "App routes and public files always win. If your app has a page at the docs path, the generated Swagger UI is skipped. If the /docs/swagger-ui assets or the OpenAPI paths collide with app/public files, those generated artifacts are skipped too. Use a different docs.path instead of fighting the collision.",
      },
      {
        kind: "p",
        text: "When a docs UI is active, `vesk dev` and `vesk start` print `api docs live at <url>` using `docs.path` or `/docs`. If your own route wins the path, no docs URL is printed.",
      },
      { kind: "h2", text: "Documenting API routes" },
      {
        kind: "p",
        text: "Export HTTP method handlers from `app/api/**/route.ts`. The analyzer uses route folders for paths, exported function names for operations, TypeScript types for schemas, and JSDoc tags for explicit metadata. No decorator, wrapper, or @vesk/docs import is required.",
      },
      {
        kind: "code",
        filename: "app/api/users/[id]/route.ts",
        code: `import { VeskRequest, VeskResponse } from '@vesk/runtime/server'

type User = {
  id: string
  name: string
  email?: string
}

type UpdateUser = {
  name: string
  email?: string
}

/**
 * @summary Update a user
 * @description Updates one user by id.
 * @security bearerAuth
 */
export async function PATCH(req: VeskRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const input = await req.json<UpdateUser>()
  const user: User = { id, ...input }
  return VeskResponse.json<User>(user).setStatus(200)
}

/** @public */
export async function GET() {
  const users: User[] = [{ id: '1', name: 'Ada' }]
  return VeskResponse.json<User[]>(users)
}`,
      },
      {
        kind: "table",
        head: ["Annotation", "Effect"],
        rows: [
          ["@summary <text>", "Sets the operation summary shown in Swagger UI."],
          ["@description <text>", "Sets the operation description."],
          ["@security <scheme>", "Marks the handler as protected by a named scheme such as bearerAuth, apiKey, or sessionCookie."],
          ["@security none", "Explicitly marks the handler public."],
          ["@public", "Short form for a public operation; emits `security: []`."],
          ["@status <code>", "Overrides the documented success status, for example `@status 202`."],
          ["@middleware <text>", "Records middleware context used by the analyzer."],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "Put JSDoc directly above the exported handler. A plain cookie or header read does not by itself mark a route protected; auth is inferred only from explicit security tags, authenticated/guarded user locals, and middleware scoped to that route.",
      },
      { kind: "h2", text: "Schemas, parameters, and statuses" },
      {
        kind: "list",
        items: [
          "`await req.json<T>()` produces the JSON request body schema. If the type cannot be resolved, the IR records a diagnostic telling you to add the type argument.",
          "`VeskResponse.json<T>(value)` produces typed response schemas. Local interfaces, aliases, and inferred object shapes become reusable `components.schemas` entries.",
          "`[id]` folders become path parameters; `[...path]` folders become catch-all parameters. `req.query.foo`, `req.headers.get(...)`, and cookie access are analyzed as request parameters.",
          "Statuses are inferred from explicit `VeskResponse` status arguments, `.setStatus()`, `.status()`, JSDoc `@status`, `notFound()` → 404, `permanentRedirect()` → 308, `Response.redirect` → 302, and `VeskResponse.redirect` → 307. Ordinary successful returns default to 200.",
        ],
      },
      {
        kind: "code",
        filename: "app/api/jobs/route.ts",
        code: `import { VeskResponse, notFound } from '@vesk/runtime/server'

type Job = {
  id: string
  name: string
}

/** @status 202 */
export async function POST(req: Request) {
  const input = await req.json<{ name: string }>()
  const job: Job = { id: 'job_1', name: input.name }
  return VeskResponse.json<Job>(job)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get('missing') === '1') notFound()
  const jobs: Job[] = []
  return VeskResponse.json<Job[]>(jobs)
}`,
      },
      { kind: "h2", text: "Authentication" },
      {
        kind: "p",
        text: "Docs security is declarative and never contains token values. Built-in schemes cover the common cases; custom schemes can be declared under `docs.securitySchemes`. Protected operations automatically gain 401 and 403 responses, public operations emit `security: []`, and Swagger UI shows an Authorize button for declared schemes.",
      },
      {
        kind: "table",
        head: ["Source", "Documented result"],
        rows: [
          ["Authorization header access", "bearerAuth: HTTP bearer scheme."],
          ["X-API-Key header access", "apiKey: API key in a request header."],
          ["Authenticated or guarded user locals", "sessionCookie: API key in the session cookie."],
          ["Scoped middleware protection", "Propagates security to every operation in the middleware path scope."],
          ["@security / @public annotations", "Explicit per-handler override of inferred security."],
        ],
      },
      {
        kind: "code",
        filename: "vesk.config.ts",
        code: `import { defineConfig } from '@vesk/compiler'

export default defineConfig({
  docs: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'session' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    security: [{ sessionCookie: [] }],
    auth: {
      credentials: 'omit',
      persistAuthorization: false,
      defaultScheme: 'bearerAuth',
      loginPath: '/api/login',
      session: {
        source: 'localStorage',
        key: 'accessToken',
        scheme: 'bearerAuth',
      },
    },
  },
})`,
      },
      {
        kind: "p",
        text: "`docs.auth.session` preauthorizes Swagger UI from a browser session. Supported sources are `cookie`, `localStorage`, and `sessionStorage`. The browser reads the token at request time; no token value is written into generated HTML, OpenAPI, or build output.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "JWT bearer token",
            filename: "vesk.config.ts",
            code: `import { defineConfig } from '@vesk/compiler'

export default defineConfig({
  docs: {
    auth: {
      session: {
        source: 'localStorage',
        key: 'accessToken',
        scheme: 'bearerAuth',
      },
    },
  },
})`,
          },
          {
            label: "Session cookie",
            filename: "vesk.config.ts",
            code: `import { defineConfig } from '@vesk/compiler'

export default defineConfig({
  docs: {
    auth: {
      session: {
        source: 'cookie',
        key: 'session',
        scheme: 'sessionCookie',
      },
    },
  },
})`,
          },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "docs.auth.credentials accepts only `omit`, `same-origin`, and `include`. Use browser-readable session storage only for tokens that are safe for client JavaScript to access; HttpOnly cookies stay server-controlled and are sent by the browser without exposing their value.",
      },
      { kind: "h2", text: "vesk inspect" },
      {
        kind: "p",
        text: "`vesk inspect` runs the same analysis in the terminal. It is useful in CI, code review, and when debugging why an operation or schema is missing from Swagger UI.",
      },
      {
        kind: "code",
        filename: "terminal",
        language: "bash",
        code: `vesk inspect
vesk inspect routes
vesk inspect route /api/users
vesk inspect operations
vesk inspect schemas
vesk inspect schema User
vesk inspect diagnostics
vesk inspect dependencies
vesk inspect posts --json`,
      },
      {
        kind: "table",
        head: ["Query", "View"],
        rows: [
          ["no query", "Project summary: routes, operations, schemas, diagnostics, and source hash."],
          ["routes / api", "All documented API routes."],
          ["route <text>", "First route matching the path or handler text."],
          ["operations / methods", "Flat list of operation methods and IDs."],
          ["schemas / types", "All generated schemas."],
          ["schema <text>", "First schema matching a name or ID."],
          ["diagnostics / warnings", "Analyzer diagnostics and unresolved types."],
          ["dependencies / imports", "Project dependency records."],
          ["free text", "Routes and schemas whose text contains the query."],
          ["--json", "Machine-readable output for scripts and CI."],
        ],
      },
      { kind: "h2", text: "Build output and cache" },
      {
        kind: "table",
        head: ["Setting", "Default", "Behavior"],
        rows: [
          ["intelligence.enabled", "true", "Turns analysis on; false disables docs, OpenAPI, and inspection inputs."],
          ["intelligence.cacheDir", ".vesk/intelligence", "Cache directory for incremental analysis."],
          ["intelligence.exclude", "[]", "Source globs excluded from analysis."],
          ["docs.enabled", "true", "Master switch for docs config."],
          ["docs.dev", "true", "Serves Swagger UI in development."],
          ["docs.prod", "false", "Serves Swagger UI from a production build when true."],
          ["docs.openapi", "enabled", "Set to false to suppress both OpenAPI JSON and YAML."],
          ["docs.openapi.jsonPath", "/openapi.json", "Absolute static path ending in .json."],
          ["docs.openapi.yamlPath", "/openapi.yaml", "Absolute static path ending in .yaml."],
        ],
      },
      {
        kind: "list",
        items: [
          "Build writes the project IR under `.vesk/intelligence/` and generated static docs under `.vesk/static/public/`.",
          "The analyzer caches results by source hash. `disableCache` is available on the public `analyzeProject()` API when you need a cold analysis.",
          "Changing route types, JSDoc annotations, or config changes the generated artifact hash and refreshes the docs output.",
        ],
      },
      { kind: "h2", text: "Programmatic API" },
      {
        kind: "p",
        text: "@vesk/docs also exposes its analysis and generation primitives for tooling. The most useful exports are `analyzeProject`, `analyzeApiRoute`, `generateOpenApiJson`, `generateOpenApiYaml`, `generateDocsHtml`, `inspect`, `formatInspection`, `buildIntelligenceArtifacts`, `writeIntelligenceArtifacts`, `intelligenceRoutePaths`, and `formatDocsUrl`.",
      },
      {
        kind: "code",
        filename: "scripts/generate-openapi.ts",
        code: `import { analyzeProject, generateOpenApiJson } from '@vesk/docs'

const intelligence = analyzeProject({
  projectRoot: process.cwd(),
  appDir: 'app',
})

const spec = generateOpenApiJson(intelligence, {
  title: 'My API',
  version: '1.0.0',
})

console.log(spec)`,
      },
      { kind: "h2", text: "Checklist" },
      {
        kind: "list",
        items: [
          "Keep API handlers in `app/api/**/route.ts` and export the HTTP methods you want documented.",
          "Add `req.json<T>()` and `VeskResponse.json<T>()` type arguments where you want request/response schemas.",
          "Use `@summary`, `@description`, `@security`, `@public`, and `@status` for intent the AST cannot infer.",
          "Choose a static `docs.path` that does not collide with an app route or public file.",
          "Enable `docs.prod` if production visitors should see Swagger UI.",
          "Run `vesk inspect diagnostics` when an operation or schema is missing.",
        ],
      },
    ],
  },
];
