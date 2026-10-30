(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const __vesk_md_0 = "# Getting started\n\nCreate a page:\n\n```vsk\ncomponent About {\n\t<h1>About</h1>\n}\n```\n\n- zero config\n- instant HMR";
const featureDoc = `# Markdown in Vesk

Rendered by the tokenizer-based \`<Md>\` component — no regex, everything
escaped, raw HTML never leaks through.

This page exercises the advanced pipeline: GFM tables, task lists,
syntax-highlighted code with a copy button, heading anchors, autolinks
and hard breaks.

## Task list

- [x] tables with column alignment
- [x] fenced code highlighting (12+ languages)
- [x] copy button on code blocks
- [ ] footnotes (planned)
- [ ] math blocks (needs KaTeX)

## Languages

### TypeScript

\`\`\`ts
interface Post {
	id: number;
	title: string;
}

async function getPost(id: number): Promise<Post | null> {
	const res = await fetch(\`/api/posts/\${id}\`);
	if (!res.ok) return null;
	return res.json();
}
\`\`\`

### Python

\`\`\`python
def fib(n: int):
	a, b = 0, 1
	for _ in range(n):
		yield a
		a, b = b, a + b

print(list(fib(10)))  # [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
\`\`\`

### Bash + CSS

\`\`\`bash
# build all packages and run the dev server
npm run build --workspaces
npm run dev -- --port 3000
\`\`\`

\`\`\`css
.vesk-md .md-code-bar {
	display: flex;
	justify-content: space-between; /* badge left, copy right */
	background: #21262d;
}
\`\`\`

### Diff

\`\`\`diff
+ renderMarkdown(md, { highlight: true })
- markdown(md)
@@ md.ts @@
\`\`\`

## Theming

Per-block background/text color right in the fence info string
(hex, names, rgb() all work; \`bg=none\` goes flat):

\`\`\`js bg=none
// no background — blends into the page
flat();
\`\`\`

\`\`\`ts bg=#0b1220 fg=#7dd3fc
const dark = "mode";
\`\`\`

Component-wide defaults: use props on the component \u2014 set codeBg/codeFg
(or theme=\"dark\") and every block inherits them. Fence params always win.

## Tables
 
| Feature | Status | Since |
|:--------|:------:|------:|
| tables | shipped | v0.2 |
| task lists | shipped | v0.2 |
| footnotes | planned | — |

Inline markup works in cells too: \`code\`, **bold**, *italic*.

## Lists

5. ordered lists can start at any number
6. like this one — see the \`start\` attribute
7. and keep counting

- nested structures
  - blockquotes inside lists
    > quoting works anywhere
- autolinks: bare URLs like https://github.com/emeraldlinks/veskTs become links

## Anchors & breaks

Every heading gets a slug \`id\` so you can deep-link to it.
Line one ends here with two spaces
and line two follows after a hard break.
`;
const lineNumbersDoc = `\`\`\`ts
import { Md } from '@vesk/runtime';

// line numbers are pure CSS counters — no extra DOM columns
export function demo(): string[] {
	const out: string[] = [];
	for (let i = 0; i < 3; i++) {
		out.push(\`line \${i + 1}\`);
	}
	return out;
}
\`\`\`
`;
const presets = [
	{ id: 'table', label: 'Tables', md: '| Feature | Status |\n|:--------|-------:|\n| aligned left | right |\n| `code` in cells | **bold** |' },
	{ id: 'tasks', label: 'Tasks', md: '- [x] ship renderer\n- [ ] write docs\n- [ ] add footnotes' },
	{ id: 'diff', label: 'Diff', md: '```diff\n+ added in this release\n- removed legacy path\n  unchanged context\n```' },
];


__components["MdPage"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const presetIndex = track(0);
const live = track('# Live preview\n\nType markdown below.\n');
function setPreset(i) {
	set(presetIndex, i);
}
document.title = "Md — advanced markdown rendering";
const $n2616280207000000 = document.createElement("h1");
$n2616280207000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n2616280207000001 = document.createTextNode("Markdown Demo");
$n2616280207000000.appendChild($n2616280207000001);
	$root.appendChild($n2616280207000000);
const $n2616280207000002 = document.createElement("p");
$n2616280207000002.setAttribute("class", "text-gray-600 mb-6");
const $n2616280207000003 = document.createTextNode(" Tokenizer-based rendering — tables, task lists, highlighted code, copy buttons, anchors, autolinks. Everything escaped; zero regex. ");
$n2616280207000002.appendChild($n2616280207000003);
	$root.appendChild($n2616280207000002);
const $n2616280207000004 = document.createElement("section");
$n2616280207000004.setAttribute("class", "mb-10");
const $n2616280207000005 = toDomNode(Md({ "content": featureDoc, "css": true }));
$n2616280207000004.appendChild($n2616280207000005);
	$root.appendChild($n2616280207000004);
const $n2616280207000006 = document.createElement("div");
$n2616280207000006.setAttribute("class", "mt-8 border-t border-gray-200 pt-6");
const $n2616280207000007 = document.createElement("h2");
$n2616280207000007.setAttribute("class", "text-xl font-semibold mb-3");
const $n2616280207000008 = document.createTextNode("Line numbers (CSS counters)");
$n2616280207000007.appendChild($n2616280207000008);
$n2616280207000006.appendChild($n2616280207000007);
const $n2616280207000009 = toDomNode(Md({ "content": lineNumbersDoc, "css": true, "lineNumbers": true }));
$n2616280207000006.appendChild($n2616280207000009);
	$root.appendChild($n2616280207000006);
const $n2616280207000010 = document.createElement("div");
$n2616280207000010.setAttribute("class", "mt-8 border-t border-gray-200 pt-6");
const $n2616280207000011 = document.createElement("h2");
$n2616280207000011.setAttribute("class", "text-xl font-semibold mb-3");
const $n2616280207000012 = document.createTextNode("Samples");
$n2616280207000011.appendChild($n2616280207000012);
$n2616280207000010.appendChild($n2616280207000011);
const $n2616280207000013 = document.createElement("h3");
$n2616280207000013.setAttribute("class", "font-semibold mb-2");
const $n2616280207000014 = document.createTextNode("Tables");
$n2616280207000013.appendChild($n2616280207000014);
$n2616280207000010.appendChild($n2616280207000013);
const $n2616280207000015 = toDomNode(Md({ "content": presets[0].md }));
$n2616280207000010.appendChild($n2616280207000015);
const $n2616280207000016 = document.createElement("h3");
$n2616280207000016.setAttribute("class", "font-semibold mb-2 mt-6");
const $n2616280207000017 = document.createTextNode("Tasks");
$n2616280207000016.appendChild($n2616280207000017);
$n2616280207000010.appendChild($n2616280207000016);
const $n2616280207000018 = toDomNode(Md({ "content": presets[1].md }));
$n2616280207000010.appendChild($n2616280207000018);
const $n2616280207000019 = document.createElement("h3");
$n2616280207000019.setAttribute("class", "font-semibold mb-2 mt-6");
const $n2616280207000020 = document.createTextNode("Diff");
$n2616280207000019.appendChild($n2616280207000020);
$n2616280207000010.appendChild($n2616280207000019);
const $n2616280207000021 = toDomNode(Md({ "content": presets[2].md }));
$n2616280207000010.appendChild($n2616280207000021);
	$root.appendChild($n2616280207000010);
const $n2616280207000022 = document.createElement("div");
$n2616280207000022.setAttribute("class", "mt-8 border-t border-gray-200 pt-6");
const $n2616280207000023 = document.createElement("h2");
$n2616280207000023.setAttribute("class", "text-xl font-semibold mb-3");
const $n2616280207000024 = document.createTextNode("From a file");
$n2616280207000023.appendChild($n2616280207000024);
$n2616280207000022.appendChild($n2616280207000023);
const $n2616280207000025 = document.createElement("p");
$n2616280207000025.setAttribute("class", "text-gray-500 text-sm mb-3");
const $n2616280207000026 = document.createTextNode(" Pass a path instead of markdown — relative to this page or from /public: ");
$n2616280207000025.appendChild($n2616280207000026);
$n2616280207000022.appendChild($n2616280207000025);
const $n2616280207000027 = toDomNode(Md({ "content": __vesk_md_0 }));
$n2616280207000022.appendChild($n2616280207000027);
	$root.appendChild($n2616280207000022);
const $n2616280207000028 = document.createElement("div");
$n2616280207000028.setAttribute("class", "mt-8 border-t border-gray-200 pt-6");
const $n2616280207000029 = document.createElement("h2");
$n2616280207000029.setAttribute("class", "text-xl font-semibold mb-3");
const $n2616280207000030 = document.createTextNode("Live editing");
$n2616280207000029.appendChild($n2616280207000030);
$n2616280207000028.appendChild($n2616280207000029);
const $n2616280207000031 = document.createElement("textarea");
$n2616280207000031.setAttribute("rows", "5");
$n2616280207000031.setAttribute("class", "w-full font-mono text-sm border border-gray-300 rounded p-3 mb-4");
$n2616280207000031.__evh_input = (e) => {
	set(live, e.target.value);
};
$n2616280207000031.setAttribute('data-vsk-ev', '');
$n2616280207000028.appendChild($n2616280207000031);
const $n2616280207000032 = document.createElement("p");
$n2616280207000032.setAttribute("class", "text-gray-500 text-sm mb-2");
const $n2616280207000033 = document.createTextNode(" Raw preview (reactive). Tip: close your ");
$n2616280207000032.appendChild($n2616280207000033);
const $n2616280207000034 = document.createElement("code");
const $n2616280207000035 = document.createTextNode("\\`\\`\\`");
$n2616280207000034.appendChild($n2616280207000035);
$n2616280207000032.appendChild($n2616280207000034);
const $n2616280207000036 = document.createTextNode(" fences — an open fence turns everything below it into one code block. ");
$n2616280207000032.appendChild($n2616280207000036);
$n2616280207000028.appendChild($n2616280207000032);
const $n2616280207000037 = document.createElement("pre");
$n2616280207000037.setAttribute("class", "bg-gray-100 rounded p-3 text-xs whitespace-pre-wrap");
const $n2616280207000038 = document.createTextNode('');
$n2616280207000037.appendChild($n2616280207000038);
$n2616280207000028.appendChild($n2616280207000037);
const $n2616280207000039 = document.createElement("p");
$n2616280207000039.setAttribute("class", "text-gray-400 text-xs mt-2");
const $n2616280207000040 = document.createTextNode(" Full per-keystroke markdown re-render lands with the reactive-props pass. ");
$n2616280207000039.appendChild($n2616280207000040);
$n2616280207000028.appendChild($n2616280207000039);
const $n2616280207000041 = toDomNode(Md({ "content": live }));
$n2616280207000028.appendChild($n2616280207000041);
	$root.appendChild($n2616280207000028);
	effect(() => { const __v = get(live); $n2616280207000038.data = __v == null ? '' : String(__v); });
	if (!document.__vesk_dlg_input) {
		document.__vesk_dlg_input = true;
		document.addEventListener("input", (e) => {
			var el = e.target;
			if (el && el.nodeType !== 1) el = el.parentElement;
			while (el && el.nodeType === 1) {
				if (el.__evh_input) { el.__evh_input(e); break; }
				el = el.parentElement;
			}
		});
	}
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["MdPage"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const presetIndex = track(0);
const live = track('# Live preview\n\nType markdown below.\n');
let $n2616280207000042 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
function setPreset(i) {
	set(presetIndex, i);
}
document.title = "Md — advanced markdown rendering";
const $n2616280207000045 = __hydrate.nextElement("section", $n2616280207000042 + 2);
$n2616280207000042 = 0;
$n2616280207000045.setAttribute("class", "mb-10");
const $n2616280207000046 = __hydrate.subWalker($n2616280207000045);
let $n2616280207000047 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2616280207000047 = toDomNode(Md({ "content": featureDoc, "css": true }, __registry, $n2616280207000046)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2616280207000046.retireDetached();
if ($n2616280207000047.parentNode !== $n2616280207000045) { if (!$n2616280207000045 || $n2616280207000047.parentNode == null || !$n2616280207000045.contains($n2616280207000047)) $n2616280207000045.appendChild($n2616280207000047); }
	if ($mount === null) $mount = $n2616280207000045;
	if ($n2616280207000045 !== $mount && $n2616280207000045.parentNode == null) $mount.appendChild($n2616280207000045);
const $n2616280207000048 = __hydrate.nextElement("div", 0);
$n2616280207000048.setAttribute("class", "mt-8 border-t border-gray-200 pt-6");
const $n2616280207000049 = __hydrate.subWalker($n2616280207000048);
const $n2616280207000052 = $n2616280207000048.__vsk_ssrEls ? $n2616280207000048.__vsk_ssrEls[0] : (() => {
	const $n2616280207000050 = document.createElement("h2");
	$n2616280207000050.setAttribute("class", "text-xl font-semibold mb-3");
	const $n2616280207000051 = document.createTextNode("Line numbers (CSS counters)");
	$n2616280207000050.appendChild($n2616280207000051);
	return $n2616280207000050;
})();
if ($n2616280207000052.parentNode !== $n2616280207000048) { if (!$n2616280207000048 || $n2616280207000052.parentNode == null || !$n2616280207000048.contains($n2616280207000052)) $n2616280207000048.appendChild($n2616280207000052); }
$n2616280207000049.injectSkipK(1);
let $n2616280207000053 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2616280207000053 = toDomNode(Md({ "content": lineNumbersDoc, "css": true, "lineNumbers": true }, __registry, $n2616280207000049)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2616280207000049.retireDetached();
if ($n2616280207000053.parentNode !== $n2616280207000048) { if (!$n2616280207000048 || $n2616280207000053.parentNode == null || !$n2616280207000048.contains($n2616280207000053)) $n2616280207000048.appendChild($n2616280207000053); }
	if ($mount === null) $mount = $n2616280207000048;
	if ($n2616280207000048 !== $mount && $n2616280207000048.parentNode == null) $mount.appendChild($n2616280207000048);
const $n2616280207000054 = __hydrate.nextElement("div", 0);
$n2616280207000054.setAttribute("class", "mt-8 border-t border-gray-200 pt-6");
const $n2616280207000055 = __hydrate.subWalker($n2616280207000054);
const $n2616280207000058 = $n2616280207000054.__vsk_ssrEls ? $n2616280207000054.__vsk_ssrEls[0] : (() => {
	const $n2616280207000056 = document.createElement("h2");
	$n2616280207000056.setAttribute("class", "text-xl font-semibold mb-3");
	const $n2616280207000057 = document.createTextNode("Samples");
	$n2616280207000056.appendChild($n2616280207000057);
	return $n2616280207000056;
})();
if ($n2616280207000058.parentNode !== $n2616280207000054) { if (!$n2616280207000054 || $n2616280207000058.parentNode == null || !$n2616280207000054.contains($n2616280207000058)) $n2616280207000054.appendChild($n2616280207000058); }
const $n2616280207000061 = $n2616280207000054.__vsk_ssrEls ? $n2616280207000054.__vsk_ssrEls[1] : (() => {
	const $n2616280207000059 = document.createElement("h3");
	$n2616280207000059.setAttribute("class", "font-semibold mb-2");
	const $n2616280207000060 = document.createTextNode("Tables");
	$n2616280207000059.appendChild($n2616280207000060);
	return $n2616280207000059;
})();
if ($n2616280207000061.parentNode !== $n2616280207000054) { if (!$n2616280207000054 || $n2616280207000061.parentNode == null || !$n2616280207000054.contains($n2616280207000061)) $n2616280207000054.appendChild($n2616280207000061); }
$n2616280207000055.injectSkipK(2);
let $n2616280207000062 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2616280207000062 = toDomNode(Md({ "content": presets[0].md }, __registry, $n2616280207000055)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2616280207000055.retireDetached();
if ($n2616280207000062.parentNode !== $n2616280207000054) { if (!$n2616280207000054 || $n2616280207000062.parentNode == null || !$n2616280207000054.contains($n2616280207000062)) $n2616280207000054.appendChild($n2616280207000062); }
const $n2616280207000065 = $n2616280207000054.__vsk_ssrEls ? $n2616280207000054.__vsk_ssrEls[3] : (() => {
	const $n2616280207000063 = document.createElement("h3");
	$n2616280207000063.setAttribute("class", "font-semibold mb-2 mt-6");
	const $n2616280207000064 = document.createTextNode("Tasks");
	$n2616280207000063.appendChild($n2616280207000064);
	return $n2616280207000063;
})();
if ($n2616280207000065.parentNode !== $n2616280207000054) { if (!$n2616280207000054 || $n2616280207000065.parentNode == null || !$n2616280207000054.contains($n2616280207000065)) $n2616280207000054.appendChild($n2616280207000065); }
$n2616280207000055.injectSkipK(1);
let $n2616280207000066 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2616280207000066 = toDomNode(Md({ "content": presets[1].md }, __registry, $n2616280207000055)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2616280207000055.retireDetached();
if ($n2616280207000066.parentNode !== $n2616280207000054) { if (!$n2616280207000054 || $n2616280207000066.parentNode == null || !$n2616280207000054.contains($n2616280207000066)) $n2616280207000054.appendChild($n2616280207000066); }
const $n2616280207000069 = $n2616280207000054.__vsk_ssrEls ? $n2616280207000054.__vsk_ssrEls[5] : (() => {
	const $n2616280207000067 = document.createElement("h3");
	$n2616280207000067.setAttribute("class", "font-semibold mb-2 mt-6");
	const $n2616280207000068 = document.createTextNode("Diff");
	$n2616280207000067.appendChild($n2616280207000068);
	return $n2616280207000067;
})();
if ($n2616280207000069.parentNode !== $n2616280207000054) { if (!$n2616280207000054 || $n2616280207000069.parentNode == null || !$n2616280207000054.contains($n2616280207000069)) $n2616280207000054.appendChild($n2616280207000069); }
$n2616280207000055.injectSkipK(1);
let $n2616280207000070 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2616280207000070 = toDomNode(Md({ "content": presets[2].md }, __registry, $n2616280207000055)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2616280207000055.retireDetached();
if ($n2616280207000070.parentNode !== $n2616280207000054) { if (!$n2616280207000054 || $n2616280207000070.parentNode == null || !$n2616280207000054.contains($n2616280207000070)) $n2616280207000054.appendChild($n2616280207000070); }
	if ($mount === null) $mount = $n2616280207000054;
	if ($n2616280207000054 !== $mount && $n2616280207000054.parentNode == null) $mount.appendChild($n2616280207000054);
const $n2616280207000071 = __hydrate.nextElement("div", 0);
$n2616280207000071.setAttribute("class", "mt-8 border-t border-gray-200 pt-6");
const $n2616280207000072 = __hydrate.subWalker($n2616280207000071);
const $n2616280207000075 = $n2616280207000071.__vsk_ssrEls ? $n2616280207000071.__vsk_ssrEls[0] : (() => {
	const $n2616280207000073 = document.createElement("h2");
	$n2616280207000073.setAttribute("class", "text-xl font-semibold mb-3");
	const $n2616280207000074 = document.createTextNode("From a file");
	$n2616280207000073.appendChild($n2616280207000074);
	return $n2616280207000073;
})();
if ($n2616280207000075.parentNode !== $n2616280207000071) { if (!$n2616280207000071 || $n2616280207000075.parentNode == null || !$n2616280207000071.contains($n2616280207000075)) $n2616280207000071.appendChild($n2616280207000075); }
const $n2616280207000078 = $n2616280207000071.__vsk_ssrEls ? $n2616280207000071.__vsk_ssrEls[1] : (() => {
	const $n2616280207000076 = document.createElement("p");
	$n2616280207000076.setAttribute("class", "text-gray-500 text-sm mb-3");
	const $n2616280207000077 = document.createTextNode(" Pass a path instead of markdown — relative to this page or from /public: ");
	$n2616280207000076.appendChild($n2616280207000077);
	return $n2616280207000076;
})();
if ($n2616280207000078.parentNode !== $n2616280207000071) { if (!$n2616280207000071 || $n2616280207000078.parentNode == null || !$n2616280207000071.contains($n2616280207000078)) $n2616280207000071.appendChild($n2616280207000078); }
$n2616280207000072.injectSkipK(2);
let $n2616280207000079 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2616280207000079 = toDomNode(Md({ "content": __vesk_md_0 }, __registry, $n2616280207000072)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2616280207000072.retireDetached();
if ($n2616280207000079.parentNode !== $n2616280207000071) { if (!$n2616280207000071 || $n2616280207000079.parentNode == null || !$n2616280207000071.contains($n2616280207000079)) $n2616280207000071.appendChild($n2616280207000079); }
	if ($mount === null) $mount = $n2616280207000071;
	if ($n2616280207000071 !== $mount && $n2616280207000071.parentNode == null) $mount.appendChild($n2616280207000071);
const $n2616280207000080 = __hydrate.nextElement("div", 0);
$n2616280207000080.setAttribute("class", "mt-8 border-t border-gray-200 pt-6");
const $n2616280207000081 = __hydrate.subWalker($n2616280207000080);
const $n2616280207000084 = $n2616280207000080.__vsk_ssrEls ? $n2616280207000080.__vsk_ssrEls[0] : (() => {
	const $n2616280207000082 = document.createElement("h2");
	$n2616280207000082.setAttribute("class", "text-xl font-semibold mb-3");
	const $n2616280207000083 = document.createTextNode("Live editing");
	$n2616280207000082.appendChild($n2616280207000083);
	return $n2616280207000082;
})();
if ($n2616280207000084.parentNode !== $n2616280207000080) { if (!$n2616280207000080 || $n2616280207000084.parentNode == null || !$n2616280207000080.contains($n2616280207000084)) $n2616280207000080.appendChild($n2616280207000084); }
const $n2616280207000085 = $n2616280207000081.nextElement("textarea", 1);
$n2616280207000085.setAttribute("rows", "5");
$n2616280207000085.setAttribute("class", "w-full font-mono text-sm border border-gray-300 rounded p-3 mb-4");
$n2616280207000085.__evh_input = (e) => {
	set(live, e.target.value);
};
$n2616280207000085.setAttribute('data-vsk-ev', '');
if ($n2616280207000085.parentNode !== $n2616280207000080) { if (!$n2616280207000080 || $n2616280207000085.parentNode == null || !$n2616280207000080.contains($n2616280207000085)) $n2616280207000080.appendChild($n2616280207000085); }
const $n2616280207000091 = $n2616280207000080.__vsk_ssrEls ? $n2616280207000080.__vsk_ssrEls[2] : (() => {
	const $n2616280207000086 = document.createElement("p");
	$n2616280207000086.setAttribute("class", "text-gray-500 text-sm mb-2");
	const $n2616280207000087 = document.createTextNode(" Raw preview (reactive). Tip: close your ");
	$n2616280207000086.appendChild($n2616280207000087);
	const $n2616280207000088 = document.createElement("code");
	const $n2616280207000089 = document.createTextNode("\\`\\`\\`");
	$n2616280207000088.appendChild($n2616280207000089);
	$n2616280207000086.appendChild($n2616280207000088);
	const $n2616280207000090 = document.createTextNode(" fences — an open fence turns everything below it into one code block. ");
	$n2616280207000086.appendChild($n2616280207000090);
	return $n2616280207000086;
})();
if ($n2616280207000091.parentNode !== $n2616280207000080) { if (!$n2616280207000080 || $n2616280207000091.parentNode == null || !$n2616280207000080.contains($n2616280207000091)) $n2616280207000080.appendChild($n2616280207000091); }
const $n2616280207000092 = $n2616280207000081.nextElement("pre", 1);
$n2616280207000092.setAttribute("class", "bg-gray-100 rounded p-3 text-xs whitespace-pre-wrap");
const $n2616280207000093 = document.createTextNode(String($n2616280207000092.__vsk_ssrText ?? ''));
if ($n2616280207000093.parentNode !== $n2616280207000092) { const __ssr = $n2616280207000092.__vsk_ssrEls || []; if (0 < __ssr.length) $n2616280207000092.insertBefore($n2616280207000093, __ssr[0]); else $n2616280207000092.appendChild($n2616280207000093); }
if ($n2616280207000092.parentNode !== $n2616280207000080) { if (!$n2616280207000080 || $n2616280207000092.parentNode == null || !$n2616280207000080.contains($n2616280207000092)) $n2616280207000080.appendChild($n2616280207000092); }
const $n2616280207000096 = $n2616280207000080.__vsk_ssrEls ? $n2616280207000080.__vsk_ssrEls[4] : (() => {
	const $n2616280207000094 = document.createElement("p");
	$n2616280207000094.setAttribute("class", "text-gray-400 text-xs mt-2");
	const $n2616280207000095 = document.createTextNode(" Full per-keystroke markdown re-render lands with the reactive-props pass. ");
	$n2616280207000094.appendChild($n2616280207000095);
	return $n2616280207000094;
})();
if ($n2616280207000096.parentNode !== $n2616280207000080) { if (!$n2616280207000080 || $n2616280207000096.parentNode == null || !$n2616280207000080.contains($n2616280207000096)) $n2616280207000080.appendChild($n2616280207000096); }
$n2616280207000081.injectSkipK(1);
let $n2616280207000097 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2616280207000097 = toDomNode(Md({ "content": live }, __registry, $n2616280207000081)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2616280207000081.retireDetached();
if ($n2616280207000097.parentNode !== $n2616280207000080) { if (!$n2616280207000080 || $n2616280207000097.parentNode == null || !$n2616280207000080.contains($n2616280207000097)) $n2616280207000080.appendChild($n2616280207000097); }
	if ($mount === null) $mount = $n2616280207000080;
	if ($n2616280207000080 !== $mount && $n2616280207000080.parentNode == null) $mount.appendChild($n2616280207000080);
	effect(() => { const __v = get(live); $n2616280207000093.data = __v == null ? '' : String(__v); });
	if (!document.__vesk_dlg_input) {
		document.__vesk_dlg_input = true;
		document.addEventListener("input", (e) => {
			var el = e.target;
			if (el && el.nodeType !== 1) el = el.parentElement;
			while (el && el.nodeType === 1) {
				if (el.__evh_input) { el.__evh_input(e); break; }
				el = el.parentElement;
			}
		});
	}
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Md", { get: () => __components["MdPage"], configurable: true });

Object.defineProperty(__hydrators, "Page_Md", { get: () => __hydrators["MdPage"], configurable: true });
})();
