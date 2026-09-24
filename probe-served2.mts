import { resetVskState, setVskMarkerless, __vskMarkerless } from '/root/vesk/test-app/node_modules/@vesk/compiler/dist/server-utils.js';
import { compileFile } from '/root/vesk/test-app/node_modules/@vesk/compiler/dist/server-codegen.js';
import { setVskHydrate } from '/root/vesk/test-app/node_modules/@vesk/compiler/dist/server-utils.js';

const src = `import { Link } from '@vesk/runtime/router';
component App(props: { name: string }) {
	const &[n] = track(0);
	return <div><p>{props.name}</p><Link href="/">home {n}</Link></div>;
}`;

setVskHydrate(true);
resetVskState(true, true);
console.log('markerless flag after reset:', __vskMarkerless);
const compiled = compileFile(src);
setVskHydrate(false);
console.log('keys:', Object.keys(compiled));
const serverJs = compiled.serverJs || compiled.js || compiled.code || JSON.stringify(compiled);
const m = (serverJs.match(/^.*vsk:c.*$/gm) || []);
console.log('vsk:c lines:', m);
const idx = serverJs.indexOf('vsk:c');
if (idx >= 0) console.log('CONTEXT:', serverJs.slice(idx - 200, idx + 120).replace(/\n/g, ' '));