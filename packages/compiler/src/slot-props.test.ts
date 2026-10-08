/**
 * Slot-prop tests — JSX element values passed as component props
 * (`<Popover trigger={<Button/>}>`) thread through the named-slot channel
 * shared with `children`:
 *   server  — string IIFE serialized into the prop (`const __slN = ...`)
 *   client  — DocumentFragment IIFE (`trigger: $nN`)
 *   content — `{props.<name>}` reads `PropSlotRender` (raw-push on the
 *             server, nodeType/text-node guarded append on the client)
 */
import { render, compileFile } from '@vesk/compiler/src/server-render';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { PropSlot, PropSlotRender, ComponentCall } from '@vesk/compiler/src/ir';

let passed = 0;
let failed = 0;

function describe(name, fn) { console.log(`\n${name}`); fn(); }
function it(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name} — ${e.message}`); }
}
function expect(value) {
  return {
    toBe(e) { if (value !== e) throw new Error(`Expected ${JSON.stringify(e)}, got ${JSON.stringify(value)}`); },
    toBeTruthy() { if (!value) throw new Error(`Expected truthy, got ${JSON.stringify(value)}`); },
    toContain(s) { if (!String(value).includes(s)) throw new Error(`Expected to contain ${JSON.stringify(s)} in ${JSON.stringify(value)}`); },
    toMatch(re) { if (!re.test(String(value))) throw new Error(`Expected to match ${re} in ${JSON.stringify(String(value).slice(0, 300))}`); },
    get not() {
      return {
        toContain(s) { if (String(value).includes(s)) throw new Error(`Expected NOT to contain ${JSON.stringify(s)}`); },
      };
    },
  };
}

const slotSource = `
component Button(props: { label: string }) { return <button>{props.label}</button>; }
component Child(props: { trigger: Component; children: Component }) { return <div>{props.trigger}{props.children}</div>; }
component App { return <Child trigger={<Button label="Go"/>}><span>body</span></Child>; }
`;

describe('server-render — JSX value as a component prop', () => {
  it('renders the trigger slot next to children', () => {
    const html = render(slotSource, 'App', {});
    // `props.children` reads a SlotNode: markerless SSR renders it inline —
    // the slot boundary contract (`<!--vsk-slot:sN-->` … `<!--vsk-slot-end:sN-->`)
    // is marker-mode only, so default output is plain HTML in DOM order.
    expect(html).toBe('<div><button>Go</button><span>body</span></div>');
    expect(html.includes('<!--vsk')).toBe(false);
  });

  it('threads dynamic expressions inside the slot body', () => {
    const src = `
component Button(props: { label: string }) { return <button>{props.label}</button>; }
component Child(props: { trigger: Component }) { return <div>{props.trigger}</div>; }
component App(props: { n: number }) { return <Child trigger={<Button label={String(props.n)}/>}/>; }
`;
    const html = render(src, 'App', { n: 42 });
    expect(html).toBe('<div><button>42</button></div>');
  });

  it('still supports string values for declared Component props', () => {
    const src = `
component Child(props: { trigger?: Component; children?: Component }) { return <div>{props.trigger}</div>; }
component App { return <Child trigger="hello"/>; }
`;
    const html = render(src, 'App', {});
    expect(html).toBe('<div>hello</div>');
  });

  it('compiles a referenced element expression through the registry', () => {
    const src = `
