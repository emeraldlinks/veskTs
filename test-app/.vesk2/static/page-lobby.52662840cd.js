(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["Lobby"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2289470448000000 = document.createElement("h1");
$n2289470448000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n2289470448000001 = document.createTextNode("Lobby");
$n2289470448000000.appendChild($n2289470448000001);
	$root.appendChild($n2289470448000000);
const $n2289470448000002 = document.createElement("p");
$n2289470448000002.setAttribute("class", "text-gray-600 mb-6");
const $n2289470448000003 = document.createTextNode("This route renders inside a standalone layout — no root chrome.");
$n2289470448000002.appendChild($n2289470448000003);
	$root.appendChild($n2289470448000002);
const $n2289470448000004 = document.createElement("p");
const $n2289470448000006 = (() => { const $f = document.createDocumentFragment();
const $n2289470448000007 = document.createTextNode("deep link");
$f.appendChild($n2289470448000007);
return $f; })();
const $n2289470448000005 = toDomNode(Link({ "href": "/lobby/deep", "class": "text-blue-600 underline", children: $n2289470448000006 }));
$n2289470448000004.appendChild($n2289470448000005);
	$root.appendChild($n2289470448000004);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Lobby"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2289470448000008 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2289470448000011 = __hydrate.nextElement("p", $n2289470448000008 + 2);
$n2289470448000008 = 0;
const $n2289470448000012 = __hydrate.subWalker($n2289470448000011);
const $n2289470448000014 = (() => { const $f = document.createDocumentFragment();
const $n2289470448000015 = document.createTextNode("deep link");
$f.appendChild($n2289470448000015);
return $f; })();
let $n2289470448000013 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2289470448000013 = toDomNode(Link({ "href": "/lobby/deep", "class": "text-blue-600 underline", children: $n2289470448000014 }, __registry, $n2289470448000012)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2289470448000012.retireDetached();
if ($n2289470448000013.parentNode !== $n2289470448000011) { if (!$n2289470448000011 || $n2289470448000013.parentNode == null || !$n2289470448000011.contains($n2289470448000013)) $n2289470448000011.appendChild($n2289470448000013); }
	if ($mount === null) $mount = $n2289470448000011;
	if ($n2289470448000011 !== $mount && $n2289470448000011.parentNode == null) $mount.appendChild($n2289470448000011);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Lobby", { get: () => __components["Lobby"], configurable: true });

Object.defineProperty(__hydrators, "Page_Lobby", { get: () => __hydrators["Lobby"], configurable: true });

{
__components["LobbyLayout"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2954110077000000 = document.createElement("header");
$n2954110077000000.setAttribute("class", "lobby-header");
const $n2954110077000001 = document.createTextNode(" Standalone lobby chrome ");
$n2954110077000000.appendChild($n2954110077000001);
	$root.appendChild($n2954110077000000);
const $n2954110077000002 = document.createElement("main");
$n2954110077000002.setAttribute("class", "lobby-main");
if (props.children !== undefined && props.children !== null) $n2954110077000002.appendChild(props.children);
	$root.appendChild($n2954110077000002);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["LobbyLayout"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2954110077000003 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2954110077000005 = __hydrate.nextElement("main", $n2954110077000003 + 1);
$n2954110077000003 = 0;
$n2954110077000005.setAttribute("class", "lobby-main");
const $n2954110077000006 = __hydrate.subWalker($n2954110077000005);
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    const __slot = createLayoutSlot($n2954110077000006, $n2954110077000005);
    const __child = props.children(__slot.walker);
    if (__child && typeof __child.then === 'function') __pendingChild = __slot.track(__child);
  } else {
    $n2954110077000005.appendChild(props.children);
  }
}
	if ($mount === null) $mount = $n2954110077000005;
	if ($n2954110077000005 !== $mount && $n2954110077000005.parentNode == null) $mount.appendChild($n2954110077000005);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Layout_Lobby", { get: () => __components["LobbyLayout"], configurable: true });

Object.defineProperty(__hydrators, "Layout_Lobby", { get: () => __hydrators["LobbyLayout"], configurable: true });
})();
