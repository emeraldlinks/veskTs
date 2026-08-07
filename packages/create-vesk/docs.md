# create-vesk — Documentation

> Zero-dependency scaffolding CLI. `npx create-vesk@latest <project-name>` creates a new Vesk
> project with all required config, demo pages, API routes, and a Tailwind entrypoint.

- **Language:** JavaScript (ESM, no TS/transpile step)
- **Dependencies:** none
- **Binary:** `create-vesk` → `src/index.js`

## What it creates

```
<project-name>/
  package.json          # scripts: dev/build/start/typecheck
  vesk.config.ts        # defineConfig + tailwind plugin + security preset
  tsconfig.json         # strict TS, jsxImportSource '@vesk/compiler', path aliases
  src/global.css        # @import 'tailwindcss' + base layer
  .env.example          # env var examples
  .gitignore            # node_modules, dist, .vesk, .env
  README.md             # getting started + project structure
  public/
    favicon.svg         # inline SVG favicon
  app/
    layout.vsk          # root layout with NavLink
    page.vsk            # / — tracked counter demo
    about/page.vsk      # /about
    blog/page.vsk       # /blog
    blog/[slug]/page.vsk # /blog/:slug dynamic
    posts/page.vsk      # /posts — useFetch
    statements/page.vsk # /statements — every JS construct
    not-found.vsk       # custom 404
    error.vsk           # custom error boundary
    middleware.ts       # onion-model middleware
    api/posts/route.ts  # /api/posts
    api/hello/route.ts  # /api/hello
    api/echo/[msg]/route.ts # /api/echo/:msg dynamic
```

## Usage

```bash
npx create-vesk@latest my-app
cd my-app
npm install
npm run dev
```

## Common mistakes + fixes

| Mistake | Fix |
|---|---|
| Directory already exists | The CLI exits with `Error: directory "X" already exists`. Remove or rename the existing directory. |
| Forgetting `npm install` | The scaffold does not run `npm install` automatically. |
| Port 3000 already in use | `vesk dev` defaults to `-p 3000`; pass `-p 3001` etc. |

## Testing

No unit tests. The scaffold is exercised indirectly by the E2E setup (`scripts/e2e-setup.js`) which uses `test-app/` (not create-vesk output, but a hand-curated fixture).
