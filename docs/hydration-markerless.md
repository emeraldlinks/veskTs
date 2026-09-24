# Markerless Hydration — Architecture

Author: agent session
Date: 2026-09-23
Status: Phase 2 proposal (design decision captured after Phase 1 investigation)

Task: `/root/vesk/hydration-prop.md`
Objective: replace the marker-based node-location mechanism (the `<!--vsk:…-->`
SSR comment stream) with a **markerless, compiler-driven, structurally-validated**
hydration system. Requirements: deterministic, fault-isolated ("a hydration
mismatch in one boundary must not cause unrelated hydration boundaries to
fail"), recoverable on subtree mismatch, compatible with every existing feature
(fragments, regions, keyed lists, layout slots, deferred strategies, streaming,
statement and expression body modes, zero-JS static pages).

This document is the design contract for Phase 3+ implementation. `[UNVERIFIED]`
marks claims not yet confirmed against source.

---

## 1. Current architecture (baseline)

### 1.1 SSR output

In hydrate mode, SSR emits a flat comment marker stream interleaved with HTML:

- `<!--vsk:t:tag-->` — a typed element claim (the element has dynamic content:
  dynamic attribute, dynamic text, event handler, or is a dynamic-region host).
- `<!--vsk:c:CompName-->` — a component call-site boundary (server-jsgen.ts:481,
  `componentMarker`). Stacked before the same element with `t:` markers; the
  client retires aliases on claim.
- `<!--vsk-slot:sN-->` … `<!--vsk-slot-end:sN-->` — layout `{children}` slot
  boundaries, id-paired, deliberately missing the `vsk:` prefix so the generic
  marker machinery ignores them (server-jsgen.ts:113, layout.ts:44-46).
- `data-vsk-key` — attribute on keyed item roots.

Fully static subtrees emit no markers (`isStaticIR`, server-jsgen.ts:148).
Static children *inside* a claimed element emit no markers either — the client
retrieves them positionally via `__vsk_ssrEls`, the element-children snapshot
captured at adopt time.

### 1.2 Client claim machinery

- `createHydrateWalker(container)` — a **flat, document-order cursor** over the
  marker stream. `nextElement(tag)`/`claimOnly()`/`claimByKey(key)`/`peekKey`
  browse markers; `subWalker(rootEl)` splits off a contained walker;
  `takeMarkers(comments)` bulk-transfers ownership (used by layout slots and
  page claims). Tag mismatch backs off (does *not* consume the marker);
  exhaustion falls back to a fresh element and reports to the canary.
- Claim order strictly equals SSR document order of claimable elements.
- `createHydrateChildWalker(parentEl)` (hydrate.ts:996) is a **structural**
  index-based walker: scans `parentEl.children[childIdx++]`, claims on tag
  match, silently skips mismatches, fresh-fallback on exhaustion. Used only
  internally (hydrate.ts:1029) and in tests — NOT exported from the client
  barrel. It is the seed of the design below, but lacks skip semantics.
- `__vsk_ssrEls`: captured at adopt = all element children of the claimed
  element, in DOM order, marker-independent (stable, structural).
- Regions (`if`/`for`/`while`/`switch`/`try`/map) claim their branch content
  through the shared walker between their anchor/endAnchor comment fences;
  content is collected and inserted via `__place(anchor, endAnchor, nodes,
  fallback)`; the no-content fences use `insertBeforeNextClaim` anchoring.
- Layout slots (`createLayoutSlot(walker, parentEl)` layout.ts:350) `takeMarkers`
  the range between the id-paired slot comments out of the shared walk, giving
  the page its own scoped walker; `trackSlotContent` anchors async page content
  before the slot-end boundary. This is the fault-isolation mechanism today.

### 1.3 The problem with markers

1. **Fragile flat cursor**: the whole document shares one marker cursor. A
   divergeance anywhere (async suspension, condition flip, fetch failure)
   shifts every later claim into fresh-fallback → footer twin right, page
   lands under the layout (layout.ts:15-19 documents this failure mode).
2. **Contamination**: one boundary's failure poisons the shared cursor for all
   subsequent boundaries — exactly the property the task forbids.
3. **Markers are dead weight in HTML**: comment nodes inflate SSR, complicate
   streaming, and are observable.

The marker system's core value is *pinning* claim positions. The strategy is
to make those pins **structural** (they already partially are: the element tree
shape == IR shape, `__vsk_ssrEls` is already marker-independent).

---

## 2. Design: structural DFS walker tree

### 2.0 Scope: exactly what is eliminated

Strict requirement: **the rendered SSR HTML must be ordinary, valid application
HTML.** Nothing in the markup may identify, locate, delimit, coordinate, or
assist hydration — no comments, no generated ids/classes, no `data-*`, no
custom attributes, no sentinels, no annotations. User-authored attributes
(`class="card"`, `id="profile"`) are untouched.

- **Eliminated from SSR HTML:** every `vsk:` comment (`<!--vsk:t:tag-->`,
  `<!--vsk:c:Name-->`, `<!--vsk-slot:sN-->`), and the `data-vsk-key`
  attribute stamped on keyed item roots (server-jsgen.ts `keyedItemTemplate`).
  Keyed identity moves **out of the HTML** into the compiler-generated client
  representation / runtime structures (§2.5).
- **No DOM annotations, even in development:** diagnostics move to
  JS-side `WeakMap<Element, …>` registries (see §2.8). Not even dev builds
  stamp the DOM; the "inspectable" story is a devtools probe over WeakMaps.
- **A clear line between SSR HTML and client-runtime placeholders:**
  region/keyed fences (`anchor`/`endAnchor`, `k:` comments in reconcile.ts)
  are **created and owned by JavaScript at runtime**, never present in the
  SSR document. [VERIFIED] Region anchors are `document.createComment('try'|
  'if'|'for'|'while'|'switch'|'map'|…)` emitted only in the client bundle
  (`emitHydrateFenceAnchoring` client-codegen.ts:958; createComment calls e.g.
  :982, :1081-1084); reconcile `k:` markers are `document.createComment('k:' +
  key)` (reconcile.ts:32); and SSR region emission writes branch content
  **inline with no comment nodes at all** (probe-verified: opaque/map regions
  render bodies directly). These are runtime-only references (prompt §15/§16
  — allowed), not hydration location metadata; hydration locates nodes
  structurally. Runtime-only state (`__vsk_ssrText`, `__cleanup`, WeakMap
  registries) is likewise permitted so long as it never serializes into HTML.
- **Boundary-of-scope (separate features, audit in Phase 8, not hydration
  markers):** client-runtime `data-vesk-*` attributes applied by JS to nodes
  it renders itself (`data-vesk-offline`, `data-vesk-head`, `data-vesk-outlet`,
  `data-vesk-md-css`, `data-vesk-loading-indicator`) — these obey the *same
  philosophy* and should be migrated to WeakMap/internal registries where
  possible, but they are not compiler-generated SSR hydration metadata.
  Server security comments (`<!-- vesk: auto-escape enabled -->`,
  `<!-- vesk-sec: … -->`) are the security feature's response signals, not
  hydration; left as-is unless the requirement later covers them.
- **Client-entry signal:** module-script presence, not a container attribute
  (§4). `[UNVERIFIED]`: where `needsHydration`/client-entry detection reads
  markers today.

**Model at a glance (prompt §20).** The compiler produces two artifacts per
page: (1) a **static SSR document** — ordinary HTML, never itself hydrated,
never carrying hydration code; and (2) a per-boundary **compact hydration
program** — a JS-side structural spec (boundary, claims, expected shapes,
skip counts, keyed discriminators) that never touches HTML. At hydration a
**structural walker** consumes the program against the live DOM: *verified →
adopt-in-place; mismatch → classify → local slot repair | region repair |
boundary recreation → re-verify → continue* (§2.2.1). No VDOM, no
reconciliation pass, no global cursor (prompt §1-§3, §19).

### 2.1 Core model

Replace the single flat marker cursor with a **tree of per-parent cursors**.
A "walker" is a cursor over an ordered list of *elements*:

- **Root walker**: over `container`'s element children (the SSR mount root).
- **Child walker**: over a claimed element `E`'s children. In hydrate mode it
  iterates the `E.__vsk_ssrEls` snapshot (captured at adopt); for fresh
  elements it iterates `E.children` (same code path — fresh nodes have no
  snapshot and the cursor falls back to the live list).

A claim site *always* knows its parent: either a previously claimed element, a
component/`$root` container, or a region host. So the cursor required for a
claim is always "the current parent's walker" — **threaded through codegen**,
never a global.

### 2.2 Cursor semantics

Each walker holds:
- `els`: the element list (snapshot or live).
- `idx`: current cursor index into `els`.
- `pendingSkip`: static elements between the last consumed slot and the next
  claim (fed by codegen skip instructions).
- `warned`: twin/ghost reports for the canary.

Primitives (structural walker; keys never exist on the DOM, so no
`claimByKey`/`peekKey` — they remain only on the legacy marker walker, §6):

```
nextElement(tag, skipK, validate?) // consume skipK static siblings, then claim
                                   // the next element if tag matches AND it
                                   // passes the structural descriptor (§2.2.1)
claimOnly(skipK, validate?)        // claim next element without text stripping
                                   // (static component stubs) unless it's fresh
subWalker(S, el)             // child walker over el's children snapshot
remainingCount()             // unconsumed elements left (keyed/region
                             // count validation, §2.5)
insertBeforeCursor(node)     // insert node at the cursor slot (region fences,
                             // fresh nodes) — replaces insertBeforeNextClaim
```

`nextElement(tag, skipK)` algorithm:

1. Advance `idx` past `skipK` elements **without claiming** (they are known
   static content; if fewer than `skipK` remain → exhausted→fresh).
2. `E = els[idx]`; if none remains → exhausted→fresh (report).
3. If `E` exists and `E.tagName.toLowerCase() === tag` → adopt and return:
   `stripDirectTextNodes`, `captureSsrElementChildren` (snapshot) unless
   claimed already, registry-flag as adopted (WeakMap, §2.8), `idx++`.
4. If `E` exists but the descriptor fails → **report 'tag-mismatch'**,
   **still advance `idx` past `E`** (consume exactly the one slot; never
   steal a neighbor's), and return a fresh element of `tag`,
   registry-flagged fresh (§2.8). `E` is never bound; the caller detaches it
   at commit when provably safe, else leaves it inert for the sweep. This is
   the crucial divergence from today: today mismatches *back off* without
   consuming; structurally backing off would desync every later sibling claim
   (they compute skipK assuming this slot was consumed). The caller inserts
   the fresh element at the cursor position, so neighbor claims stay
   byte-for-byte aligned.
5. Fresh/exhausted results: caller places node via `insertBeforeCursor` (or
   `__place` inside region fences — see 2.4).

### 2.2.1 Adoption validation & transactional commits (prompt §5, §7)

A claim is not adopted on tag alone. Each claim site carries a
compiler-generated **structural descriptor** — the minimal shape the node must
match to be considered *verified*, derived from the IR, not from the DOM:
node kind (element/text/fragment), element tag, boundary type (component
root, region host, keyed item root, static stub), and — where the compiler
requires it — expected child-element structure (e.g. a keyed item root that
must contain a nested claimable element). Claims run an
**inspect → validate → classify → commit** sequence (lightweight; prompt §7's
"inspect-then-commit" suffices — no heavy transaction machinery):

1. **Inspect** — peek the walker's next slot, no mutation.
2. **Validate** — tag + descriptor (node kind, element type, structure).
3. **Classify** — adopt-in-place (verified) | slot-substitute (mismatch) |
   exhaust→fresh (missing) | boundary recreate (region/component mismatch).
4. **Commit** — consume exactly one slot; apply the chosen strategy.

Validation stays deliberately **minimal**: dynamic values (text content,
dynamic attributes) are **never** validated — server text may legitimately
differ from client text at first paint and the first reactive update corrects
it; over-validating would reject valid SSR (prompt §5). Every reference a
claim produces (walker cursors, slot slices, child walkers) is runtime state
only (prompt §6).

### 2.3 Fault isolation

Because interiors run on scoped child walkers, a mismatch inside one boundary
only disturbs *that* boundary's cursor:

- A component's interior claims use a child walker over its own claimed root.
- A region's content claims use the region host's walker (the host element's
  child walker) — siblings outside the region never see the drift.
- The `$root` walker (root container) only ever claims top-level elements; a
  ghost inside one top-level element cannot shift the cursor for the next
  top-level element.

Sibling-slots at the *same* level are still positional (unavoidable — they
share a list), but a claim consumes exactly one slot, and a mismatch consumes
its own slot into a ghost rather than stealing a neighbor's. This gives the
required guarantee: **one boundary failing never cascades past its parent**.

### 2.4 Regions

Regions (opaque dynamic regions, `if`/`for`/`while`/`switch`/`try`, map) keep
their **anchor/endAnchor fences and `__place`/`__cleanup` machinery** exactly as
today — those are the deterministic, DOM-safe place/remove contract for variable
content. What changes:

- Branch content claims run against the *region host's walker* (structural
  child walker), with `claimStatic` forcing claims for fully-static branches so
  re-branching can adopt-in-place (unchanged semantics, structural cursor).
- **Fence anchoring**: empty regions and the case where claimed content must
  not be misplaced now insert anchors via `insertBeforeCursor`, the walker
  knowing its own slot (the comment-to-`nextElementSibling` heuristic that
  today needs `insertBeforeNextClaim` disappears).
- Adoption on same tag + descriptor: if SSR rendered branch A and the
  client's first pass claims branch B with the same shape, the SSR elements
  are adopted *in place* (`__vsk_ssrText` snapshot → effect updates text).
  Tags/shape differ → **slot substitution** (§4.0): the mismatched node is
  **detached when provably safe** (it is the walker's own slot, inside its
  own boundary's DOM) so **no permanent ghost is left behind**; fresh content
  is placed before `endAnchor` via `__place`. Any ghost that could not be
  provably detached is left inert and swept. Region recreation reuses the
  existing `__cleanup` (client-codegen.ts:1053) + `__place` (client-codegen.ts:
  1013) contract — never `replaceChild` on a valid sibling's subtree.

### 2.5 Keyed lists (identity without DOM keys)

`data-vsk-key` leaves the HTML (strict scope). Keys live **entirely in JS**:
Vesk's `reconcile.ts` already keys by `keyFn` over `items` (a
`Map<string, MapEntry>` of runtime anchors); the DOM attribute was read at
exactly one point — first-pass adopt (hydrate.ts `claimByKey`/`peekKey`,
lines 897/934/966). That consumer is replaced by an **identity contract that
never stamps the DOM and never introduces a second key system** (prompt §12):

- The compiler-generated client program carries per-item **shape
  discriminators** (the static per-item structure under the keyed root), the
  keyed region's span, and the JS `keyFn`.
- **First pass — identity, not just count.** For each item the walker computes
  a cheap **structural fingerprint** of the next SSR item root (its claimable
  tag/shape sequence) and compares it against the discriminator of the
  *expected* key (item order matching `keyFn` order):
  - **Fingerprint-unambiguous → reorder-adopt.** `A B C` SSR ↔ `A C B` client
    is repaired at first render by reordering *verified* nodes — the
    fingerprint is the oracle; no DOM annotation. Node identity preserved;
    nothing wrongly bound.
  - **Shape-identical items (fingerprint can't distinguish keys) →
    positional adopt.** Position *i* claims slot *i*. Still safe — each node's
    bindings are positionally consistent — and a client-side reorder is
    corrected on the first reactive update via the JS key map (React/Svelte 5
    parity; documented, not silent corruption).
  - **Ambiguous / failed validation → recreate the smallest safe keyed
    region.** `__cleanup` the region's fences and render fresh from `items`.
    A keyed region is itself a compiler-known recovery boundary (prompt §8),
    so recreation never spills into sibling boundaries.
- **Count validation (prompt §13) is an additional check stacked on identity**:
  the remaining-element count across the region span must equal `items.length`
  under a verified pairing. Client surplus → adopt verified + render the
  missing portion fresh before `endAnchor`; SSR surplus or unpairable extras →
  recreate the region fresh within its fences.
- **Reorders after hydration**: the returned `(newItems) => void` function
  drives all subsequent adds/deletes/moves via the existing JS-keyed map and
  runtime anchors — unchanged semantics (node identity preserved). The `k:`/
  anchor comments this uses are runtime-created only (verified, §2.0).
- **Unkeyed regions** use positional structural matching (no identity step).

**Component-rooted items** (`<ItemRow key={item.id} …/>`) are keyed like
element roots: `extractKeyExpr` (ir-generator.ts) reads the `key` prop off
`ComponentCall` items so the region routes through `reconcileHydrated` instead
of the positional `__place` path (which stranded client-surplus fresh nodes and
could not reorder). The `__place` "nodes in place" branch additionally attaches
detached client-surplus nodes into the region before its end anchor, so unkeyed
map growth after SSR survives hydration too.

Note (removed consumers): server `keyedItemTemplate` (server-jsgen.ts:317) is
retired; `mapRegionToJS` no longer forces a claim on static item roots via the
injected binding — static item roots are force-claimed positionally, their
shape discriminators coming from the client program. `server-codegen.test.ts`
536-563 marker+key expectations flip to no-attribute.

### 2.6 Layout slots (markerless)

`{children}` slot boundaries today are id-paired comments found by
`findSlotRange(parentEl)` (layout.ts:133) scanning `parentEl.childNodes`. The
markerless equivalent is **slice-based**, no comments:

```
createLayoutSlot(afterEl: Element, boundaryEl: Element | null)
```

- Layouts are components: their claimed root element's `__vsk_ssrEls` = *every*
  element child in DOM order. The layout body is
  `[pre-slot nodes…, {children} region, post-slot nodes…]`.
- The slot is the slice of `ssrEls` between the layout's pre-slot claims
  (cursor position) and `boundaryEl` — the first *post-slot claimable
  sibling*, which the layout's codegen knows (its next
  non-pure-static/dynamic sibling, or end-of-list). Static post-slot content
  stays owned by the *layout* (page never claims it).
- The page hydrates against the sliced walker; the layout's post-slot claims
  resume from `boundaryEl`. Async delay no longer matters: both cursors index
  the same immutable snapshot. `trackSlotContent` anchors to the slice end
  (replaces the slot-end comment).
- `auditLayoutSlots` becomes a WeakMap-registry audit (unclaimed elements
  inside a slot slice) instead of comment balancing.
- Nested layouts: each layout component builds its own slot slice from its own
  claimed root — no depth counting needed, no id pairing (identity is the
  boundary element, which is unique to the layout).

### 2.7 Deferred strategies (viewport / idle / interaction)

`hydrateViewport/hydrateIdle/hydrateOnInteraction` currently partition the page
by observing SSR content nodes and claiming later. Structurally they do the
same job against the *slot slice elements*: the page's SSR content is the slot
slice, checked for intersection/`requestIdleCallback`; when triggered, hydrate
the page against the slice walker. `subWalker`/`createLayoutSlot` already hand
back exactly this slice. This is mostly plumbing, but:
- `needsHydration` / client-entry detection must switch from "are there
  markers in/mount container" to a container-level signal; `[UNVERIFIED]`
  where precisely `needsHydration`/entry detection reads markers today.

### 2.8 Canary & strict audit (structural, annotation-free)

Today: `assertFullyHydrated`/`auditHydration` count leftover `vsk:` markers,
`onHydrationMismatch` fires on fresh-node warnings, `setHydrateStrict` removes
unclaimed marker+content and throws.

Structural equivalent — the walker *is* the inventory (it consumes every
claimable slot):

- **No DOM annotations, ever** (strict scope): replace
  `data-vsk-claimed`/`data-vsk-fresh` stamps with a
  `WeakMap<Element, ClaimRecord>` registry. The registry drives the canary and
  a devtools/noop console probe; the DOM carries zero annotations in every
  build. Fresh vs adopted is a registry flag, not an attribute.
- **Twins/ghosts**: each walker records unconsumed elements it advanced past
  on mismatch plus elements remaining when its owner completes. Dev reports
  `onHydrationMismatch` per twin with expected/actual/structural-location/
  boundary (§11 diagnostics); strict mode removes twins and throws. Recovery
  and canary run on the WeakMap, so removing an element never gums up
  bookkeeping.
- **Leftover SSR content** (client rendered fewer nodes than SSR): the parent
  walker, once its owner signals completion, still holds unconsumed elements →
  report + strict removal.
- **Count-aware boundaries** (used by keyed regions §2.5 and region hosts):
  the walker exposes the remaining-element count for structural validation of
  variable regions — detecting extra/missing children without any oracle.

### 2.9 Zero-JS / static pages

Unchanged and simpler: fully static pages already emit no markers; markerless
SSR is just ordinary HTML for every page. SSG (`ssg.test.ts` zero-marker
assertions) keep passing.

---

## 3. Compiler changes

### 3.1 Server (`server-jsgen.ts`, `server-render.ts`)

- Hydrate mode: stop emitting `t:`/`c:` markers. `componentMarker` emission
  (line 481) goes away; call sites push `(${callExpr} || '')`.
- **Drop `data-vsk-key` stamping:** retire `keyedItemTemplate`
  (line 317) and its injection into `mapRegionToJS` (line 267). The item
  template is the plain `bodyTemplate`; keyed identity exists only on the
  client. Static item roots no longer get a forced claim via the injected
  binding — the client walker force-claims them positionally (§2.5).
- Slot region emission stays but without comments — slot identity becomes
  structural (empty slice contract): `{children}` renders `'''` as before; the
  slice is computed client-side from ssrEls + the boundary element. (No signed
  change needed on the server for slots beyond dropping the comment pair;
  the id-stamping machinery in `slot-props` can be retired.) `[SlotNode`
  emission review needed.`]
- `__vskHydrate` flag stays for the *mode*, gated by an experimental/default
  markerless switch (see §6).

### 3.2 Client (`client-codegen.ts`)

Most invasive change: `Ctx.walker` becomes a **value thread**, not a constant
string `'__hydrate'`.

1. `generateComponent` hydrate signature unchanged
   `(props, __registry, __hydrate) => {}`; `__hydrate` is now the *caller's
   active walker* (structural). The first claimed top-level element is
   returned as `$mount`; `$root` fallback stays.
2. After claiming an element `E` that will contain interior claims, codegen
   spans a child scope:
   ```
   const __wN = <parentWalker>.subWalker(<E>);
   ```
   and rebinds `ctx.walker` to `'__wN'` for `E`'s children, restoring after.
   Sub-walker creation is **lazy**: only emitted when the element actually has
   interior claim sites (elements with only static children don't build one).
3. **Skip accounting**: `emitStatic` and peers accumulate `pendingSkip` per
   parent list — the count of non-claimed static siblings between the previous
   claimed slot and the current claim. It is emitted as `skipK` on each claim
   expression (`nextElement("p", 1)`), derived from the existing
   `residueBefore`/`ssrResidueEstimate` machinery (ssrResidueEstimate:
   StaticNode/ComponentCall→1, region bodies→max, else 0). Region boundaries
   reset/resume the counter at the region tail (the region consumed its own
   slots through its own claims).
   **Region first-claim budget (implemented, P3.6):** when a region's opening
   residue estimate is > 0 (static siblings before `if`/`ternary`/`map`/…), the
   branch body's FIRST emitted claim consumes a per-region
   `let $n = N` budget instead of `nextElement(tag, 0)` — the walker can't see
   the residue either (same blindness as components), so the budget is added to
   the first claim's `skipK` and reset to 0 afterwards; later claims resolve
   positionally on the advanced cursor. Nested regions inherit the enclosing
   branch's budget when the region itself is a branch's first claim. Keyed maps
   are excluded (keyed identity never claims positionally).
4. `emitStatic` and region content: `nextElement(tag)` → `nextElement(tag,
   skipK)`; `claimOnly()` → `claimOnly(skipK)`. Keyed lists claim
   **positionally** (no `claimByKey`/`peekKey` on the DOM); `data-vsk-key`
   is never read or emitted.
5. `emitHydrateFenceAnchoring` (root-level no-content fences,
   `insertBeforeNextClaim`) → `insertBeforeCursor`.
6. `emitComponentCall` hydrate:
   - `plainTarget` adoption (imported/member components that can't self-claim)
     keeps claiming the callee's SSR root from
     `walkerArg.claimOnly(undefined, <promptExpr>)` + `replaceChild`; self-claiming
     runtime components (Link/Md/…) no longer need `retireAliases` (no markers).
   - **Value-thread offset (implemented, P3.7):** a compiled child cannot see
     the caller's compile-time `skipK` when it claims its own root from a fresh
     sub-walker. Before invoking a compiled child, the caller deposits the
     residue offset that immediately precedes the call:
     ```
     $nK.injectSkipK(1);            // caller-side residue (skipK), summed with the
                                    // region budget when both exist (markerlessSkipExpr)
     $nK = __components["Child"](…, $nK);   // region budget reset after injection
     ```
     The callee (`generateComponent`) reads the deposit exactly once at its
     first top-level claim: `let $n = (typeof __hydrate.takeSkipK === 'function'
     ? __hydrate.takeSkipK() : 0)` seeds the claim's `skipK`, then `$n = 0`.
     Static-component stubs surface it via
     `claimOnly(undefined, takeSkipK())`. Plain targets never receive
     `injectSkipK` — the offset flows into the post-call
     `claimOnly(undefined, <promptExpr>)` adoption instead. The methods are
     optional on `HydrateWalker` and no-op on the marker `WalkerEngine`, so the
     marker mode is byte-identical. Known edge: self-claiming runtime
     components don't read `takeSkipK`, so residue immediately before one
     degrades to a fresh render.
7. Diagnostics no longer touch the DOM at all: remove the
   `data-vsk-claimed` stamping path; codegen passes the element to the
   WeakMap registry only (§2.8).

### 3.3 Runtime (`hydrate.ts`, `layout.ts`, `reconcile.ts`, `router.ts`)

- `createHydrateWalker` gains a structural mode (or new
  `createStructuralWalker(container)`): element-list cursors as §2.2. `nextElement`
  keeps the legacy back-off behavior only for the *marker* variant.
- `createHydrateChildWalker` (996) becomes the child-walker factory with
  `skipK`/`insertBeforeCursor`/`remainingCount`/Twin reporting; §1.2's
  silent-skip behavior is replaced by the §2.2 semantics. `claimByKey`/
  `peekKey`/`relocateByKey` are removed from the structural walker surface
  (keys no longer live on the DOM).
- `createLayoutSlot`/`takeMarkers`/`findSlotRange`/`auditLayoutSlots`
  reworked to §2.6 slice semantics; `takeMarkers` retired (structural walks
  never transfer markers).
- `reconcile.ts` keeps its JS-keyed `reconcile`/`reconcileHydrated`; the
  claim-by-key first-pass (reconcile.ts:101-107) becomes positional +
  count-validated (§2.5). The `k:`/fence anchors stay (runtime-created,
  never SSR).
- `router.ts` layout chain + `hydPage(...)` (router.ts:1210-1240): the slot
  slice replaces `subWalker`/marker transfer; deferred strategies per §2.7.
- See §2.0 boundary-of-scope: client-runtime `data-vesk-*` attributes are a
  Phase 8 follow-up, not part of this change.
- All marker constants (`vsk:`, `vsk` / `LAYOUT_SLOT_*`) and collect/audit
  paths stay for **legacy compatibility** (see §6), tree-shaken from the
  production bundle when markerless is on.

---

## 4. Edge cases & recoverability

### 4.0 Recovery model

Recovery is a **ladder resolved at the smallest compiler-known safe boundary**
(prompt §2, §8, §12) — never a global rebuild, never binding to an unverified
node, never cascading past the owning boundary (prompt §3, §19).

Every claim site runs the §2.2.1 **inspect → validate → classify → commit**
sequence; the strategy table below is what `classify` outputs.

1. **Adopt-in-place (resynchronization; the normal case, zero cost).** Tag +
   descriptor match → take the SSR element, snapshot `__vsk_ssrText`, bind;
   the first reactive update corrects dynamic content. No repair occurs.
2. **Slot substitution (single claim site).** Mismatch → the walker consumes
   exactly one slot (never rebinds the mismatched node, never steals a
   neighbor's), and the caller inserts a fresh element at the cursor position.
   The mismatched node is **inert by construction** (no binding ever touches
   it) and is **removed/detached when provably safe** — it is the walker's own
   slot inside its own boundary's DOM — so the DOM is not left with a permanent
   ghost (prompt §6). Any refs created here are runtime state only.
3. **Region recreation (variable region).** Content that can't be re-shaped is
   rebuilt between the region's `anchor`/`endAnchor` via the existing
   `__cleanup` + fresh render (`__place`); the fences make it DOM-safe and
   self-contained. Verified SSR elements inside the region are preserved, not
   cloned.
4. **Component/boundary recreation (escalate one level, prompt §8/§10).** A
   failed *root* claim recreates that component client-side only: fresh root;
   its interior sub-walker has no SSR elements, so it renders fresh. Each
   component's hydrate invocation is wrapped so a **thrown user error isolates
   to that boundary** (reported via the existing `onHydrationMismatch`, not
   only the router's outer guard); sibling components use their own walkers and
   are unaffected (prompt §11).
5. **Next compiler-known safe boundary.** Escalation stops at the nearest
   enclosing compiler-known boundary; it is **never** a global rebuild and
   **never** reaches sibling/top-level boundaries (Header/Counter/Footer stay
   independent).
6. **Final sweep (boundary-safe, prompt §14).** Post-pass each walker reports
   unconsumed/inert elements *provably belonging to its own boundary*: dev
   diagnostics carry Boundary / Location / Unexpected node / Recovery; strict
   mode removes verified leftovers and throws; production runs minimal cleanup
   only. The sweep **never deletes arbitrary DOM** — every removed node is
   provably owned by the affected boundary.

Guarantees: a failure consumes only its owning walker's cursor (structural
isolation, §2.3); no strategy binds an unverified node; no strategy introduces
serialized DOM hydration markers (prompt §15/§16).

| Case | Behavior |
|---|---|
| SSR branch rendered, client branch differs, same tags | adopt-in-place (`__vsk_ssrText` → effect updates) — unchanged |
| Tags/shape differ | slot substitution: fresh at cursor, mismatched node detached when provably safe (no permanent ghost); sibling claims unaffected |
| Client has content SSR lacks | exhausted→fresh at cursor; report |
| SSR has content client lacks | unconsumed elements at walker close → report + strict removal |
| Async page (useFetch suspension) | claims happen late against the immutable slot slice; siblings never drift (this is the layout.ts:15-19 failure mode, fixed structurally) |
| Keyed region count/identity mismatch | recreate smallest safe keyed region within its fences (compiler-known boundary) — identity-first, count as additional validation, no DOM oracle |
| Keyed add/remove/reorder AFTER hydration | existing JS-keyed `reconcile` (runtime anchors, node identity preserved) |
| Keyed first-render reorder | fingerprint-unambiguous → reorder-adopt verified nodes; shape-identical → positional adopt, reordered on first reactive update; ambiguous → recreate smallest safe keyed region (§2.5) |
| Nested layouts | per-claimed-root slices, no id pairing |
| Consecutive static siblings | captured by `pendingSkip`, not claimed |
| Zero JS | pages fully static emit vanilla HTML |
| Every mismatch | localized: only the owning walker's cursor is consumed; `onHydrationMismatch` per boundary |

---

## 5. Test plan

New unit tests:
- `hydrate.test.ts`: structural walker cursor semantics (skipK, mismatch →
  ghost+advance, exhausted → fresh-at-cursor, claimOnly no-strip, positional
  keyed adopt + count-validation → region recovery, sub-walker contamination
  isolation, WeakMap twin reporting, zero-DOM-annotation probe).
- `client-codegen.test.ts`: markerless emission — no `vsk:` literals, no
  `data-vsk-key`, no `data-vsk-claimed`, skipK values everywhere, subwalker
  span, no `insertBeforeNextClaim`/`retireAliases`/`claimByKey` in output,
  statement-mode coverage.
- `server-codegen.test.ts`: hydrate SSR emits only ordinary HTML — assert
  **zero** `<!--` comments, zero `data-*`, zero ids/classes beyond authored
  (test reuses existing marker-assertion fixtures flipped to their plain-HTML
  twins); static subtrees bare; keyed items carry no key attribute.
- `layout.test.ts`: slice-based slot boundaries, async anchoring, nested slots.
- `reconcile.test.ts`: positional adopt + count-aware region recovery, JS-keyed
  reorder after hydration (existing keyed tests re-based without attributes).
- Keyed-identity tests: fingerprint-reorder adopt vs shape-identical positional
  vs ambiguous → smallest-safe-region recreation (§2.5); no DOM key read/write.
- Recovery-transaction tests: inspect→validate→classify→commit per boundary;
  slot substitution detaches the mismatched node (no permanent ghost); thrown
  user error inside one component does not touch siblings (per-boundary
  try/catch via `onHydrationMismatch`); escalation stops at the next
  compiler-known boundary — never global.
- Zero-JS test: a fully static page ships **no** hydration JS/program/runtime
  because the hydration system exists (prompt §17).
- `router.test.ts`: slot-slice hydration chain, deferred strategies on slices.

E2E (`node tests/hydration-test.mjs`, `tests/dev-test.mjs`,
`tests/production-hydration-test.mjs`): run the **entire existing suite**
markerless — every group (error isolation, keyed maps, else-if chains, layout
slots, deferred strategies, streaming, data fetch, actions) is green. Then add
targeted markerless-only probes (mismatch isolation: a deliberately broken
boundary must not break siblings — asserted via canary; and a strict-HTML
grep: hydrated SSR `<body>` contains no `<!--`, no generated `data-`/id/class).

All body-level features must be tested in **both expression and statement
mode** (per repo rules).

---

## 6. Rollout & compatibility

- Add a config/CLI switch (`vesk.config.ts` `hydration: 'markerless' |
  'markers'`); **markerless is the default**; `'markers'` temporarily
  preserves legacy output for differential testing.
- During migration, run the markerless compiler output against the **existing
  marker-based runtime** first (SSR markers removed, claims purely structural,
  legacy runtime kept for A/B) — criterion for the swap.
- Keep the marker machinery in runtime source behind the legacy flag;
  production builds tree-shake it.
- Differential harness: render the same page twice (marker vs markerless),
  hydrate both, assert identical DOM after hydration + identical canary reports.

---

## 7. Open questions / risks

1. `__vsk_ssrEls` capture timing: adopt happens at claim; late interior claims
   (async) index the same snapshot — need to verify no code path *mutates*
   `__vsk_ssrEls` before late claims complete (phase-3 probe).
2. `insertBeforeCursor` for fresh *root-level* claims (top of `$root` when the
   first top-level element is fresh): must not depend on a neighboring claimed
   element existing. Probe: component whose entire first top-level subtree is
   client-only.
3. Streaming (`renderPageStream`): markers previously provided commit points;
   structural cursors need the same slicing semantics on stream-commit.
4. `needsHydration`/client-entry marker checks `[UNVERIFIED]` — switch to the
   module-script-presence signal.
5. Keyed first-pass count validation: the region-span delta must be measured
   without consuming claim slots — region hosts expose a preceding count.
6. Multiple `{children}` slots in one layout body (rare): slice construction
   must assert boundary ordering.
7. Global interactive listeners / focus restoration bound to markers `[UNVERIFIED]`.
8. Same-shape keyed first-render reorder is detectable only via the §2.5
   fingerprint when items are shape-distinguishable; shape-identical items
   adopt positionally and reorder on the first reactive update. Confirm no
   existing test depends on SSR↔client reorder adopt at first-render
   (`hydrate.test.ts` 699-1107 / 1661 currently assert claimByKey reorder;
   they flip to the conditional identity path).

---

## 8. Implementation order (Phase 3+)

1. **Probe**: runtime structural walker (`createStructuralWalker` +
   extended `createHydrateChildWalker`) + compiler flag emitting no markers +
   `skipK` claims for a single simple component (static wrapper + dynamic text
   + event + static sibling). Compare old-vs-new SSR + hydrate against
   probe DOM; validate §7.1/§7.2.
2. Regions + region fences (`insertBeforeCursor`), keep `__place/__cleanup`.
3. Component threading (value walker), interior sub-walkers, isolation probe.
4. Keyed lists (§2.5): positional adopt + count validation → region recovery;
   JS-keyed reconciles unchanged.
5. Layout slots (§2.6) + router chain + deferred strategies (§2.7).
6. Canary/strict audit structural, WeakMap-based and annotation-free (§2.8),
   production tree-shake.
7. Differential harness + full E2E migration (§5, §6); strict-HTML grep probe
   (no comments/data-/generated ids in hydrated SSR `<body>`).

---

## 9. Invariants (prompt §19)

Hold in every build mode (markerless default, legacy `markers`):

1. **Never bind an unverified node** — adoption requires the §2.2.1 descriptor
   check (`inspect → validate → classify → commit`), never tag-only.
2. **Boundary cursor isolation** — no global hydration cursor; a walker is
   scoped to its owning boundary's DOM (§2.3).
3. **No global rebuild from a local mismatch** — escalation stops at the next
   compiler-known safe boundary (§4.0 step 5).
4. **Never delete DOM outside the owning boundary** — recovery and sweep remove
   only provably-owned nodes (§4.0 step 6).
5. **Never introduce serialized DOM hydration markers** — no comments, no
   `data-*`, no generated ids/classes/sentinels in SSR HTML; fences and `k:`
   anchors are runtime-created only (§2.0, [VERIFIED]).
6. **Never ship hydration machinery to compiler-proven-static subtrees** —
   static pages and static subtrees receive no hydration program/runtime/
   markers even though the hydration system exists (§2.9, prompt §17).
7. **Never turn hydration into VDOM reconciliation** — the compiler knows the
   expected structure; there is no full-tree reconcile pass and no VDOM
   (prompt §1).
8. **Never silently accept structural uncertainty** — ambiguous keyed identity,
   count mismatches, or unclassifiable mismatches recreate the smallest safe
   boundary and are reported (dev), not guessed (prompt §19, §2.5).

---

## 10. Acceptance checklist (prompt §18 — run before declaring success)

- **HTML audit**: hydrated SSR `<body>` contains no `<!--`, no generated
  `data-*`/id/class, no sentinels/placeholders/annotations (grep probe in the
  E2E suite). User-authored attributes preserved verbatim.
- **Runtime audit**: no global cursor, no global failure path, no binding to
  unverified nodes, no global cleanup, no full-tree reconcile.
- **Compiler audit**: all recovery boundaries are compiler-derived (component
  roots, region hosts, keyed regions); static subtrees are non-hydrated;
  statement-mode and expression-mode bodies produce identical hydration
  behavior.
- **Recovery audit**: ladder is adopt → local slot substitution → region
  recreation → component/boundary recreation → next safe boundary — never
  local→global; per-boundary user-error isolation proven by the mismatch
  isolation E2E group.
- **Zero-JS audit**: a fully static page ships no hydration JS/program/runtime
  because the hydration system exists (prompt §17).
- **Fences audit**: `anchor`/`endAnchor`/`k:` are runtime references only —
  assert SSR HTML contains no anchor comments.