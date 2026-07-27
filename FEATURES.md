# Vesk Framework — Complete Feature Inventory

> Comparison with React, Qwik, and Astro.
> Priority: ★★★ High / ★★ Medium / ★ Low

---

## 1. Language & Compiler

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | File extension | `.vsk` — extended TSX | `.tsx` / `.jsx` | `.tsx` / `.jsx` | `.astro` |
| ★★★ | Parser | Acorn + TypeScript plugin + VeskPlugin (JSX, `component`, `&[]`) | Babel/SWC (JSX) | TypeScript SWC | remark (markdown) + Acorn |
| ★★★ | TypeScript | Full TS via `@sveltejs/acorn-typescript` | Full TS via SWC | Full TS | Full TS |
| ★★★ | JSX in statement position | Native — `<div>` as statement | Requires `()` wrapper | Requires `()` wrapper | N/A (HTML template) |
| ★★★ | Component keyword | `component Name { }` — explicit | `function Name() { }` | `component$` | `---` frontmatter + template |
| ★★★ | Inline styles | `<style>` per-component, scoped | CSS Modules / styled-jsx | Scoped `<style>` | `<style>` per-component |
| ★★ | Node transform | Dev-mode Node transformation for tracked assignments (`count++` → `count.set(...)`) | Babel SWC transforms | — | — |
| ★★ | Custom directives | `on:click`, `bind:value` | `onClick`, `value` + `onChange` | `onClick$` | `client:load`, `client:idle` |
| ★★ | Dynamic bindings | `{expr}`, `class:name={bool}` | `{expr}`, `className` | `{expr}` | `{expr}` |
| ★ | Server/client blocks | `{#server}` / `{#client}` | `"use server"` / `"use client"` | `use server` / `use client` | `---` frontmatter |
| ★ | IR node types | 19 typed classes (Static, Text, DynamicBinding, MapRegion, ForLoop, TryCatch, etc.) | JSON-serializable AST | Intermediate representation | HTML-based AST |

---

## 2. Reactivity

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | Signal primitive | `track()` — creates reactive cell | `useState()` (hook) | `useSignal()` | N/A (no client reactivity) |
| ★★★ | Derived values | `derived()` — auto-tracks deps | `useMemo()` | `useComputed$()` | N/A |
| ★★★ | Effects | `effect()` — runs on dep change | `useEffect()` | `useTask$()` / `useVisibleTask$()` | N/A |
| ★★★ | Dirty checking | Clock-based versioning (increment on set) | Virtual DOM diff | Fine-grained via `useSignal` | N/A |
| ★★★ | Batch updates | Microtask queue, single flush | React batching | Automatic batching | N/A |
| ★★ | Untrack/peek | `untrack(fn)` / `peek(signal)` — read without dep | N/A | `untrack(fn)` | N/A |
| ★ | Pre-effects | `pre_effect()` — runs before render | `useLayoutEffect()` | — | N/A |
| ★ | Block tree lifecycle | destroy, pause, resume, teardown | Component unmount | `onDestroy$()` | N/A |

---

## 3. Routing

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | File-based routing | `app/page.vsk` → `/` | `app/page.jsx` → `/` | `src/routes/` | `src/pages/` |
| ★★★ | Dynamic segments | `app/[slug]/page.vsk` → `/:slug` | `app/[slug]/page.jsx` | `[slug]/` | `[slug].astro` |
| ★★★ | Catch-all | `app/[...path]/page.vsk` | `app/[...slug]/page.jsx` | `[...slug]/` | `[...slug].astro` |
| ★★★ | Layout nesting | `layout.vsk` per directory | `layout.jsx` per directory | `layout.tsx` per directory | `layout.astro` per directory |
| ★★★ | Route groups | `(group)/page.vsk` | `(group)/page.jsx` | — | — |
| ★★★ | 404 pages | `not-found.vsk` | `not-found.jsx` | — | `404.astro` |
| ★★★ | Loading states | `loading.vsk` | `loading.jsx` | — | — |
| ★★ | Error boundaries | `error.vsk` (catch render errors) | `error.jsx` | — | — |
| ★★ | Middleware | `middleware.ts` (onion model) | `middleware.ts` | — | — |
| ★★ | API routes | `app/api/route.ts` | `app/api/route.ts` | `src/routes/` + `endpoint$` | `src/pages/api/` |
| ★★ | Private directories | `_private/` ignored | N/A (convention?) | N/A | N/A |
| ★★ | Route manifest | Auto-generated from scan | Config-based | — | — |
| ★ | Parallel routes | — | `@modal/page.jsx` | — | — |
| ★ | Intercepting routes | — | `(.)/page.jsx` | — | — |

