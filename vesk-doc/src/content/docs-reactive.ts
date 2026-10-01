type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

/**
 * One page per reactive primitive and per headless component.
 *
 * Every example here is rendered by packages/compiler/src/docs-examples.test.ts
 * on every CI run, so none of it can rot or quietly be wrong. Where the
 * framework's real behaviour differs from what you would guess, the page says
 * so — that is the point of splitting these out of `reactive-core`.
 */
export const pages: { slug: string; title: string; description: string; group: string; blocks: Block[] }[] = [
  {
    slug: "track",
    title: "track",
    description:
      "The reactive primitive: a cell you can read, write and subscribe to, plus the two names track() hands back.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "track(init) creates a CELL: a box holding a value the compiler knows how to re-read. Nothing polls it, nothing diffs the DOM — a write notifies exactly the places that read the cell, and those places re-run. That is why the runtime you ship is small: reactivity is compile-time knowledge, not a subscription graph walked at render time.",
      },
      {
        kind: "code",
        filename: "app/counter/page.vsk",
        language: "vsk",
        code: `component Counter() {
  const &[count, countCell] = track(0)

  <p>Count: {count}</p>
  <button onClick={() => countCell.set(count + 1)}>increment</button>
}`,
      },
      { kind: "h2", text: "The two names" },
      {
        kind: "p",
        text:
          "const &[value, cell] = track(init) destructures into the VALUE you render and the CELL you write. The value is what the compiler tracks: read it in markup or a handler and the surrounding code subscribes. The cell is the writer — cell.set(next) — and reading it is never tracked, which is what makes it safe to pass to helpers.",
      },
      {
        kind: "note",
        tone: "warn",
        text: "The second name is NOT a callable setter. setCount(5) throws. Use countCell.set(5).",
      },
      { kind: "h2", text: "Initialising from props" },
      {
        kind: "code",
        filename: "app/counter/page.vsk",
        language: "vsk",
        code: `component Counter(props: { start: number }) {
  const &[count, countCell] = track(props.start)

  <p>Starting at {count}</p>
}`,
      },
      { kind: "h2", text: "Many cells in one component" },
      {
        kind: "p",
        text:
          "Cells are independent. Writing one never touches another, and only the expressions that read that particular cell re-run.",
      },
      {
        kind: "code",
        filename: "app/form/page.vsk",
        language: "vsk",
        code: `component SignupForm() {
  const &[name, nameCell] = track('')
  const &[agree, agreeCell] = track(false)

  <label>
    <input value={name} onInput={(e) => nameCell.set(e.target.value)} />
  </label>
  <label>
    <input type="checkbox" checked={agree} onChange={() => agreeCell.set(!agree)} />
  </label>
  <button disabled={!agree || name === ''}>Continue</button>
}`,
      },
      { kind: "h2", text: "A cell can hold anything" },
      {
        kind: "code",
        filename: "app/shop/page.vsk",
        language: "vsk",
        code: `component Shop() {
  const &[cart, cartCell] = track<string[]>([])

  const add = (sku: string) => cartCell.set([...cart, sku])

  <button onClick={() => add('vesk-ts')}>Add</button>
  <p>{cart.length} in cart</p>
}`,
      },
      { kind: "h2", text: "When to reach for something else" },
      {
        kind: "list",
        items: [
          "A value that should be computed, not stored: derived.",
          "Work that should happen when a value changes: effect.",
          "A value derived from props that never changes at runtime: a plain const is fine, and cheaper.",
        ],
      },
    ],
  },
  {
    slug: "derived",
    title: "derived",
    description:
      "A computed cell: recomputes only when something it reads changes, and reads like a plain value once unwrapped.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "derived(fn) creates a cell whose value is computed from other cells. It is lazy and cached: nothing runs until the cell is read, and a read recomputes only when a dependency actually changed. Use it for values that are DERIVED — a total, a filtered list, a formatted string — never for values that are owned.",
      },
      {
        kind: "code",
        filename: "app/cart/page.vsk",
        language: "vsk",
        code: `component Cart() {
  const &[items, itemsCell] = track([{ name: 'Vesk', price: 20 }])
  const total = derived(() => items.reduce((sum, i) => sum + i.price, 0))

  <p>Total: {get(total)}</p>
}`,
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "Read a derived cell with get(...). Printing the cell itself renders [object Object] — a derived cell is a cell, not a value, and the compiler does not unwrap it in markup the way it unwraps a track() binding.",
      },
      { kind: "h2", text: "Chaining" },
      {
        kind: "p",
        text:
          "A derived can read another derived. Dependencies are tracked through the chain, so a change at the root updates everything downstream exactly once.",
      },
      {
        kind: "code",
        filename: "app/cart/page.vsk",
        language: "vsk",
        code: `component Cart() {
  const &[items, itemsCell] = track([{ name: 'Vesk', price: 20 }])
  const total = derived(() => items.reduce((sum, i) => sum + i.price, 0))
  const withTax = derived(() => get(total) * 1.2)

  <p>Total: {get(total)} — with tax: {get(withTax)}</p>
}`,
      },
      { kind: "h2", text: "With object and array members" },
      {
        kind: "code",
        filename: "app/list/page.vsk",
        language: "vsk",
        code: `component TaskList() {
  const &[tasks, tasksCell] = track([
    { id: 1, title: 'Write docs', done: false },
    { id: 2, title: 'Ship it', done: false },
  ])

  const open = derived(() => tasks.filter((t) => !t.done))

  <ul>
    for (const task of get(open)) {
      <li>{task.title}</li>
    }
  </ul>
}`,
      },
      {
        kind: "note",
        tone: "info",
        text:
          "A derived must stay PURE. It may run more than once for one change (any write re-runs what depends on it), so it must not write, fetch, or mutate anything outside itself. Side effects belong in effect.",
      },
    ],
  },
  {
    slug: "get-set",
    title: "get and set",
    description:
      "Reading and writing cells by hand, and the four rules about which spelling works where.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Inside handlers and other functions you often deal in cells rather than values, and get/set are the explicit forms. The compiler rewrites them for you inside JSX and event handlers; outside those positions it does not, which is where the surprising failures come from.",
      },
      { kind: "h2", text: "Reading: get(cell)" },
      {
        kind: "code",
        filename: "app/counter/page.vsk",
        language: "vsk",
        code: `component Counter() {
  const &[count, countCell] = track(1)

  const bump = () => {
    const next = get(countCell) + 1
    countCell.set(next)
  }

  <button onClick={bump}>{count}</button>
}`,
      },
      { kind: "h2", text: "The four rules" },
      {
        kind: "table",
        head: ["Spelling", "Where it works"],
        rows: [
          ["cell.set(v)", "Anywhere — a component body, a handler, a helper called from either."],
          ["set(cell, v)", "Anywhere, when you pass the CELL (the second destructured name)."],
          ["set(cellName, v)", "Only inside handlers and JSX, where the compiler rewrites it. As a bare statement in a component body it THROWS at render."],
          ["setCount(v)", "Never — the second destructured name is not a callable setter."],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "The third row is the one that bites. set(count, 5) on its own line in a component body reaches the runtime set unrewritten and takes the page down with 'Cannot read properties of undefined'. Either write it inside a handler, or use the cell: countCell.set(5).",
      },
      { kind: "h2", text: "Untracked reads: untrack and peek" },
      {
        kind: "p",
        text:
          "Sometimes you want the CURRENT value without subscribing. peek(cell) reads the value; untrack(fn) runs a function with tracking off. Both are for reading state in code that should not re-run.",
      },
      {
        kind: "code",
        filename: "app/log/page.vsk",
        language: "vsk",
        code: `component Log() {
  const &[entries, entriesCell] = track<string[]>([])
  const &[count, countCell] = track(0)

  // Read the current count to LOG it, without subscribing the log to it.
  const logged = untrack(() => peek(countCell))

  <p>Logged at {logged}</p>
}`,
      },
    ],
  },
  {
    slug: "effect",
    title: "effect",
    description:
      "Run a side effect when the cells it reads change — and nothing else.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "effect(fn) runs fn once, then re-runs it when any cell it READS changes, and not otherwise. It is the only place side effects belong: the body is not re-executed on unrelated renders, so you never fetch twice or log in a loop by accident.",
      },
      {
        kind: "code",
        filename: "app/search/page.vsk",
        language: "vsk",
        code: `component Search() {
  const &[query, queryCell] = track('')
  const &[results, resultsCell] = track<string[]>([])

  effect(() => {
    const q = get(queryCell)
    if (q === '') {
      resultsCell.set([])
      return
    }
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then((r) => r.json())
      .then((data) => resultsCell.set(data.items))
  })

  <input value={query} onInput={(e) => queryCell.set(e.target.value)} />
  <ul>
    for (const item of results) {
      <li>{item}</li>
    }
  </ul>
}`,
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Cells READ inside the effect are its dependencies. Writing a cell that the same effect also reads is an infinite loop — the framework will not stop you, because that is a logic error, not a framework one.",
      },
      { kind: "h2", text: "Side effects run on the server too" },
      {
        kind: "p",
        text:
          "An effect body also runs during SSR, once, with whatever the cells hold at that moment. That is usually what you want for a fetch — the data lands in the hydration handoff — and is why useFetch exists as a shorthand for the common case.",
      },
      { kind: "h2", text: "Cleaning up" },
      {
        kind: "p",
        text:
          "If the effect sets up something that must be torn down — an interval, a subscription, a listener — return the cleanup or pair it with on_destroy.",
      },
      {
        kind: "code",
        filename: "app/clock/page.vsk",
        language: "vsk",
        code: `component Clock() {
  const &[now, nowCell] = track(new Date())

  on_destroy(() => {
    if (handle !== null) clearInterval(handle)
  })

  let handle: ReturnType<typeof setInterval> | null = null

  effect(() => {
    if (handle !== null) clearInterval(handle)
    handle = setInterval(() => nowCell.set(new Date()), 1000)
  })

  <time>{now.toISOString()}</time>
}`,
      },
      { kind: "h2", text: "What not to use it for" },
      {
        kind: "list",
        items: [
          "Deriving a value — use derived. An effect that computes and writes a cell renders twice.",
          "Event handling — use onClick. An effect has no idea WHEN the user meant to act.",
          "Reading state once — use peek/untrack, so the code does not subscribe by accident.",
        ],
      },
    ],
  },
  {
    slug: "scheduler",
    title: "Scheduler",
    description:
      "When writes actually reach the DOM: flushSync, tick, and what batches for you.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Writes are batched. Several cell writes in one turn become one update pass, so a render is never half-applied. That is almost always invisible — and occasionally not, which is what these two are for.",
      },
      {
        kind: "table",
        head: ["Call", "Does"],
        rows: [
          ["flushSync()", "Applies every pending write immediately and synchronously. Returns once the DOM is up to date."],
          ["tick()", "Yields to the microtask queue so pending updates land, without forcing a synchronous flush mid-expression."],
        ],
      },
      {
        kind: "code",
        filename: "app/probe/page.vsk",
        language: "vsk",
        code: `component Probe() {
  const &[n, nCell] = track(0)

  // Two writes, then read the DOM: without flushSync the element still shows 0.
  const probe = () => {
    nCell.set(get(nCell) + 1)
    nCell.set(get(nCell) + 1)
    flushSync()
    const el = document.querySelector('#probe')
    console.log(el ? el.textContent : 'not on the server')
  }

  <span id="probe">{n}</span>
  <button onClick={probe}>run</button>
}`,
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "Do not reach for flushSync by reflex. It forces a synchronous DOM pass, which costs a layout flush and can hide ordering bugs. Reach for it when you genuinely must observe the DOM right after a write — measuring, focusing, or driving an imperative API.",
      },
      {
        kind: "p",
        text:
          "On the server there is no scheduler to flush: SSR renders once, in order, and flushSync() is a no-op. The example above still renders — it simply logs nothing, because document does not exist.",
      },
    ],
  },
  {
    slug: "show",
    title: "Show",
    description:
      "Render one branch or another with no wrapper element — the conditional that costs no DOM node.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Show renders its children when the condition is truthy and fallback when it is not. Unlike an if block it is a COMPONENT, so it composes: you can pass it to a helper, put it anywhere in markup, and it renders no element of its own.",
      },
      {
        kind: "code",
        filename: "app/inbox/page.vsk",
        language: "vsk",
        code: `component Inbox() {
  const &[hasMail, hasMailCell] = track(false)

  <section>
    <Show when={hasMail} fallback={<p>No mail. All caught up.</p>}>
      <p>You have mail.</p>
    </Show>
    <button onClick={() => hasMailCell.set(!hasMail)}>toggle</button>
  </section>
}`,
      },
      { kind: "h2", text: "Any condition" },
      {
        kind: "p",
        text:
          "when takes the expression, not just a boolean: a comparison, a lookup, a length. Anything the compiler can track works, and the branch re-renders when it changes.",
      },
      {
        kind: "code",
        filename: "app/inbox/page.vsk",
        language: "vsk",
        code: `component Inbox() {
  const &[items, itemsCell] = track<string[]>([])

  <Show when={items.length > 0} fallback={<p>Inbox empty.</p>}>
    <p>{items.length} message(s)</p>
  </Show>
}`,
      },
      { kind: "h2", text: "No fallback means nothing" },
      {
        kind: "p",
        text:
          "Without a fallback prop the false branch renders nothing at all — the usual choice when the surrounding layout already reserves the space.",
      },
      { kind: "h2", text: "Show or an if block?" },
      {
        kind: "table",
        head: ["Use", "When"],
        rows: [
          ["an if block", "Branching inside a component body, especially with else-if chains. Statement mode, and the compiler can reason about the branches."],
          ["Show", "You want the conditional as a VALUE — passing it to a helper, or storing it. It also nests cleanly in expression position."],
        ],
      },
    ],
  },
  {
    slug: "for",
    title: "Lists and For",
    description:
      "Rendering lists server-side with the native for loop, what the For component does, and the gap you should know about.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "There are two list forms and they are not interchangeable today. The NATIVE for loop in statement mode works everywhere, including SSR, and it is what the framework is built around: the compiler turns it into a keyed region that reconciles by identity instead of diffing the list.",
      },
      {
        kind: "code",
        filename: "app/tasks/page.vsk",
        language: "vsk",
        code: `component Tasks() {
  const &[tasks, tasksCell] = track([
    { id: 1, title: 'Write the docs' },
    { id: 2, title: 'Ship the release' },
  ])

  <ul>
    for (const task of tasks) {
      <li>{task.title}</li>
    }
  </ul>
}`,
      },
      {
        kind: "p",
        text:
          "A for body is a REGION: it re-renders on its own when the list changes, and rows are adopted by identity (see Keyed Reconciliation). Give it a key when order can change and identity matters.",
      },
      {
        kind: "code",
        filename: "app/tasks/page.vsk",
        language: "vsk",
        code: `component Tasks() {
  const &[tasks, tasksCell] = track([
    { id: 1, title: 'Write the docs' },
    { id: 2, title: 'Ship the release' },
  ])

  <ul>
    for (const task of tasks) {
      <li key={task.id}>{task.title}</li>
    }
  </ul>
  <button onClick={() => tasksCell.set([...tasks].reverse())}>reverse</button>
}`,
      },
      { kind: "h2", text: "The For component" },
      {
        kind: "p",
        text:
          "For is the expression-position form, for when the list is handed to a helper rather than written out as a loop.",
      },
      {
        kind: "code",
        filename: "app/tasks/page.vsk",
        language: "vsk",
        code: `// @client-only — see the gap below: For does not render rows during SSR
component Tasks() {
  const &[tasks, tasksCell] = track(['Write the docs', 'Ship the release'])

  const renderRow = (item: string) => <li>{item}</li>

  <ul>
    <For each={tasks}>{renderRow}</For>
  </ul>
}`,
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "Known gap, measured rather than guessed. Today For does NOT render its rows during SSR: a child that returns JSX makes server rendering throw ('Unexpected token <', because the codegen emits the arrow body verbatim instead of lowering it), and a child that returns a string renders an empty list. It works on the client. For anything that must be server-rendered, use the native for loop above.",
      },
      {
        kind: "p",
        text:
          "This is a compiler bug, not a design limit — the emitted server code keeps the raw arrow source instead of lowering it the way the client codegen does. It is tracked in TODO.md with a reproducer, and this page will change when it lands.",
      },
    ],
  },
  {
    slug: "switch-match",
    title: "Switch and Match",
    description:
      "First-match branching with components instead of else-if chains.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Switch picks the FIRST Match whose condition is truthy, and renders fallback when none match. It is the component form of an else-if chain: the cases read as a table, the order is explicit, and the whole thing is one value you can pass to a helper.",
      },
      {
        kind: "code",
        filename: "app/status/page.vsk",
        language: "vsk",
        code: `component Status(props: { state: string }) {
  <Switch fallback={<p class="unknown">Unknown</p>}>
    <Match when={props.state === 'loading'}><p>Loading…</p></Match>
    <Match when={props.state === 'error'}><p class="err">Something broke.</p></Match>
    <Match when={props.state === 'ready'}><p>All done.</p></Match>
  </Switch>
}`,
      },
      {
        kind: "note",
        tone: "info",
        text: "Order is the whole point: Switch takes the first match, so put the most specific cases first.",
      },
      { kind: "h2", text: "Driven by a cell" },
      {
        kind: "p",
        text:
          "when is a normal tracked expression, so switching cases re-renders the branch that changed — and only that branch.",
      },
      {
        kind: "code",
        filename: "app/status/page.vsk",
        language: "vsk",
        code: `component Status() {
  const &[state, stateCell] = track('loading')

  <Switch fallback={<p>Unknown</p>}>
    <Match when={state === 'loading'}><p>Loading…</p></Match>
    <Match when={state === 'error'}><p>Something broke.</p></Match>
    <Match when={state === 'ready'}><p>Done.</p></Match>
  </Switch>
  <button onClick={() => stateCell.set('ready')}>finish</button>
}`,
      },
      { kind: "h2", text: "No fallback" },
      {
        kind: "p",
        text:
          "Without a fallback, a Switch where nothing matches renders nothing — the right default for a switch that is meant to be exhaustive.",
      },
    ],
  },
];