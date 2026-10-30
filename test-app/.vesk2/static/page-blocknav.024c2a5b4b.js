(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const blocks = [
	{ kind: 'h2', value: 'Alpha section' },
	{ kind: 'p', value: 'Alpha body' },
	{ kind: 'h2', value: 'Beta section' },
	{ kind: 'p', value: 'Beta body' }
];


__components["BlockNav"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = "BlockNav — statement-mode for over blocks";
const $n3065510074000000 = document.createElement("h1");
$n3065510074000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n3065510074000001 = document.createTextNode("Block Nav Demo");
$n3065510074000000.appendChild($n3065510074000001);
	$root.appendChild($n3065510074000000);
const $n3065510074000002 = document.createElement("article");
$n3065510074000002.setAttribute("class", "blocknav-article border rounded p-4");
const $n3065510074000003 = document.createComment('map');
$n3065510074000002.appendChild($n3065510074000003);
let $n3065510074000005 = [];
const $n3065510074000004 = document.createComment('map-end');
const $n3065510074000006 = (block, __e, __r) => {
	__r = __r || $n3065510074000004;
	const __p = $n3065510074000003.parentNode;
	const __it = document.createDocumentFragment();
const $n3065510074000007 = document.createComment('if');
__it.appendChild($n3065510074000007);
let $n3065510074000009 = [];
const $n3065510074000008 = document.createComment('if-end');
const $n3065510074000010 = () => {
	const __p = $n3065510074000007.parentNode;
	const $n3065510074000011 = document.createDocumentFragment();
const $n3065510074000012 = document.createElement("h2");
$n3065510074000012.setAttribute("class", "blocknav-h2 text-xl font-semibold mt-4 mb-1");
const $n3065510074000013 = document.createTextNode(String((block.value) ?? ''));
$n3065510074000012.appendChild($n3065510074000013);
	$n3065510074000011.appendChild($n3065510074000012);
	__p.insertBefore($n3065510074000011, $n3065510074000008);
};
const $n3065510074000014 = () => {
	const __p = $n3065510074000007.parentNode;
	const $n3065510074000015 = document.createDocumentFragment();
const $n3065510074000016 = document.createElement("p");
$n3065510074000016.setAttribute("class", "blocknav-p text-sm text-gray-600");
const $n3065510074000017 = document.createTextNode(String((block.value) ?? ''));
$n3065510074000016.appendChild($n3065510074000017);
	$n3065510074000015.appendChild($n3065510074000016);
	__p.insertBefore($n3065510074000015, $n3065510074000008);
};
__it.appendChild($n3065510074000008);
if (block.kind === 'h2') { $n3065510074000010(); } else { $n3065510074000014(); }
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n3065510074000002.appendChild($n3065510074000004);
const $n3065510074000018 = () => { const __l = blocks; return __l != null && __l.length > 0; };
for (const block of blocks) {
	$n3065510074000006(block, $n3065510074000005);
}
	$root.appendChild($n3065510074000002);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["BlockNav"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n3065510074000019 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "BlockNav — statement-mode for over blocks";
const $n3065510074000021 = __hydrate.nextElement("article", $n3065510074000019 + 1);
$n3065510074000019 = 0;
$n3065510074000021.setAttribute("class", "blocknav-article border rounded p-4");
const $n3065510074000022 = __hydrate.subWalker($n3065510074000021);
const $n3065510074000023 = document.createComment('map');
let $n3065510074000025 = [];
const $n3065510074000024 = document.createComment('map-end');
const $n3065510074000026 = (block, __e, __r, __cl) => {
	__r = __r || $n3065510074000024;
	const __p = $n3065510074000023.parentNode;
const $n3065510074000027 = document.createComment('if');
let $n3065510074000029 = [];
const $n3065510074000028 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if ($n3065510074000022 && $n3065510074000022.insertBeforeNextClaim) {
	$n3065510074000022.insertBeforeNextClaim($n3065510074000027);
	$n3065510074000022.insertBeforeNextClaim($n3065510074000028);
}
const $n3065510074000030 = () => {
	const __cl = [];
const $n3065510074000032 = $n3065510074000022.nextElement("h2", 0);
$n3065510074000032.setAttribute("class", "blocknav-h2 text-xl font-semibold mt-4 mb-1");
const $n3065510074000033 = document.createTextNode(String((block.value) ?? ''));
if ($n3065510074000033.parentNode !== $n3065510074000032) { const __ssr = $n3065510074000032.__vsk_ssrEls || []; if (0 < __ssr.length) $n3065510074000032.insertBefore($n3065510074000033, __ssr[0]); else $n3065510074000032.appendChild($n3065510074000033); }
	__cl.push($n3065510074000032);
	__place($n3065510074000027, $n3065510074000028, __cl, $root);
};
const $n3065510074000034 = () => {
	const __cl = [];
const $n3065510074000036 = $n3065510074000022.nextElement("p", 0);
$n3065510074000036.setAttribute("class", "blocknav-p text-sm text-gray-600");
const $n3065510074000037 = document.createTextNode(String((block.value) ?? ''));
if ($n3065510074000037.parentNode !== $n3065510074000036) { const __ssr = $n3065510074000036.__vsk_ssrEls || []; if (0 < __ssr.length) $n3065510074000036.insertBefore($n3065510074000037, __ssr[0]); else $n3065510074000036.appendChild($n3065510074000037); }
	__cl.push($n3065510074000036);
	__place($n3065510074000027, $n3065510074000028, __cl, $root);
};
if (block.kind === 'h2') { $n3065510074000030(); } else { $n3065510074000034(); }
};
const $n3065510074000038 = () => { const __l = blocks; return __l != null && __l.length > 0; };
const $n3065510074000039 = [];
for (const block of blocks) {
	$n3065510074000026(block, $n3065510074000025, null, $n3065510074000039);
}
__place($n3065510074000023, $n3065510074000024, $n3065510074000039, $n3065510074000021);
	if ($mount === null) $mount = $n3065510074000021;
	if ($n3065510074000021 !== $mount && $n3065510074000021.parentNode == null) $mount.appendChild($n3065510074000021);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Blocknav", { get: () => __components["BlockNav"], configurable: true });

Object.defineProperty(__hydrators, "Page_Blocknav", { get: () => __hydrators["BlockNav"], configurable: true });
})();
