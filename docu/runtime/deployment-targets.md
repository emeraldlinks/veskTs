# Deployment Targets

> Status: Phase 2 — Node server target only.

## Target Environments

### Node.js Server (Phase 2+)

The primary deployment target. Standard Node.js server environment:

- `packages/runtime` is written as ordinary Node-targeting server runtime
- Node built-ins (`fs`, `path`, `net`, `Buffer`, `crypto`) are fine to use
- Server codegen produces a render function callable from any Node HTTP framework
- `defer`/streaming codegen uses Node streams for the Node path

### Edge Runtime (Future)

Separate adapter for edge environments (Cloudflare Workers, Vercel Edge). Not built in Phase 2.

### Browser (Phase 3+)

Client codegen produces JavaScript that runs in the browser. Creates real DOM, wires reactive bindings. See Phase 3.

## Server Rendering

Server rendering produces an HTML string from a `.vsk` source:

```js
import { render } from '@vesk/compiler';

const html = render(source, 'ComponentName', { prop: 'value' });
```

### What gets rendered

- Static HTML elements with attributes
- Dynamic expression interpolation (`{expr}`)
- Conditional rendering (`{cond && <X />}`, `{cond ? <A /> : <B />}`)
- List rendering via `.map()` — iterates array, concatenates HTML
- Child component calls — renders nested component HTML

### What does NOT get rendered

- Event handlers (`onClick`, `onChange`, etc.) — client-only
- `track()` declarations — skipped on server (reactive state is client-only)
- Client-only components — not supported in Phase 2

### HTML escaping

All dynamic text content is escaped to prevent XSS:
- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`
- `"` → `&quot;`
- `'` → `&#39;`

## Client Rendering (Phase 3+)

Client rendering creates real DOM elements and wires reactive bindings:

- `track()` creates reactive cells
- State mutations trigger targeted DOM updates
- `.map()` uses runtime keyed reconciliation (the "slow path")
- Statement-mode `if`/`for` uses static codegen (the "fast path")

## Hydration (Phase 6+)

Server-rendered HTML can be hydrated on the client:

1. Server renders HTML string with metadata markers
2. Client walks existing DOM, attaches event handlers
3. `track()` values adopt server-rendered initial state
4. Component becomes interactive
