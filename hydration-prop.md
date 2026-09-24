You are implementing a new hydration architecture in the Vesk compiler/runtime.

OBJECTIVE

Replace Vesk's current marker-dependent hydration approach with a markerless, compiler-generated structural hydration system.

The goal is NOT to invent a separate framework or rewrite Vesk.

The goal is to evolve Vesk's existing hydration architecture so that hydration no longer depends on per-node DOM markers as the primary mechanism for locating nodes.

The new system must be:

- markerless by default
- compiler-driven
- deterministic
- structurally validated
- fault-isolated
- recoverable when a subtree does not match
- compatible with Vesk's existing SSR/compiler architecture
- compatible with Vesk's zero-JS philosophy
- compatible with Vesk's statement mode and expression mode
- compatible with Vesk's existing syntax and semantics
- thoroughly tested

The most important architectural objective is:

«A hydration mismatch in one boundary must not cause unrelated hydration boundaries to fail.»

Do not claim that hydration can be mathematically "100% reliable". The target is maximum practical resilience with localized failure and recovery.

---

1. STUDY VESK BEFORE IMPLEMENTING ANYTHING

This is mandatory.

Do not start coding immediately.

First study the Vesk framework thoroughly enough to understand how it actually works.

Inspect:

- compiler architecture
- parser
- AST
- JSX/TSX handling
- Vesk syntax
- statement mode
- expression mode
- component compilation
- SSR compilation
- client compilation
- hydration generation
- hydration runtime
- reactivity system
- event handling
- dynamic attributes
- conditional rendering
- loops
- keyed lists
- fragments
- component boundaries
- code splitting
- tree shaking
- runtime generation
- zero-JS/static analysis
- current tests
- existing hydration tests
- build system
- development tooling

Trace real examples through the entire pipeline.

At minimum, trace:

1. static component
2. dynamic text
3. dynamic attribute
4. event handler
5. conditional rendering
6. loop
7. nested component
8. fragment
9. reactive state
10. client-only behavior

Understand exactly what the compiler currently generates.

Do not infer behavior from documentation when repository implementation is available.

Do not invent APIs, compiler phases, runtime functions, or file paths.

If documentation and implementation disagree, investigate the implementation and determine the actual behavior before making changes.

---

2. UNDERSTAND VESK'S TWO MODES

Vesk has distinct statement mode and expression mode.

This distinction is fundamental and MUST NOT be lost during the hydration work.

Statement mode

Vesk statement mode uses native JavaScript control-flow statements.

Use:

if
else
else if
for
while

where appropriate.

Do NOT rewrite Vesk statement-mode constructs into expression-style JavaScript merely because another framework commonly does so.

For example, statement mode should continue to support the Vesk style of:

if (condition) {
    ...
} else {
    ...
}

and loops such as:

for (const item of items) {
    ...
}

Do not replace statement-mode loops with:

items.map(...)

unless that is actually part of the existing Vesk source semantics.

Expression mode

Expression mode intentionally permits expression-oriented syntax.

For example:

condition ? a : b

and:

items.map(...)

may be used where expression mode permits them.

Do not blur the distinction between these two modes.

The hydration implementation must understand and preserve the semantics produced by both modes.

Do not redesign Vesk's language syntax as part of this task.

---

3. DO NOT TURN VESK INTO REACT

This implementation must remain Vesk.

Do not introduce:

- virtual DOM
- React-style reconciliation
- React-style component semantics
- unnecessary runtime abstractions
- hook systems
- JSX transformation assumptions that contradict Vesk
- marker-heavy React-like hydration
- runtime interpretation of source code

Vesk is compiler-first.

Prefer compile-time knowledge over runtime discovery.

---

4. ZERO-JAVASCRIPT IS A HARD REQUIREMENT

This is a critical Vesk architectural constraint.

Vesk aims to ship zero bytes of JavaScript for pages/subtrees where JavaScript is not actually required by user interaction or client-side behavior.

The new hydration architecture MUST NOT compromise this.

For a completely static page:

