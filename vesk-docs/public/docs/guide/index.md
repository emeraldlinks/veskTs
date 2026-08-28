# Vesk Documentation

> Compiler-first framework for the post-VDOM web. `.vsk` is a TypeScript
> superset with `component` declarations, `track()`-based fine-grained
> reactivity, islands, and statement-mode bodies. No virtual DOM — the
> compiler emits per-cell DOM updates, and static subtrees need no
> hydration runtime.

This guide is the complete, feature-by-feature documentation of Vesk:
from scaffolding a new app to deploying it. Every page includes examples,
and every public API is documented as a JSDoc block (ready for extraction
into an API reference).

## Getting started

| Page | Contents |
| --- | --- |
| [Getting Started](getting-started/doc.md) | Scaffolding with `create-vesk`, project structure, dev loop |
| [CLI](cli/doc.md) | `vesk dev` / `build` / `start` / `typecheck` / `seo` / `init` |
| [Dev Server](dev-server/doc.md) | HMR UX, endpoints, env files, dev security parity |
| [Configuration](configuration/doc.md) | Complete annotated `vesk.config.ts`, every key + default |

## Language (`.vsk`)

| Page | Contents |
| --- | --- |
| [Components](language/components/doc.md) | The `component` keyword, props, children, refs, auto-imports |
| [Body Modes](language/body-modes/doc.md) | Overview: expression vs statement mode |
| [Expression Mode](language/expression-mode/doc.md) | `return <jsx>` style; where JSX may appear |
| [Statement Mode](language/statement-mode/doc.md) | Bare JSX, if/for/while/switch/try, key/index/empty, guards |
| [TypeScript](language/typescript/doc.md) | Full TS in `.vsk`; `vesk typecheck` (tsc-in-.vsk) |
| [Styles](language/styles/doc.md) | `<style>` blocks per component; global CSS; Tailwind |
| [Client Boundary](language/client-boundary/doc.md) | Islands (`client`), `{#client}` / `{#server}` blocks |
| [Head & Metadata](language/head-metadata/doc.md) | `<Head>` collection, dedup, client-side head management |

## Reactivity

| Page | Contents |
| --- | --- |
| [Reactivity](reactivity/doc.md) | `track()`, effects, deriveds, scheduler semantics, context |

## Routing

| Page | Contents |
| --- | --- |
| [File-Based Routing](routing/file-based/doc.md) | `app/` conventions, segments, groups, layouts, boundaries |
| [Router API](routing/router-api/doc.md) | `createRouter`, `createFileRouter`, options, guards, prefetch |
| [Link, NavLink & Hooks](routing/components-and-hooks/doc.md) | JSDoc: `Link`, `NavLink`, `Outlet`, `useRouter()`, hooks |
| [Loading States](routing/loading-states/doc.md) | `loading.vsk` + progress-bar layering |
| [Error Handling](routing/error-handling/doc.md) | `error.vsk`, `notFound()`, try/catch, 404s |
| [Offline & Network](routing/offline-network/doc.md) | `offline.vsk`, `network.vsk`, live connectivity UI |
| [Loading Indicator](routing/loading-indicator/doc.md) | Progress bar component + imperative API |

## Rendering & Data

| Page | Contents |
| --- | --- |
| [SSR & Hydration](ssr-hydration/doc.md) | Server rendering, markers, hydration strategies, streaming |
| [Data Fetching](data-fetching/doc.md) | `useFetch`, `createResource`, SSR handoff, mutations |
| [ISR](isr/doc.md) | Stale-while-revalidate cache, tags, per-page revalidate |
| [Static Site Generation](ssg/doc.md) | `getStaticPaths` / `getStaticProps`, prerendered pages |

## Forms & Input

| Page | Contents |
| --- | --- |
| [Forms & Actions](forms-actions/doc.md) | `<Form>`, `<Field>`, validators, `defineAction` server actions |
| [Two-Way Bindings](bindings/doc.md) | `bindValue`, `bindChecked`, `bindGroup` |

## Built-In Components

| Page | Contents |
| --- | --- |
| [Show / For / Switch / Match](built-ins/headless/doc.md) | Headless conditional & list primitives |
| [Portal](built-ins/portal/doc.md) | Teleport DOM nodes to another target |
| [Markdown](built-ins/markdown/doc.md) | `<Md>`: GFM tour, highlighting, HTML policy, raw API |
| [Image](built-ins/image/doc.md) | `<Image>` responsive images + sharp pipeline |
| [Experiment](built-ins/experiment/doc.md) | A/B testing component |

## Server

| Page | Contents |
| --- | --- |
| [API Routes](api-routes/doc.md) | `route.ts` verbs, segments, config exports, limits |
| [Request & Response](server/request-response/doc.md) | `VeskRequest`/`VeskResponse`, accessors, validation, CORS, webhooks |
| [Cookies](server/cookies/doc.md) | `cookies()`, `setCookie`, signed cookies |
| [Middleware](middleware/doc.md) | Onion chain, rewrites, locals, client-router middleware |
| [SEO](seo/doc.md) | JSON-LD schemas, sitemap/robots, SEO audit |

## Production

| Page | Contents |
| --- | --- |
| [Security](security/doc.md) | Presets, headers, CSRF, rate limiting, signed cookies |
| [Deployment](deployment/doc.md) | Node, Vercel, Netlify, Cloudflare, Deno, AWS, edge targets |

## Extending

| Page | Contents |
| --- | --- |
| [Plugins](plugins/doc.md) | Hook lifecycle, validation rules, Tailwind internals |
| [Tooling](tooling/lsp-editors/doc.md) | LSP features, VS Code extension, Neovim |
| [Formatting](tooling/prettier-tailwind/doc.md) | Prettier plugin for `.vsk` |

## For maintainers

Framework-internal documentation (architecture analyses, decision
records, the parked haul engine) lives in
[`docs/maintainers/`](../maintainers/index.md). Older per-module reference
notes live in `docu/` at the repo root.

## Conventions

- Examples use `.vsk`. Features work in **both** body modes unless noted.
- APIs marked *auto-imported* need no import inside components;
  everything else imports from `@vesk/runtime` /
  `@vesk/runtime/router` / `@vesk/runtime/server`.
- JSDoc blocks are canonical and written to be extracted verbatim by a
  docs generator.