---

## 4. Server-Side Rendering

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | SSR HTML output | `render()` produces full HTML string | `renderToString()` | SSR by default | SSR by default |
| ★★★ | Streaming | `renderPageStream()` — AsyncGenerator | Streaming via Suspense | Streaming | Streaming |
| ★★★ | Hydration | Full page hydration | Full page hydration | Resumable (lazy) | Partial (islands) |
| ★★★ | Full page wrapper | `renderFullPage()` — HTML shell + head | Built-in layout | — | Built-in layout |
| ★★★ | Selective hydration | — | Partial hydration via Server Components | Resumable — no hydration needed | Islands architecture |
| ★★ | SSR data passing | `globalThis.__vesk_ssr_data` serialization | Server Components + serialized props | Serialized state | `Astro.props` |
| ★★ | Resource resolution | `resolveSsrResources()` awaits all SSR promises before sending | React Query / SWR | `useResource$()` | `Astro.fetch()` |
| ★ | Suspense | IR-level pending (load function) | `<Suspense>` | `<Suspense>` | N/A |

---

## 5. Client-Side Runtime

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | Client bundle size | ~30KB (min) | ~400KB (React) | ~10KB (min, lazy-loaded) | ~0KB (zero JS by default) |
| ★★★ | Hydration walker | Tree structure walker per component | React reconciler | Resumable — no walk needed | Per-island mount |
| ★★★ | Component registry | Single `__components` registry | React internal tree | Lazy module registry | Per-page module scope |
| ★★★ | Fragment-based DOM insertion | `DocumentFragment` batched writes | Virtual DOM diff | Direct DOM writes | Static HTML |
| ★★ | Lazy hydration | `hydrateViewport()`, `hydrateIdle()`, `hydrateOnInteraction()` | — | Resumable by default | `client:load`, `client:idle`, `client:visible` |
| ★ | HMR | WebSocket + surgical page updates + component hot-patching | React Fast Refresh | Custom HMR | HMR |

---

## 6. Forms & Validation

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★ | Form component | `<Form>` with SSR data attributes, client validation | Server Actions | `<Form>` + `action$` | — |
| ★★ | Field component | `<Field>` with label, error display | — | — | — |
| ★★ | Validators | `required`, `email`, `minLength`, `maxLength`, `pattern`, `custom` | Zod / client libraries | Zod / client libraries | — |
| ★ | Server Action helpers | — | Built-in Server Actions | — | — |

---

## 7. Two-Way Bindings

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | `bind:value` | `<input bind:value={x}>` | Controlled components (`value` + `onChange`) | `bind:value` | N/A |
| ★★ | `bind:checked` | `<input type="checkbox" bind:checked={x}>` | `checked` + `onChange` | `bind:checked` | N/A |
| ★★ | `bind:group` | `<input type="radio" bind:group={x}>` | Controlled per-input | `bind:group` | N/A |

---

## 8. Data Fetching & ISR

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | `useFetch()` | SSR-aware, auto-imported | `fetch()` in Server Components / `use()` | `useResource$()` | `Astro.fetch()` |
| ★★★ | `createResource()` | Reactive resource with data/loading/error/refresh | React Query / SWR | `useResource$()` | — |
| ★★ | ISR | Stale-while-revalidate in-memory cache | `revalidate` config option | Custom | — |
| ★★ | Path revalidation | `revalidatePath()` | `revalidatePath()` | Custom | — |
| ★★ | Tag revalidation | `revalidateTag()` | `revalidateTag()` | Custom | — |
| ★ | Component-level ISR | `componentIsr()` — per-component revalidation | — | — | — |
| ★ | Page-level ISR | `pageIsr()` — per-page config | `export const revalidate` | — | — |