Vesk source
    ↓
compiler
    ↓
HTML

There should be:

- no application JavaScript
- no hydration runtime
- no hydration program
- no hydration markers
- no unnecessary metadata

The output should remain effectively HTML-only.

For an application containing interactive behavior:

Static content
        +
interactive boundaries
        ↓
HTML + only required client JavaScript

JavaScript must remain demand-driven.

The compiler should determine which parts genuinely require client-side behavior.

Do NOT emit hydration machinery for a subtree that is statically known to require no hydration.

---

5. ZERO-JS REGRESSION TESTING

The implementation must explicitly test Vesk's zero-JS behavior.

Measure generated output before and after the hydration change.

Verify that static pages do not suddenly receive:

- hydration runtime
- hydration instructions
- marker data
- unnecessary event infrastructure
- unnecessary component metadata
- unnecessary JavaScript

The new hydration architecture must not increase JavaScript shipped to pages that do not require it.

Also verify that JavaScript remains scoped to the pages/components where it is actually required.

A markerless system that makes Vesk ship more JavaScript by default is considered a regression.

---

6. INVESTIGATE THE EXISTING MARKER SYSTEM

Before replacing it, understand exactly why Vesk currently uses markers.

Determine:

- what markers identify
- where they are generated
- where they are consumed
- whether they identify nodes, boundaries, components, fragments, or dynamic regions
- whether they are needed for event binding
- whether they are needed for reactive text
- whether they are needed for lists
- whether they are needed for fragments
- whether they are needed because of compiler limitations
- whether they are needed because of streaming/SSR behavior

Do not assume all markers serve the same purpose.

Identify which markers can actually be eliminated.

---

7. CORE ARCHITECTURE: STRUCTURAL HYDRATION

The proposed direction is markerless structural hydration.

Instead of:

<div data-vesk-id="1">
    <button data-vesk-id="2">
        Count: 0
    </button>
</div>

the preferred output is ordinary HTML:

<div>
    <button>
        Count: 0
    </button>
</div>

The compiler generates a compact hydration representation describing the information required to activate client behavior.

Conceptually:

App
 └── div
      ├── h1
      │    └── text
      │
      └── button
           ├── text
           └── click binding

This is only a conceptual model.

Do NOT copy this representation literally.

Design the actual representation based on Vesk's compiler/runtime architecture.

---

8. DOM STRUCTURE SHOULD BE THE PRIMARY NODE-LOCATION MECHANISM

The browser already provides a DOM tree.

Use that tree.

If the compiler knows that a boundary produces:

div
 ├── h1
 └── button

the runtime should preferably traverse the corresponding DOM structure rather than search for:

data-vesk-id="123"

Prefer deterministic traversal.

Avoid excessive:

querySelector()
querySelectorAll()

calls for individual nodes.

Do not scan the entire DOM unnecessarily.

Use direct child traversal, structural indexes, or another efficient mechanism appropriate to the actual Vesk runtime.

---

9. COMPILER-GENERATED HYDRATION PROGRAM

The compiler should generate a compact representation of client behavior.

Depending on the actual architecture, this may describe:

- structural paths
- child indexes
- element types
- dynamic text locations
- dynamic attributes
- event bindings
- reactive bindings
- component boundaries
- conditional boundaries
- loop boundaries
- keyed identity information
- fragment boundaries

Do not serialize information that can be statically derived elsewhere.

The compiler already knows much of the structure.

Exploit that compile-time knowledge.

---

10. HYDRATION MUST BE FAULT-ISOLATED

This is one of the most important requirements.

Suppose:

Root
 ├── Header
 ├── Counter
 └── Footer

If Counter cannot hydrate:

Header  → hydrated
Counter → mismatch → recover
Footer  → hydrated

Do NOT allow:

Counter mismatch
      ↓
entire application hydration fails

unless the actual architecture proves that the boundary cannot safely be isolated.

Hydration boundaries should be independently recoverable whenever possible.

---

11. STRUCTURAL VALIDATION

Hydration should verify the DOM while traversing it.

