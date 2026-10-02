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
      "The reactive primitive: a cell you read, write and subscribe to — with a binding you use like a plain variable.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "track(init) creates a CELL: a box holding a value the compiler knows how to re-read. Nothing polls it, nothing diffs the DOM — a write notifies exactly the places that read the cell, and those places re-run. That is why the runtime you ship is small: reactivity is compile-time knowledge, not a subscription graph walked at render time.",
      },
      {
        kind: "p",
        text:
          "You almost never touch the cell itself. The &[ destructuring gives you a BINDING that you read and write like any other variable — count++, count = 5, count === 2 — and the compiler rewrites those into cell reads and writes for you.",
      },
      {
        kind: "code",
        filename: "app/counter/page.vsk",
        language: "vsk",
        code: `component Counter() {
  const &[count] = track(0)

  <p>Count: {count}</p>
  <button onClick={() => count++}>increment</button>
}`,
      },
      { kind: "h2", text: "The binding is the API" },
      {
        kind: "p",
        text:
          "Anything you can do to a variable, you can do to a tracked binding. There is no setter to call and no getter to remember.",
      },
      {
        kind: "table",
        head: ["You write", "It means"],
        rows: [
          ["count", "read — subscribes whatever expression it appears in"],
          ["count++", "read and write"],
          ["count = 5", "write"],
          ["count === 2", "read — reactive condition"],
          ["'/api/' + count", "read — reactive string building"],
        ],
      },
      {
        kind: "p",
        text:
          "The binding is deep. Once a tracked value holds an object or an array, mutating through it is a write — you do not have to reassign the whole thing.",
      },
      {
        kind: "code",
        filename: "app/user/page.vsk",
        language: "vsk",
        code: `component User() {
  const &[user] = track({ name: 'ada', hits: 0 })
  const &[tags] = track<string[]>([])

  const visit = () => {
    user.hits++
    tags.push('visit')
  }

  <button onClick={visit}>{user.name} — {user.hits} hits, {tags.length} tags</button>
}`,
      },
      { kind: "h2", text: "When you need the raw cell" },
      {
        kind: "p",
        text:
          "The second name in the pattern is the raw cell — an object, not a value. Ask for it when you are handing the CELL to something that cannot see a binding. Skip it otherwise: if you are only reading or writing, the binding is shorter and clearer.",
      },
      {
        kind: "code",
        filename: "app/counter/page.vsk",
        language: "vsk",
        code: `component Counter() {
  const &[count, countCell] = track(0)

  const bump = (cell: { get(): number; set(v: number): void }) => cell.set(cell.get() + 1)
  bump(countCell)

  <p>{count}</p>
}`,
      },
      {
        kind: "list",
        items: [
          "An API that takes a cell — useFetch({ into: cell }), createResource({ into: cell }). This is the main reason the raw cell exists.",
          "A helper that receives state as an argument — pass the cell, not the value, so the helper reads the CURRENT value instead of a snapshot taken when it was defined.",
          "Storing state in a structure — an array of setters, a map of cells, a callback queue. Each entry has to stay live rather than freeze at the value it held.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Passing the VALUE to a helper is the bug this prevents. const show = () => alert(count) captures count once; const show = () => alert(countCell.get()) always reads the current value.",
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "The second name is NOT a callable setter. setCount(5) throws — there is no setCount. Write count = 5, or countCell.set(5).",
      },
      { kind: "h2", text: "Initialising from props" },
      {
        kind: "code",
        filename: "app/counter/page.vsk",
        language: "vsk",
        code: `component Counter(props: { start: number }) {
  const &[count] = track(props.start)

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
  const &[name] = track('')
  const &[agree] = track(false)

  <label>
    <input value={name} onInput={(e) => name = e.target.value} />
  </label>
  <label>
    <input type="checkbox" checked={agree} onChange={() => agree = !agree} />
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
  const &[cart] = track<string[]>([])

  const add = (sku: string) => cart.push(sku)

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
          "Reading state without subscribing: peek / untrack — see get and set.",
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
  const &[items] = track([{ name: 'Vesk', price: 20 }])
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
  const &[items] = track([{ name: 'Vesk', price: 20 }])
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
  const &[tasks] = track([
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
          "A derived must stay PURE — and the runtime enforces it rather than trusting you. Writing any tracked value from inside a derived throws immediately: 'Assignments or updates to tracked values are not allowed during computed evaluation'. Fetching inside a derived is the subtler mistake: it does not throw, it just runs again on the next dependency change, so you ship a duplicate request. Derived computes; effect acts.",
      },
    ],
  },
  {
    slug: "get-set",
    title: "get and set",
    description:
      "Reaching past the binding to the raw cell: get, set, and the reads that deliberately do not subscribe.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "With a &[ binding you never need get or set — you read count and write count, and the compiler handles the cell. These are for the cases the binding cannot cover: a helper that was handed the CELL, an API that wants a cell, and reads that must NOT subscribe.",
      },
      { kind: "h2", text: "When you have a cell, get and set are explicit" },
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
      {
        kind: "p",
        text:
          "Notice that the markup still says {count} and the button still reads as a normal component. Once you have pulled out the cell, only the code that actually holds the cell uses get/set.",
      },
      { kind: "h2", text: "The four spellings" },
      {
        kind: "table",
        head: ["Spelling", "Where it works"],
        rows: [
          ["count", "Anywhere — markup, a handler, a helper. The normal way in and out."],
          ["count++ / count = v", "Anywhere. Sugar for the row above; prefer it."],
          ["countCell.set(v)", "Anywhere you hold the CELL — a component body, a handler, a helper called from either."],
          ["set(countCell, v)", "Anywhere you hold the CELL. Same thing, free-function form."],
          ["set(count, v)", "Only inside handlers and JSX, where the compiler rewrites it. As a bare statement in a component body it THROWS at render."],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "The last row is the one that bites, and it only happens when you mix the two styles. set(count, 5) on its own line in a component body reaches the runtime set unrewritten and takes the page down with 'Cannot read properties of undefined'. Write count = 5 instead — it is shorter and cannot get this wrong.",
      },
      { kind: "h2", text: "Untracked reads: peek and untrack" },
      {
        kind: "p",
        text:
          "Sometimes you want the CURRENT value without subscribing. peek(cell) reads it once; untrack(fn) runs a function with tracking off. Both are for code that should read state without becoming a reason to re-run.",
      },
      {
        kind: "code",
        filename: "app/log/page.vsk",
        language: "vsk",
        code: `component Log() {
  const &[count, countCell] = track(0)

  const bump = () => { count++ }

  // Read count right now, without the log re-rendering when count changes.
  const log = () => console.log('count is', peek(countCell))

  return <button onClick={() => { bump(); log() }}>{count}</button>
}`,
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "An untracked read is a SNAPSHOT. const logged = untrack(() => peek(countCell)) captures the value once, and {logged} in markup will never update — it is not a reactive binding. That is the point, but it means untracked reads belong in an event handler or a log, not in the template. If the template should follow the value, read the binding.",
      },
      {
        kind: "p",
        text:
          "untrack(fn) is the broader form: use it when a helper reads several cells and you only want some of them to subscribe.",
      },
      {
        kind: "code",
        filename: "app/report/page.vsk",
        language: "vsk",
        code: `component Report() {
  const &[rows] = track<string[]>([])
  const &[sortKey, sortKeyCell] = track('name')

  // Re-sorts when rows change, but NOT when sortKey changes — sortKey is only
  // read inside untrack, so it does not become a dependency.
  const sorted = derived(() => {
    const key = untrack(() => get(sortKeyCell))
    return [...rows].sort((a, b) => a.localeCompare(b, key))
  })

  <p>sort key: {sortKey}</p>
  <ul>
    for (const row of get(sorted)) {
      <li>{row}</li>
    }
  </ul>
}`,
      },
    ],
  },
  {
    slug: "effect",
    title: "effect",
    description:
      "Run a side effect when the cells it reads change — and nothing else. Client-only, ordered after render, cleaned up for you.",
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
  const &[query] = track('')
  const &[results] = track<string[]>([])

  effect(() => {
    const q = peek(query)
    if (q === '') {
      results = []
      return
    }
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then((r) => r.json())
      .then((data) => { results = data.items })
  })

  <input value={query} onInput={(e) => query = e.target.value} />
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
          "That peek is deliberate. Reading query with get inside the effect would make the effect depend on it — correct here, but worth knowing which read you are making. Use the plain binding when you DO want to subscribe, peek when you want the value without it.",
      },
      { kind: "h2", text: "Effects are client-only" },
      {
        kind: "p",
        text:
          "An effect body does NOT run during server rendering. On the server a component renders once, synchronously, to a string — there is no live graph to update and nothing to re-run, so effect bodies are skipped and the component renders with whatever the cells hold at that moment.",
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "This matters for data. Because the effect never runs on the server, the request it makes never happens during SSR, so its result cannot be in the HTML. Anything the FIRST paint needs has to come from useFetch or createResource, which do run on the server. If you put a fetch in an effect, the page arrives empty and fills in on the client.",
      },
      {
        kind: "p",
        text:
          "For work that genuinely belongs to the browser — a timer, a pointer listener, localStorage, the canvas API — being client-only is exactly right. Use {#client} if you need browser APIs during setup itself; reach for on_destroy when you only need teardown.",
      },
      { kind: "h2", text: "Ordering is guaranteed" },
      {
        kind: "p",
        text:
          "An effect is a block in the same tree as your render blocks, and a flush walks them in a fixed order: pre-effects, then render blocks, then effects. So by the time your effect runs, the DOM it is about to measure has already been updated. You never have to defer work to a microtask to be sure the markup exists.",
      },
      {
        kind: "code",
        filename: "app/measure/page.vsk",
        language: "vsk",
        code: `component Measure() {
  const &[label] = track('a fairly long label')
  const &[width] = track(0)
  let box: HTMLElement | null = null

  effect(() => {
    const text = peek(label)
    if (box === null) box = document.querySelector('[data-measure]')
    width = box.getBoundingClientRect().width
  })

  <div data-measure>{label}</div>
  <span>Measured {width}px</span>
}`,
      },
      { kind: "h2", text: "Cleanup is the return value" },
      {
        kind: "p",
        text:
          "Return a function from the effect body and the runtime calls it before the next run and again when the block is destroyed. You do not compare dependencies to decide whether to tear down — the block re-runs wholesale, so its teardown always runs first. This is the part that makes an effect a complete lifecycle primitive rather than a bare 'when this changes' hook.",
      },
      {
        kind: "code",
        filename: "app/clock/page.vsk",
        language: "vsk",
        code: `component Clock() {
  const &[now] = track(new Date())

  effect(() => {
    const handle = setInterval(() => { now = new Date() }, 1000)

    // Runs before each re-run, and when the component is destroyed.
    return () => clearInterval(handle)
  })

  <time>{now.toISOString()}</time>
}`,
      },
      {
        kind: "p",
        text:
          "For teardown that belongs to the component rather than to any particular effect run, on_destroy is the clearer spelling.",
      },
      {
        kind: "code",
        filename: "app/clock/page.vsk",
        language: "vsk",
        code: `component Clock() {
  const &[now] = track(new Date())

  on_destroy(() => clearInterval(handle))

  let handle: ReturnType<typeof setInterval> | null = null

  effect(() => {
    handle = setInterval(() => { now = new Date() }, 1000)
  })

  <time>{now.toISOString()}</time>
}`,
      },
      { kind: "h2", text: "How this compares" },
      {
        kind: "p",
        text:
          "Vesk borrows the good parts of a signal system — you never write a dependency array, and you never leave one behind when you add a new state read. Where it goes further is in what surrounds that.",
      },
      {
        kind: "table",
        head: ["", "React useEffect", "Vesk effect"],
        rows: [
          [
            "Dependencies",
            "A dependency array you maintain by hand, and a lint rule to police it",
            "Whatever the body reads. Add a read, and it is a dependency — no array, no lint, nothing to forget.",
          ],
          [
            "Teardown",
            "You diff the array yourself and decide whether to clean up",
            "Return a function. It runs before every re-run and on destroy. Nothing to decide.",
          ],
          [
            "Ordering vs. the DOM",
            "Effects are a separate pass; reading freshly rendered DOM needs care",
            "Render blocks run before effect blocks in the same flush, so the DOM is already current.",
          ],
          [
            "Server rendering",
            "Does not run on the server",
            "Does not run on the server — and useFetch / createResource are the SSR path, so the first paint does not wait on the client.",
          ],
          [
            "Re-runs",
            "Re-runs whenever the component re-renders and deps compare unequal",
            "Re-runs only when a cell it read changes. An unrelated write elsewhere in the tree cannot reach it.",
          ],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "That last row is the one that shows up in profiles. Because a write only walks the cells downstream of it, a keystroke in one input cannot re-run an effect on the other side of the page. In a VDOM system the component re-renders and your effect re-compares a list of dependencies to find that out.",
      },
      { kind: "h2", text: "What not to use it for" },
      {
        kind: "list",
        items: [
          "Fetching data the first paint needs — use useFetch or createResource. They run on the server; effects do not.",
          "Deriving a value — use derived. An effect that computes and writes a cell renders twice, and a derived that writes throws.",
          "Event handling — use onClick. An effect has no idea WHEN the user meant to act.",
          "Reading state once — use peek/untrack, so the code does not subscribe by accident.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Writing a cell the same effect also reads is allowed and does not hang: the effect re-runs once per flush until the condition settles. It is still almost always a logic error — an effect is for reacting to state, not for driving it.",
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
  const &[n] = track(0)

  // Two writes, then read the DOM: without flushSync the element still shows 0.
  const probe = () => {
    n++
    n++
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
  const &[hasMail] = track(false)

  <section>
    <Show when={hasMail} fallback={<p>No mail. All caught up.</p>}>
      <p>You have mail.</p>
    </Show>
    <button onClick={() => hasMail = !hasMail}>toggle</button>
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
  const &[items] = track<string[]>([])

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
  const &[tasks] = track([
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
  const &[tasks] = track([
    { id: 1, title: 'Write the docs' },
    { id: 2, title: 'Ship the release' },
  ])

  <ul>
    for (const task of tasks) {
      <li key={task.id}>{task.title}</li>
    }
  </ul>
  <button onClick={() => tasks = [...tasks].reverse()}>reverse</button>
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
  const &[tasks] = track(['Write the docs', 'Ship the release'])

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
  const &[state] = track('loading')

  <Switch fallback={<p>Unknown</p>}>
    <Match when={state === 'loading'}><p>Loading…</p></Match>
    <Match when={state === 'error'}><p>Something broke.</p></Match>
    <Match when={state === 'ready'}><p>Done.</p></Match>
  </Switch>
  <button onClick={() => state = 'ready'}>finish</button>
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