---

## 9. Image Optimization

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★ | Image component | `<Image>` with lazy loading, width/height | `next/image` | `<Image>` | `<Image />` |
| ★ | Sharp pipeline | Optional sharp integration, multi-width, WebP/AVIF | Built-in image optimization | — | `@astrojs/image` |
| ★ | Placeholder | Background color placeholder | Blur data URL | — | Placeholder |
| ★ | Priority loading | `priority` prop | `priority` prop | — | `loading` attribute |

---

## 10. SEO

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★ | JSON-LD | `<JsonLd>` component | `next/script` type="application/ld+json" | — | Component-based |
| ★★ | Schema helpers | Article, Product, FAQ, Breadcrumb, Organization, LocalBusiness, Video | — | — | — |
| ★ | SEO audit | 12 checks: h1, meta description, title, OG tags, canonical, robots, structured data, lang, viewport, headings, alt text, performance | Lighthouse | — | — |

---

## 11. A/B Testing

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★ | Experiment component | `<Experiment>` with hash-based variant selection, sticky variants, analytics callback | Third-party libraries | Third-party libraries | Third-party libraries |

---

## 12. Portal

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★ | `<Portal>` | Teleport to DOM target, SSR as empty string | `createPortal()` | `<Portal>` | — |

---

## 13. Static Site Generation

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | SSG | `ssg()` function, `getStaticPaths` | `generateStaticParams` | — | Default output mode |
| ★★★ | Static prerendering | Pre-renders routes to HTML during build | Static export | — | Default |
| ★★ | SSG with ISR | Combined static + stale-while-revalidate | `revalidate` on static | — | — |

---

## 14. Dev Tools

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | Dev server | `vesk dev` — HTTP + HMR | `next dev` — Turbopack | `npm run dev` | `astro dev` |
| ★★★ | Build | `vesk build` — routes, SSR, API, client, runtime, manifest | `next build` — full build | `npm run build` | `astro build` |
| ★★★ | Init | `vesk init` — scaffolding with tailwind, example routes | `create-next-app` | `npm create qwik` | `create astro` |
| ★★ | HMR | WebSocket + surgical page updates + component hot-patching | React Fast Refresh (full refresh) | Hot Module Replacement | HMR |
| ★★ | HMR indicator | Visual floating dot (green/yellow/red/gray) | Console logs | — | — |
| ★ | SEO audit | `vesk seo` — 12-point checklist | Lighthouse / `next/seo` | — | — |

---

## 15. Language Server Protocol

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | Syntax errors | Parse error diagnostics | TypeScript (ts-server) | TypeScript | TypeScript |
| ★★★ | Completions | Components, routes, props, imports, Tailwind classes | TypeScript | TypeScript | TypeScript |
| ★★★ | Hover info | Type info, documentation | TypeScript | TypeScript | TypeScript |
| ★★★ | Go-to-definition | Components, exports, declarations | TypeScript | TypeScript | TypeScript |
| ★★★ | Find references | Cross-file symbol search | TypeScript | TypeScript | TypeScript |
| ★★★ | Document symbols | Outline: components, exports, declarations | TypeScript | TypeScript | TypeScript |
| ★★★ | Workspace symbols | Cross-file symbol search | TypeScript | TypeScript | TypeScript |
| ★★★ | Semantic tokens | Full (8 types, 4 modifiers) | — | — | — |
| ★★★ | Diagnostics | Route conflicts, missing pages, unused exports, naming conventions | TypeScript | TypeScript | TypeScript |
| ★★ | Formatting | Indentation fix, basic formatting | Prettier / ESLint | Prettier | Prettier |
| ★★ | Code actions | Organize imports, fix export | TypeScript refactorings | — | — |
| ★★ | Rename | Cross-file rename | TypeScript | TypeScript | TypeScript |
| ★★ | Color provider | CSS color picker | — | — | — |
| ★ | Folding ranges | Components, blocks, imports | Built-in | Built-in | Built-in |
| ★ | Signature help | Component/function parameter hints | TypeScript | TypeScript | TypeScript |
| ★ | Document links | Clickable import paths | — | — | — |