Conceptually:

Expected:
div
 ├── h1
 └── button

Actual:
div
 ├── h1
 └── button

Continue.

But:

Expected:
div
 ├── h1
 └── button

Actual:
div
 ├── p
 └── button

Detect the mismatch.

The runtime should know:

- expected node
- actual node
- structural location
- affected boundary

Development builds may produce detailed diagnostics.

Production should keep diagnostics lightweight.

---

12. RECOVERY

When a mismatch occurs, recover the smallest safe boundary.

Possible strategies:

1. structural resynchronization
2. subtree isolation
3. subtree replacement
4. client rendering of the affected boundary

Use the simplest safe strategy.

Do not invent a complicated recovery algorithm unnecessarily.

Correctness is more important than cleverness.

If the runtime cannot safely determine what a node represents, it must not blindly attach bindings.

It should recover by recreating the affected boundary.

Never silently create a potentially corrupted application.

---

13. DYNAMIC TEXT

For:

<p>{count}</p>

the compiler should know that the text is dynamic.

The runtime must locate the correct text node structurally and establish the reactive binding.

No per-node marker should be required.

---

14. DYNAMIC ATTRIBUTES

For:

<div class={className}>

the compiler should generate the necessary binding information.

The runtime should locate the element structurally.

Do not add an attribute solely to identify the element for hydration.

---

15. EVENTS

For:

<button onClick={increment}>
    Increment
</button>

the runtime must attach the event listener to the structurally identified element.

Do not add a marker simply because an event exists.

---

16. CONDITIONALS

Investigate how Vesk statement mode and expression mode compile conditional rendering.

Support cases such as:

if (visible) {
    ...
} else {
    ...
}

and expression-mode conditionals where Vesk supports them.

Do not rewrite source semantics.

The hydration system must understand the compiler output regardless of which supported syntax produced it.

---

17. LOOPS

This is particularly important.

Vesk statement mode uses native JavaScript loops such as:

for (const item of items) {
    ...
}

Do NOT rewrite statement-mode loops into:

items.map(...)

Expression mode may use:

items.map(...)

where the language permits it.

The hydration architecture must support both because they represent different Vesk source modes.

Study how Vesk compiles each form before implementing hydration.

---

18. KEYED LISTS

For lists such as:

items.map(item => (
    <Card key={item.id} item={item} />
))

or their statement-mode equivalent, investigate how Vesk currently represents identity.

Do not assume positional matching is always safe.

If Vesk already has keyed identity information, reuse it.

Do not introduce a second incompatible key system.

---

19. FRAGMENTS

Support fragments without introducing artificial DOM marker nodes.

If Vesk currently represents fragments in another way, understand that implementation first.

The hydration representation must correctly account for fragment boundaries without corrupting the DOM tree.

---

20. NESTED COMPONENTS

Component boundaries should be independently understandable and recoverable.

Example:

App
 ├── Navigation
 ├── Dashboard
 │    ├── Counter
 │    └── Chart
 └── Footer

A failure in Counter should not automatically invalidate Navigation, Footer, or unrelated parts of Dashboard.

Use Vesk's actual component model.

Do not invent a parallel component identity mechanism.

---

21. STRUCTURAL FINGERPRINTS

Investigate whether compiler-generated structural fingerprints could improve mismatch detection.

A fingerprint should describe structure, not act as a per-node marker.

For example, conceptually:

structure = div → h1 + button
bindings  = button.click + dynamic-text

Do not automatically implement fingerprints.

First determine whether deterministic structural traversal already provides sufficient correctness.

Only add fingerprints if they provide a measurable benefit without undermining Vesk's zero-JS and low-runtime-overhead goals.

---

22. STREAMING AND SSR

Inspect whether Vesk supports:

- streaming SSR
- asynchronous rendering
- partial HTML
- progressive rendering
- suspense-like behavior
- deferred components

If these features exist, determine how structural hydration interacts with them.

Do not invent support for features Vesk does not currently implement.

---

23. PERFORMANCE

