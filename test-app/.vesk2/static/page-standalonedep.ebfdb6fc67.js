(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["StandaloneDep"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1417912196000000 = document.createElement("h1");
const $n1417912196000001 = document.createTextNode("Standalone Dep");
$n1417912196000000.appendChild($n1417912196000001);
	$root.appendChild($n1417912196000000);
const $n1417912196000002 = document.createElement("p");
const $n1417912196000003 = document.createTextNode("Renders inside a standalone layout that imports a shared component.");
$n1417912196000002.appendChild($n1417912196000003);
	$root.appendChild($n1417912196000002);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["StandaloneDep"] = (props, __registry, __hydrate) => { return __hydrate.claimOnly(undefined, (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0)); };
}

Object.defineProperty(__components, "Page_Standalonedep", { get: () => __components["StandaloneDep"], configurable: true });

Object.defineProperty(__hydrators, "Page_Standalonedep", { get: () => __hydrators["StandaloneDep"], configurable: true });

{
__components["Badge"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n426729086000000 = document.createElement("span");
$n426729086000000.setAttribute("class", "shared-badge");
const $n426729086000001 = document.createTextNode("Shared Badge");
$n426729086000000.appendChild($n426729086000001);
	$root.appendChild($n426729086000000);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Badge"] = (props, __registry, __hydrate) => { return __hydrate.claimOnly(undefined, (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0)); };
}

{
__components["StandaloneDepLayout"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2262540961000000 = document.createElement("header");
$n2262540961000000.setAttribute("class", "standalone-header");
const $n2262540961000001 = document.createTextNode(" Standalone chrome — no root layout ");
$n2262540961000000.appendChild($n2262540961000001);
	$root.appendChild($n2262540961000000);
const $n2262540961000002 = document.createElement("main");
$n2262540961000002.setAttribute("class", "standalone-main");
if (props.children !== undefined && props.children !== null) $n2262540961000002.appendChild(props.children);
	$root.appendChild($n2262540961000002);
const $n2262540961000003 = document.createElement("footer");
if (__components["Badge"] == null) throw new Error("Component \"Badge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2262540961000004 = toDomNode(__components["Badge"]({  }));
$n2262540961000003.appendChild($n2262540961000004);
	$root.appendChild($n2262540961000003);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["StandaloneDepLayout"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2262540961000005 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2262540961000007 = __hydrate.nextElement("main", $n2262540961000005 + 1);
$n2262540961000005 = 0;
$n2262540961000007.setAttribute("class", "standalone-main");
const $n2262540961000008 = __hydrate.subWalker($n2262540961000007);
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    const __slot = createLayoutSlot($n2262540961000008, $n2262540961000007);
    const __child = props.children(__slot.walker);
    if (__child && typeof __child.then === 'function') __pendingChild = __slot.track(__child);
  } else {
    $n2262540961000007.appendChild(props.children);
  }
}
	if ($mount === null) $mount = $n2262540961000007;
	if ($n2262540961000007 !== $mount && $n2262540961000007.parentNode == null) $mount.appendChild($n2262540961000007);
const $n2262540961000009 = __hydrate.nextElement("footer", 0);
const $n2262540961000010 = __hydrate.subWalker($n2262540961000009);
if (__hydrators["Badge"] == null) throw new Error("Component \"Badge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n2262540961000011 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2262540961000011 = toDomNode(__hydrators["Badge"]({  }, __registry, $n2262540961000010)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n2262540961000011.parentNode !== $n2262540961000009) { if (!$n2262540961000009 || $n2262540961000011.parentNode == null || !$n2262540961000009.contains($n2262540961000011)) $n2262540961000009.appendChild($n2262540961000011); }
	if ($mount === null) $mount = $n2262540961000009;
	if ($n2262540961000009 !== $mount && $n2262540961000009.parentNode == null) $mount.appendChild($n2262540961000009);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Layout_Standalonedep", { get: () => __components["StandaloneDepLayout"], configurable: true });

Object.defineProperty(__hydrators, "Layout_Standalonedep", { get: () => __hydrators["StandaloneDepLayout"], configurable: true });
})();