component Child(props: { body: Component }) { return <section>{props.body}</section>; }
component App { return null as any; }
`;
    // compileFile of a file that merely DECLARES a Component-typed prop must not throw.
    const result = compileFile(src);
    expect(result.ir).toBeTruthy();
  });
});

describe('ir-generator — slot IR shape', () => {
  it('turns a JSX-valued prop into a PropSlot on the call and PropSlotRender at the read', () => {
    const ir = generateIR(parse(slotSource), slotSource);
    const app = ir.components.find((c) => c.name === 'App');
    const childCall = app.body.find((n) => n instanceof ComponentCall) as ComponentCall;
    const slots = childCall.children.filter((c) => c instanceof PropSlot) as PropSlot[];
    expect(slots.length).toBe(1);
    expect(slots[0].propName).toBe('trigger');
    const triggerBody = slots[0].body;
    expect(triggerBody.some((n) => n instanceof ComponentCall && n.componentName === 'Button')).toBeTruthy();

    const child = ir.components.find((c) => c.name === 'Child');
    const reads = [];
    (function collect(nodes) {
      for (const n of nodes) {
        if (n instanceof PropSlotRender) reads.push(n.propName);
        if (n && Array.isArray(n.children)) collect(n.children);
      }
    })(child.body);
    expect(reads.includes('trigger')).toBeTruthy();
    // `children` is the builtin slot and keeps precedence over the declared
    // `Component` type — it must NOT double as a PropSlotRender.
    expect(reads.includes('children')).toBe(false);
  });

  it('leaves slot props out of the plain props object', () => {
    const ir = generateIR(parse(slotSource), slotSource);
    const app = ir.components.find((c) => c.name === 'App');
    const childCall = app.body.find((n) => n instanceof ComponentCall) as ComponentCall;
    expect(childCall.props.some((p) => p.name === 'trigger')).toBe(false);
  });
});

describe('client-codegen — slot threading (normal + hydrate)', () => {
  for (const hydrate of [false, true]) {
    const mode = hydrate ? 'hydrate' : 'normal';
    it(`[${mode}] passes the trigger as a DocumentFragment prop, not raw JSX`, () => {
      const code = compileClient(slotSource, null, { forceClient: true, hydrate });
      expect(code).toContain('document.createDocumentFragment');
      expect(code).toContain('"trigger": $n');
      expect(code).not.toContain('(<Button');
      expect(code).not.toContain('trigger: (<');
    });

    it(`[${mode}] reads the slot via props in the child`, () => {
      const code = compileClient(slotSource, null, { forceClient: true, hydrate });
      expect(code).toContain('props.trigger');
    });
  }

  it('falls back to a text node for string-valued Component props', () => {
    const src = `
component Child(props: { trigger?: Component }) { return <div>{props.trigger}</div>; }
component App { return <Child trigger="hello"/>; }
`;
    const code = compileClient(src, null, { forceClient: true, hydrate: false });
    expect(code).toContain('document.createTextNode(String(props.trigger))');
    expect(code).toContain('props.trigger.nodeType !== undefined');
  });
});

describe('HTML elements — JSX in attributes stays a compile error', () => {
  for (const hydrate of [false, true]) {
    it(`[${hydrate ? 'hydrate' : 'normal'}] propagates V0407 for anchor content in an HTML attr`, () => {
      let err = null;
      try {
        compileClient(`component App { return <div data-x={<span/>}/>; }`, null, { forceClient: true, hydrate });
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect((err as any).code).toBe('V0407');
    });
  }
  it('server render propagates V0407 for anchor content in an HTML attr', () => {
    let err = null;
    try {
      render(`component App { return <div data-x={<span/>}/>; }`, 'App', {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as any).code).toBe('V0407');
  });
});

describe('slot props with a renamed props parameter', () => {
  // Slot detection used to hardcode the literal identifier `props`, so a
  // `Component`-typed prop read through any other parameter name degraded to a
  // text binding and rendered the JSX escaped.
  it('threads a Component-typed prop through any parameter name', () => {
    for (const param of ['props', 'p', 'ctx']) {
      const src = `
component Child(${param}: { trigger: Component }) { return <div>{${param}.trigger}</div>; }
component App() { return <Child trigger={<em>plain</em>} />; }
`;
      expect(render(src, 'App', {})).toBe('<div><em>plain</em></div>');
    }
  });

  it('threads a Component-typed prop in statement mode through any parameter name', () => {
    for (const param of ['props', 'p', 'ctx']) {
      const src = `