---

## 16. Editor Extensions

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | VS Code | Full extension with LSP | TypeScript + React extensions | Qwik VS Code | Astro VS Code |
| ★★★ | Neovim | Full plugin: syntax, LSP, ftplugin, keymaps | `typescript-tools.nvim` | Qwik plugin | Astro plugin |
| ★★★ | Syntax highlighting | TextMate grammar (VS Code) + Vim syntax (Neovim) | TypeScript grammar | TypeScript grammar | Astro grammar |
| ★★ | LSP server | Standalone ESM bundle (~1MB) | TypeScript server | TypeScript server | TypeScript server |

---

## 17. Adapter / Deployment

| # | Feature | Vesk | React | Qwik | Astro |
|---|---|---|---|---|---|
| ★★★ | Production server | `startProdServer()` — SSG, SSR, API, static | `next start` | Server adapters | `astro start` |
| ★★★ | Serverless functions | SSR + API function generation | Built-in | `@qwik-city/adapters` | `@astrojs/vercel`, etc. |
| ★★★ | Static assets | `public/` → `static/public/` | `public/` | `public/` | `public/` |
| ★★ | Plugin system | Custom hooks: onCSS, onFileWatch, onTransformJS, onBuildStart, onBuildEnd | React Config | Vite plugins | Astro integrations |
| ★ | Image pipeline | Optional sharp: WebP/AVIF, multiple widths | Built-in | — | @astrojs/image |

---

## 18. Bundle Size Comparison

| Metric | Vesk | React | Qwik | Astro |
|---|---|---|---|---|
| Client runtime (min) | ~30 KB | ~400 KB | ~10 KB (lazy) | 0 KB (no JS) |
| Client runtime (with deps) | ~35 KB | ~450 KB | ~12 KB | 0 KB |
| Page with interactivity | ~35 KB + component JS | ~450 KB + component JS | ~12 KB + lazy loaded | ~5-50 KB per island |
| Zero-JS page | ~0 KB | ~0 KB (static) | ~0 KB | ~0 KB |
| LSP server bundle | ~1 MB | N/A (ts-server) | N/A (ts-server) | ~1 MB (astro server) |
| Build time (small app) | ~200 ms | ~2-5 s | ~2-3 s | ~1-2 s |

---

## 19. Feature Count Summary

| Category | Vesk | React | Qwik | Astro |
|---|---|---|---|---|
| Language/Compiler | 9 | 7 | 5 | 6 |
| Reactivity | 8 | 4 | 6 | 0 |
| Routing | 12 | 12 | 5 | 5 |
| SSR | 6 | 6 | 5 | 5 |
| Client Runtime | 5 | 3 | 4 | 3 |
| Forms/Validation | 4 | 1 | 1 | 0 |
| Two-Way Bindings | 3 | 0 | 3 | 0 |
| Data Fetching/ISR | 7 | 4 | 2 | 1 |
| Image Optimization | 4 | 3 | 1 | 2 |
| SEO | 3 | 1 | 0 | 0 |
| A/B Testing | 1 | 0 | 0 | 0 |
| Portal | 1 | 1 | 1 | 0 |
| SSG | 3 | 2 | 0 | 2 |
| Dev Tools | 6 | 4 | 3 | 3 |
| LSP | 16 | 3 | 3 | 3 |
| Editor Extensions | 4 | 1 | 2 | 2 |
| Adapter/Deploy | 5 | 3 | 3 | 4 |
| **Total** | **~97** | **~55** | **~43** | **~36** |

> *Note: Many React/Qwik/Astro features come from the ecosystem (React, TypeScript, etc.) rather than framework-specific implementations. Vesk implements more from scratch due to being a standalone compiler+runtime. React counts exclude React core features that aren't part of Next.js itself.*
