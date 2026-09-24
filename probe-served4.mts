import { compileFile } from '/root/vesk/packages/compiler/src/server-render.ts';
import { resetVskState, setVskHydrate } from '/root/vesk/packages/compiler/src/server-utils.ts';
import { writeFileSync } from 'node:fs';

const src = `import { Link } from '@vesk/runtime/router';
component App(props: { name: string }) {
	const &[n] = track(0);
	return <div><p>{props.name}</p><Link href="/">home {n}</Link></div>;
}`;

setVskHydrate(true);
resetVskState(true, true);
const compiled = compileFile(src);
setVskHydrate(false);

for (const [name, fn] of compiled.componentMap) {
  const js = fn.toString();
  writeFileSync(`/tmp/opencode/comp-${name}.js`, js);
  const m = js.match(/vsk:c[^\\n]*/g);
  console.log(name, 'markerLines:', m);
  const idx = js.indexOf('vsk:c');
  if (idx >= 0) console.log('  CTX:', js.slice(idx - 120, idx + 100).replace(/\n/g, ' '));
}