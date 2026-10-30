(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["BrokenComp"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1934466211000000 = document.createComment('if');
$root.appendChild($n1934466211000000);
let $n1934466211000002 = [];
const $n1934466211000001 = document.createComment('if-end');
const $n1934466211000003 = () => {
	const __p = $n1934466211000000.parentNode;
	const $n1934466211000004 = document.createDocumentFragment();
throw new Error('BrokenComp exploded');
	__p.insertBefore($n1934466211000004, $n1934466211000001);
};
$root.appendChild($n1934466211000001);
if (typeof window !== 'undefined') { $n1934466211000003(); }
const $n1934466211000005 = document.createElement("p");
$n1934466211000005.setAttribute("class", "text-gray-600");
const $n1934466211000006 = document.createTextNode("This component throws on the client only.");
$n1934466211000005.appendChild($n1934466211000006);
	$root.appendChild($n1934466211000005);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["BrokenComp"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1934466211000007 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n1934466211000008 = document.createComment('if');
let $n1934466211000010 = [];
const $n1934466211000009 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n1934466211000008, $n1934466211000007);
	__hydrate.insertBeforeNextClaim($n1934466211000009, $n1934466211000007);
}
const $n1934466211000011 = () => {
	const __cl = [];
throw new Error('BrokenComp exploded');
	__place($n1934466211000008, $n1934466211000009, __cl, $root);
};
if (typeof window !== 'undefined') { $n1934466211000011(); }
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

{
__components["Broken"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n3983719867000000 = document.createElement("div");
$n3983719867000000.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-white rounded-xl shadow-sm border border-gray-200");
const $n3983719867000001 = document.createElement("h1");
$n3983719867000001.setAttribute("class", "text-2xl font-bold mb-4");
const $n3983719867000002 = document.createTextNode("Broken component page");
$n3983719867000001.appendChild($n3983719867000002);
$n3983719867000000.appendChild($n3983719867000001);
if (__components["BrokenComp"] == null) throw new Error("Component \"BrokenComp\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n3983719867000003 = toDomNode(__components["BrokenComp"]({  }));
$n3983719867000000.appendChild($n3983719867000003);
	$root.appendChild($n3983719867000000);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Broken"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n3983719867000004 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n3983719867000005 = __hydrate.nextElement("div", $n3983719867000004);
$n3983719867000004 = 0;
$n3983719867000005.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-white rounded-xl shadow-sm border border-gray-200");
const $n3983719867000006 = __hydrate.subWalker($n3983719867000005);
const $n3983719867000009 = $n3983719867000005.__vsk_ssrEls ? $n3983719867000005.__vsk_ssrEls[0] : (() => {
	const $n3983719867000007 = document.createElement("h1");
	$n3983719867000007.setAttribute("class", "text-2xl font-bold mb-4");
	const $n3983719867000008 = document.createTextNode("Broken component page");
	$n3983719867000007.appendChild($n3983719867000008);
	return $n3983719867000007;
})();
if ($n3983719867000009.parentNode !== $n3983719867000005) { if (!$n3983719867000005 || $n3983719867000009.parentNode == null || !$n3983719867000005.contains($n3983719867000009)) $n3983719867000005.appendChild($n3983719867000009); }
if (__hydrators["BrokenComp"] == null) throw new Error("Component \"BrokenComp\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
$n3983719867000006.injectSkipK(1);
let $n3983719867000010 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3983719867000010 = toDomNode(__hydrators["BrokenComp"]({  }, __registry, $n3983719867000006)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n3983719867000010.parentNode !== $n3983719867000005) { if (!$n3983719867000005 || $n3983719867000010.parentNode == null || !$n3983719867000005.contains($n3983719867000010)) $n3983719867000005.appendChild($n3983719867000010); }
	if ($mount === null) $mount = $n3983719867000005;
	if ($n3983719867000005 !== $mount && $n3983719867000005.parentNode == null) $mount.appendChild($n3983719867000005);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Broken", { get: () => __components["Broken"], configurable: true });

Object.defineProperty(__hydrators, "Page_Broken", { get: () => __hydrators["Broken"], configurable: true });
})();
