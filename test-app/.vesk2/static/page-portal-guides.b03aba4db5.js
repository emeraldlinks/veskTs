(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["GuidesPage"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = "Guides — nested layout fixture";
const $n804610794000000 = document.createElement("h1");
$n804610794000000.setAttribute("class", "guides-h1 text-3xl font-bold mb-4");
const $n804610794000001 = document.createTextNode("Guides");
$n804610794000000.appendChild($n804610794000001);
	$root.appendChild($n804610794000000);
const $n804610794000002 = document.createElement("p");
$n804610794000002.setAttribute("class", "text-gray-500 mb-6");
const $n804610794000003 = document.createTextNode(" Sync page inside two nested async layouts — every slot boundary must pair by id and every chrome region must hydrate exactly once. ");
$n804610794000002.appendChild($n804610794000003);
	$root.appendChild($n804610794000002);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["GuidesPage"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n804610794000004 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Guides — nested layout fixture";
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Portal_guides", { get: () => __components["GuidesPage"], configurable: true });

Object.defineProperty(__hydrators, "Page_Portal_guides", { get: () => __hydrators["GuidesPage"], configurable: true });

{
const guideLinks = [
	{ label: 'guides home', href: '/portal/guides' },
	{ label: 'portal home', href: '/portal' },
]


__components["GuidesLayout"] = async (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2028816055000000 = document.createElement("div");
$n2028816055000000.setAttribute("class", "guides-layout");
const $n2028816055000001 = document.createElement("div");
$n2028816055000001.setAttribute("class", "guides-subnav flex items-center gap-4 border-b border-gray-100 px-5 py-2 font-mono text-[11px] text-gray-500");
const $n2028816055000002 = document.createElement("span");
$n2028816055000002.setAttribute("class", "uppercase tracking-wider text-gray-400");
const $n2028816055000003 = document.createTextNode("Guides layout");
$n2028816055000002.appendChild($n2028816055000003);
$n2028816055000001.appendChild($n2028816055000002);
const $n2028816055000004 = document.createComment('map');
$n2028816055000001.appendChild($n2028816055000004);
let $n2028816055000006 = [];
const $n2028816055000005 = document.createComment('map-end');
const $n2028816055000007 = async (g, __e, __r) => {
	__r = __r || $n2028816055000005;
	const __p = $n2028816055000004.parentNode;
	const __it = document.createDocumentFragment();
const $n2028816055000009 = (() => { const $f = document.createDocumentFragment();
const $n2028816055000010 = document.createTextNode(String((g.label) ?? ''));
$f.appendChild($n2028816055000010);
return $f; })();
const $n2028816055000008 = toDomNode(await Link({ "href": g.href, "class": "no-underline hover:text-black", children: $n2028816055000009 }));
	__it.appendChild($n2028816055000008);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2028816055000001.appendChild($n2028816055000005);
const $n2028816055000011 = () => { const __l = guideLinks; return __l != null && __l.length > 0; };
for (const g of guideLinks) {
	await $n2028816055000007(g, $n2028816055000006);
}
$n2028816055000000.appendChild($n2028816055000001);
const $n2028816055000012 = document.createElement("div");
$n2028816055000012.setAttribute("class", "guides-slot");
if (props.children !== undefined && props.children !== null) $n2028816055000012.appendChild(props.children);
$n2028816055000000.appendChild($n2028816055000012);
	$root.appendChild($n2028816055000000);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["GuidesLayout"] = async (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2028816055000013 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2028816055000014 = __hydrate.nextElement("div", $n2028816055000013);
$n2028816055000013 = 0;
$n2028816055000014.setAttribute("class", "guides-layout");
const $n2028816055000015 = __hydrate.subWalker($n2028816055000014);
const $n2028816055000016 = $n2028816055000015.nextElement("div", 0);
$n2028816055000016.setAttribute("class", "guides-subnav flex items-center gap-4 border-b border-gray-100 px-5 py-2 font-mono text-[11px] text-gray-500");
const $n2028816055000017 = $n2028816055000015.subWalker($n2028816055000016);
const $n2028816055000020 = $n2028816055000016.__vsk_ssrEls ? $n2028816055000016.__vsk_ssrEls[0] : (() => {
	const $n2028816055000018 = document.createElement("span");
	$n2028816055000018.setAttribute("class", "uppercase tracking-wider text-gray-400");
	const $n2028816055000019 = document.createTextNode("Guides layout");
	$n2028816055000018.appendChild($n2028816055000019);
	return $n2028816055000018;
})();
if ($n2028816055000020.parentNode !== $n2028816055000016) { if (!$n2028816055000016 || $n2028816055000020.parentNode == null || !$n2028816055000016.contains($n2028816055000020)) $n2028816055000016.appendChild($n2028816055000020); }
let $n2028816055000024 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n2028816055000021 = document.createComment('map');
let $n2028816055000023 = [];
const $n2028816055000022 = document.createComment('map-end');
const $n2028816055000025 = async (g, __e, __r, __cl) => {
	__r = __r || $n2028816055000022;
	const __p = $n2028816055000021.parentNode;
const $n2028816055000027 = (() => { const $f = document.createDocumentFragment();
const $n2028816055000028 = document.createTextNode(String((g.label) ?? ''));
$f.appendChild($n2028816055000028);
return $f; })();
$n2028816055000017.injectSkipK($n2028816055000024);
let $n2028816055000026 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2028816055000026 = toDomNode(await Link({ "href": g.href, "class": "no-underline hover:text-black", children: $n2028816055000027 }, __registry, $n2028816055000017)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2028816055000024 = 0;
$n2028816055000017.retireDetached();
	if (__cl) __cl.push($n2028816055000026); else __p.insertBefore($n2028816055000026, __r);
};
const $n2028816055000029 = () => { const __l = guideLinks; return __l != null && __l.length > 0; };
const $n2028816055000030 = [];
for (const g of guideLinks) {
	await $n2028816055000025(g, $n2028816055000023, null, $n2028816055000030);
}
__place($n2028816055000021, $n2028816055000022, $n2028816055000030, $n2028816055000016);
if ($n2028816055000016.parentNode !== $n2028816055000014) { if (!$n2028816055000014 || $n2028816055000016.parentNode == null || !$n2028816055000014.contains($n2028816055000016)) $n2028816055000014.appendChild($n2028816055000016); }
const $n2028816055000031 = $n2028816055000015.nextElement("div", 0);
$n2028816055000031.setAttribute("class", "guides-slot");
const $n2028816055000032 = $n2028816055000015.subWalker($n2028816055000031);
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    const __slot = createLayoutSlot($n2028816055000032, $n2028816055000031);
    const __child = props.children(__slot.walker);
    if (__child && typeof __child.then === 'function') __pendingChild = __slot.track(__child);
  } else {
    $n2028816055000031.appendChild(props.children);
  }
}
if ($n2028816055000031.parentNode !== $n2028816055000014) { if (!$n2028816055000014 || $n2028816055000031.parentNode == null || !$n2028816055000014.contains($n2028816055000031)) $n2028816055000014.appendChild($n2028816055000031); }
	if ($mount === null) $mount = $n2028816055000014;
	if ($n2028816055000014 !== $mount && $n2028816055000014.parentNode == null) $mount.appendChild($n2028816055000014);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Layout_Portal_guides", { get: () => __components["GuidesLayout"], configurable: true });

Object.defineProperty(__hydrators, "Layout_Portal_guides", { get: () => __hydrators["GuidesLayout"], configurable: true });
})();