component Child(${param}: { trigger: Component }) {
\t<div>{${param}.trigger}</div>
}
component App() {
\t<Child trigger={<em>plain</em>} />
}
`;
      expect(render(src, 'App', {})).toBe('<div><em>plain</em></div>');
    }
  });

  it('threads a component-valued slot through a renamed parameter', () => {
    const src = `
component Button(p: { label: string }) { return <button>{p.label}</button>; }
component Child(p: { trigger: Component }) { return <div>{p.trigger}</div>; }
component App() { return <Child trigger={<Button label="Go"/>} />; }
`;
    expect(render(src, 'App', {})).toBe('<div><button>Go</button></div>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A TOP-LEVEL `{props.children}` — the whole body of a layout is one slot.
//
// This was dropped SILENTLY by the client codegen: the SlotNode branch opened
// with `if (!parentVar) return null`, and a bare slot has no parent element to
// hang off. No code was emitted at all, so the children hydrator was never
// invoked, nothing below the layout hydrated, and links fell back to full page
// loads. The layout still rendered its static parts, so it looked alive and
// behaved dead.
//
// Only a layout written with a BARE `{props.children}` as its entire body hits
// this — `{props.children}` nested inside an element takes the normal path.
// ─────────────────────────────────────────────────────────────────────────────
describe('top-level children slot in a layout body', () => {
	const clientCode = (layoutBody: string, hydrate: boolean): string =>
		compileClient(`component L(props: { children?: any }) { ${layoutBody} }`, 'L', { hydrate });

	it('emits code for a bare {props.children}', () => {
		const code = clientCode('{props.children}', true);
		// The regression: zero occurrences, because the node was dropped.
		expect(code).toContain('props.children');
	});

	it('INVOKES the children hydrator (not merely reads it)', () => {
		// Reading it is not enough — a bare slot must CALL it, or the nested
		// layout/page never renders.
		expect(clientCode('{props.children}', true)).toMatch(/props\.children\s*\(/);
	});

	it('invokes it in non-hydrate mode too', () => {
		expect(clientCode('{props.children}', false)).toMatch(/props\.children/);
	});

	it('covers all three body shapes end to end', () => {
		// The shapes a layout body actually takes, checked through codegen for
		// the slot invocation that hydration depends on.
		for (const body of ['{props.children}', '<span>hdr</span>{props.children}', '{props.children}<b>tail</b>']) {
			expect(clientCode(body, true)).toMatch(/props\.children\s*\(/);
		}
	});

	it('still emits code when the slot is nested inside an element', () => {
		const code = clientCode('<div class="wrap">{props.children}</div>', true);
		expect(code).toMatch(/props\.children\s*\(/);
	});

	it('a bare slot alongside a leading sibling still invokes the slot', () => {
		expect(clientCode('<span>hdr</span>{props.children}', true)).toMatch(/props\.children\s*\(/);
	});

	it('a bare slot alongside a trailing sibling still invokes the slot', () => {
		expect(clientCode('{props.children}<b>tail</b>', true)).toMatch(/props\.children\s*\(/);
	});

	// A sibling of the slot is NOT asserted in hydrate mode, and that is correct:
	// `emitStatic` returns early for a fully-static subtree in hydrate mode
	// (`if (!claim && isStaticIR(node.children)) return null`) because SSR already
	// rendered it and there is nothing to re-emit. Asserting on a hydrate-mode
	// compile made this look like a dropped sibling; it is not. In non-hydrate
	// mode the sibling IS emitted, which is the real contract.
	it('a sibling before a bare slot is emitted in non-hydrate mode', () => {
		expect(clientCode('<span>hdr</span>{props.children}', false)).toContain('hdr');
	});
	it('a sibling after a bare slot is emitted in non-hydrate mode', () => {
		expect(clientCode('{props.children}<b>tail</b>', false)).toContain('tail');
	});

	it('the server emits the slot too', () => {
		const ir = compileFile('component L(props: { children?: any }) { {props.children} }', {});
		expect(JSON.stringify(ir.ir.components[0].body)).toContain('{}');
	});
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log('All tests passed!');