The new architecture must not solve marker problems by making hydration substantially slower.

Measure:

- generated HTML size
- hydration metadata size
- JavaScript size
- hydration startup time
- DOM traversal
- allocations
- memory usage where measurable

Compare against the existing implementation.

Pay particular attention to Vesk's zero-JS/static pages.

For static pages, the ideal hydration cost is:

0

because hydration should not exist there.

---

24. DO NOT ADD A LARGE RUNTIME

Avoid introducing a large generic hydration engine.

Vesk is compiler-first.

Prefer compiler-generated compact instructions and a minimal runtime.

Do not create abstractions merely because they are common in other frameworks.

Every byte of runtime code should have a reason.

---

25. TESTING

Create comprehensive tests.

At minimum:

Static

- static HTML
- nested elements
- fragments
- static components
- static pages

Dynamic

- dynamic text
- dynamic attributes
- reactive values
- event handlers

Components

- nested components
- sibling components
- component boundaries
- dynamic components where supported

Conditionals

- initially true
- initially false
- transition after hydration
- statement mode
- expression mode

Loops

- statement-mode "for"
- expression-mode ".map"
- keyed lists
- insertion
- deletion
- reordering

Do not rewrite the source syntax merely to simplify tests.

Recovery

Intentionally create:

- missing node
- extra node
- wrong element
- changed subtree
- unexpected text node
- malformed structure

Verify:

1. mismatch detected
2. correct boundary identified
3. smallest safe boundary recovered
4. unrelated components continue working
5. events continue working
6. reactivity continues working
7. no silent corruption occurs

Marker independence

Explicitly verify that hydration works without per-node hydration markers.

---

26. ZERO-JS TESTS

These are mandatory.

Create tests proving that completely static Vesk applications produce:

- no application JavaScript
- no hydration runtime
- no hydration instructions
- no hydration markers
- no unnecessary metadata

Also test a mixed page:

Static
 ├── Article
 ├── Documentation
 └── Interactive Counter

Verify that JavaScript is shipped only for the part that genuinely requires it, according to Vesk's existing compilation/code-splitting architecture.

Do not regress Vesk's existing per-page JavaScript minimization.

---

27. COMPATIBILITY

Do not break existing Vesk behavior unnecessarily.

If the old marker system must temporarily remain available, isolate it clearly.

Do not allow both hydration systems to silently operate on the same DOM.

Migration must be deliberate.

---

28. ANTI-HALLUCINATION RULES

These rules are mandatory.

1. Never invent an existing Vesk API.
2. Never invent a file path.
3. Never invent a compiler phase.
4. Never invent a runtime function.
5. Never assume a feature exists.
6. Search the repository before referencing implementation details.
7. Study the framework thoroughly before modifying it.
8. Reuse existing abstractions whenever possible.
9. Do not rewrite unrelated systems.
10. Do not change public APIs unless necessary.
11. Do not silently change Vesk semantics.
12. Do not remove existing tests.
13. Do not weaken tests to make them pass.
14. Do not skip difficult tests without documenting why.
15. Do not introduce TypeScript "any" unnecessarily.
16. Do not add dependencies unless absolutely necessary.
17. Do not implement speculative features.
18. Do not claim 100% reliability.
19. Do not claim this architecture is unprecedented without actual research.
20. Do not turn Vesk syntax into another framework's syntax.
21. Preserve statement mode.
22. Preserve expression mode.
23. Preserve Vesk's native "if/else" statement semantics.
24. Preserve Vesk's native "for" loop semantics.
25. Do not replace statement-mode "for" loops with ".map()".
26. ".map()" is acceptable only where Vesk expression mode actually permits it.
27. Do not compromise Vesk's zero-JS goal.
28. Do not ship hydration machinery for static content that does not require it.
29. If repository evidence contradicts this prompt, investigate the discrepancy rather than guessing.
30. If a design decision materially affects correctness, stop and investigate before implementing it.

---

29. IMPLEMENTATION PROCESS

Follow this order.

Phase 1 — Repository investigation

