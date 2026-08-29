# AGENTS.md — vesk-web (documentation site)

> This file extends `/root/vesk/AGENTS.md`. Read both at session start.
> **No hallucination or assumption** — every statement you write in docs or code must be verifiable in framework source. When confused **or even when sure**, re-read the source (`packages/types/src/index.ts`, `packages/runtime/src/resource.ts`, `packages/runtime/src/md.ts`, `packages/runtime/src/request.ts`, `packages/compiler/src/*`) before writing.

## Hard rules

1. **Tailwind-only styling.** Never use raw CSS, `<style>` blocks, inline `style="..."`, or CSS files to style anything **except when Tailwind does not cover it**. All visual styling in `vesk-web/app/**/*.vsk` must be **strictly Tailwind utility classes** (`class="..."`). The only allowed CSS is `src/global.css`:
   ```css
   @import 'tailwindcss';
   @layer base { html { scroll-behavior: smooth; } }
   ```
   If Tailwind cannot express a value (e.g. an arbitrary `bg=` color for `<Md>` code chrome), use a Tailwind arbitrary value (`bg-[#0d1117]`) — do not add a stylesheet. Document the exception in the PR description.

2. **Confirm from framework source — no hallucination.** Before documenting or implementing any API (`useFetch`, `Md`, `VeskRequest`, `VeskResponse`, `track`, etc.), open the canonical source and quote it:
   - Types: `packages/types/src/index.ts` (single source of truth — see its JSDoc)
   - Runtime: `packages/runtime/src/resource.ts` (`useFetch`/`streamText`/`resolveFetchUrl`), `packages/runtime/src/md.ts` (`MdProps`, `isPublicMarkdownPath`, `readServerMdPath`), `packages/runtime/src/request.ts` (`VeskRequest.resolveUrl`, `VeskResponse.stream`), `packages/runtime/src/ripple-runtime.ts` (`track`)
   - Compiler: `packages/compiler/src/types.ts` re-exports from `@vesk/types` — do not declare local shapes
   If the source does not say it, do not write it. Mark unverifiable items `[UNVERIFIED]`.

3. **TrackDecl `&` is auto-tracked.** `const &[x] = track(v)` / `let &[x] = track(v)` means `x` is auto-tracked — use `x` directly (`x`, `x = 1`, `x++`, `'/api/' + x`, `x === y`). **Never** `get(x)`/`set(x, v)` with `&`. Only plain `const x = track(v)` (no `&`) or the raw binding `const &[x, raw] = track(v)` → `raw: Tracked<T>` uses `get(raw)`/`set(raw, v)`/`peek(raw)`. Docs and examples must use `const &[…] = track(…)` for `.vsk`.

4. **Public markdown paths require extension.** `<Md>` public-file `content` must be absolute with `.md`/`.markdown` (`"/welcome.md"`, `"/game.md"`, `"/docs/guide.md"` under `public/`). `isPublicMarkdownPath` rejects `//`, `?`, `#`, `\` and requires leading `/` + suffix. Bare `"welcome"` or `"game.md"` renders as literal markdown, not a file. Document the `.md` explicitly.

5. **Docs are markdown files under `docs/` served by `app/api/docs/[...path]/route.ts`.** That route streams `docs/<rel>/doc.md` (or `<rel>.md`) in ~400-byte chunks via `ReadableStream` so `useFetch.stream()` demo re-renders progressively. Do not add new doc routes without a `doc.md`.

## Project layout

```
vesk-web/
  app/
    layout.vsk                 # root layout (nav + {props.children: Component})
    page.vsk                   # / — streamed docs demo (useFetch.stream + Md + public path)
    about/page.vsk, blog/, posts/, statements/
    api/docs/[...path]/route.ts # streams docs/*.md as text/markdown
    api/posts/route.ts, api/hello/route.ts, api/echo/[msg]/route.ts
    middleware.ts              # typed: (ctx: MiddlewareContext, next) => Promise<Response|void>
  docs/
    guide/** /doc.md           # 30+ guide pages (one doc.md per topic)
    welcome.md, notes.md       # public markdown examples
  public/
    welcome.md, notes.md, favicon.svg
  src/global.css               # ONLY allowed CSS (tailwind import)
  vesk.config.ts               # @vesk/plugin-tailwind entry: src/global.css
```

## Docs site — how to build

```bash
cd /root/vesk/vesk-web
npm install
npm run dev      # http://localhost:3000 — HMR, Tailwind via @vesk/plugin-tailwind
npm run build    # production build into dist/
npm run typecheck # tsc --noEmit — must pass (layout uses Component, middleware uses MiddlewareContext)
```

- **Adding a guide page:** create `docs/guide/<topic>/doc.md` (with `# Title`), add an entry to `app/lib/guide.ts` if the guide index lists it, and verify the API streams it: `curl http://localhost:3000/api/docs/<topic> | head`.
- **Editing a doc:** edit the `doc.md` directly; confirm every API signature against `packages/types/src/index.ts` JSDoc before writing (e.g. `UseFetchStreamOptions` has `into?: Tracked<string>` + `onChunk?: (chunk,total)=>void`, not `onProgress`).
- **Styling a doc page:** use Tailwind on the wrapper `.vsk` that renders `<Md>` — never add CSS for the markdown itself; `<Md>` injects `MD_BASE_CSS` via `css` prop.

## Verification

```bash
# from repo root after any doc/code change
npx tsx packages/cli/src/build-packages.ts
npm run typecheck --prefix vesk-web   # must pass
# optionally: curl http://localhost:3000/api/docs/guide/data-fetching | head
```

Every doc change must be readable via the streaming API and render correctly in `<Md content={doc} css />` without custom CSS.
