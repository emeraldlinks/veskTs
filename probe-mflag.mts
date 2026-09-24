import { compileClient } from '/root/vesk/packages/compiler/src/client-codegen.ts';

function show(label, src, opts = {}) {
  const code = compileClient(src, null, { hydrate: true, forceClient: true, ...opts });
  console.log('==== ' + label + ' ====');
  const lines = code.split('\n').filter(l => !l.trim().startsWith('import ') && !l.trim().startsWith('//'));
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('$n') || t.startsWith('__') || t.includes('nextElement') || t.includes('subWalker') || t.includes('claimOnly') || t.includes('__cl') || t.includes('__it') || t.includes('__slot') || t.includes('ref') || t.includes('createLayoutSlot') || t.startsWith('const __out'))
      console.log(t.slice(0, 160));
  }
}

show('fragment', `component App { return <><div>A</div><div>B</div></>; }`);
show('while', `component App {
	let n = 0;
	while (n < 3) { <span>{n}</span>; n = n + 1 }
}`);
show('slot', `component Layout(props) {
	return <main><div>{props.children}</div></main>;
}`);
show('ref', `component App {
	let inputEl;
	return <input ref={el => inputEl = el} />;
}`);
show('elseif', `component App {
	let &[target] = track("ssr")
	if (target === "ssr") {
		<p id="out">SSR</p>
	} else if (target === "web") {
		<p id="out">WEB</p>
	}
}`);