Do not modify code.

Study the framework and trace the existing hydration pipeline.

Identify exact files and architecture.

Phase 2 — Architecture document

Create a short internal implementation plan based on the actual repository.

Include:

- current marker system
- proposed structural representation
- compiler changes
- runtime changes
- boundary model
- recovery model
- zero-JS implications
- compatibility strategy
- test strategy

Phase 3 — Minimal prototype

Implement markerless hydration for:

- static elements
- dynamic text
- events

Do not attempt everything at once.

Phase 4 — Expand

Add:

- attributes
- components
- conditionals
- statement-mode loops
- expression-mode lists
- keyed identity
- fragments
- nested boundaries

Phase 5 — Fault isolation

Implement localized mismatch detection and recovery.

Phase 6 — Zero-JS validation

Verify that static applications remain JavaScript-free and that interactive code remains appropriately scoped.

Phase 7 — Remove marker dependency

Only after the new architecture passes the comprehensive test suite should the old marker-dependent implementation be reduced or removed.

Phase 8 — Benchmark

Compare the new implementation with the existing one.

Measure:

- HTML size
- hydration metadata
- JS size
- hydration time
- runtime allocations
- memory where possible

---

30. DEFINITION OF DONE

The implementation is complete only when:

- Vesk can hydrate without per-node hydration markers.
- DOM structure is the primary node-location mechanism.
- Hydration information is compiler-generated.
- Dynamic text works.
- Dynamic attributes work.
- Events work.
- Components work.
- Nested components work.
- Conditionals work.
- Statement-mode "for" loops work.
- Expression-mode ".map()" lists work where supported.
- Keyed lists work.
- Fragments work.
- Hydration mismatches are detected.
- Mismatches are isolated to the smallest safe boundary.
- Recoverable boundaries can be safely remounted/re-rendered.
- Unaffected components continue working.
- Static pages remain zero-JS.
- Hydration code is not shipped where hydration is unnecessary.
- Vesk's existing statement/expression distinction is preserved.
- Existing relevant tests pass.
- New structural hydration tests pass.
- Marker-independent hydration is ex
Expression-mode .map() lists work where supported.
Keyed lists work.
Fragments work.
Hydration mismatches are detected.
Mismatches are isolated to the smallest safe boundary.
Recoverable boundaries can be safely remounted/re-rendered.
Unaffected components continue working.
Static pages remain zero-JS.
Hydration code is not shipped where hydration is unnecessary.
Vesk's existing statement/expression distinction is preserved.
Existing relevant tests pass.
New structural hydration tests pass.
Marker-independent hydration is explicitly tested.
Performance is measured against the existing implementation.
No unrelated Vesk functionality has been broken.
Documentation accurately describes the implementation.
No unsupported claims about reliability or novelty are made.
Before declaring success, run the project's actual:
type checks
linting
compiler tests
SSR tests
hydration tests
integration tests
build
relevant benchmarks
Use the commands discovered from the repository itself.
Do not invent test commands.
31. FINAL REPORT
When finished, report exactly:
What you inspected.
How Vesk's existing hydration system works.
What the old marker system was actually being used for.
What was changed.
Why each change was necessary.
Which files changed.
Which compiler changes were made.
Which runtime changes were made.
How markerless structural hydration works.
How fault isolation works.
How recovery works.
How statement mode is preserved.
How expression mode is preserved.
How for loops are handled.
How .map() lists are handled.
How zero-JS behavior is preserved.
Which tests were added.
Which tests passed.
Which tests failed.
Performance comparison with the old implementation.
Any remaining limitations.
Any architectural decisions that differ from this prompt and why.
Never fabricate:
test results
benchmarks
APIs
files
compiler behavior
browser behavior
compatibility
successful implementation details
Start with repository investigation.
Do not start coding immediately.
Study Vesk first, understand the existing architecture, then implement the smallest correct change that moves Vesk toward markerless structural hydration without compromising Vesk's compiler-first, zero-JS, statement-mode, or expression-mode principles.