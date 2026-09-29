# Testing components

`@vesk/testing` is a component harness: no server, no browser, no hand-written
DOM shim.

```bash
npm i -D @vesk/testing
```

```ts
import { mount, renderComponent } from '@vesk/testing';

const source = `
  component Counter(props: { start: number }) {
    const &[count, setCount] = track(props.start)
    <p class="label">{count}</p>
    <button class="bump" onclick={() => setCount(count + 1)}>bump</button>
  }
`;

// 1. Assert the server output. No server, no browser, milliseconds.
const { html, head } = renderComponent(source, 'Counter', { start: 1 });
expect(html).toContain('class="label"');
expect(html).toContain('>1<');

// 2. Or mount it in a real DOM and drive it.
const view = mount(source, 'Counter', { start: 1 });
expect(view.text('.label')).toBe('1');
expect(view.has('.bump')).toBe(true);
await view.click('.bump');
view.unmount();
```

## What you get

| | |
|---|---|
| `renderComponent(source, name?, props?, opts?)` | `{ html, head, props }` — compiles and SSRs. Throws the compiler's own diagnostic (code frame included) when the source does not compile, so a broken fixture reads like a compile error rather than an empty string. |
| `mount(source, name?, props?, opts?)` | a driver over a real DOM (linkedom) with `text`, `attr`, `has`, `all`, `click`, `input`, `flush`, `waitFor`, `unmount`. |
| `attrOf(html, selector, attribute)` | read a head/attribute out of a fragment, decoded the way a browser would. |

`hydrate: false` renders the non-hydrate mode, which is a different emitter
(markerless SSR) and therefore a different assertion.

## What it is not

`mount` does not boot a browser: there is no real layout, no service worker, no
network layer, and no layout thrash. That is on purpose — it is the assertion
90% of component tests want, and it runs in milliseconds. Anything that
genuinely needs a browser (hydration against a live page, click-through
navigation, viewport behaviour) still belongs in `tests/hydration-test.mjs`
against a running server.

`unmount()` restores the ambient `document`/`window`/`Event`/`Node`, so mounts do
not leak into each other inside one test file.
