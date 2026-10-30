(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["PortalPage"] = async (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = "Portal — layout hydration fixture";
const posts = await useFetch('/api/posts');
const $n1623885226000000 = document.createElement("h1");
$n1623885226000000.setAttribute("class", "portal-h1 text-3xl font-bold mb-4");
const $n1623885226000001 = document.createTextNode("Portal");
$n1623885226000000.appendChild($n1623885226000001);
	$root.appendChild($n1623885226000000);
const $n1623885226000002 = document.createElement("p");
$n1623885226000002.setAttribute("class", "text-gray-500 mb-6");
const $n1623885226000003 = document.createTextNode(" Async page inside an async layout with an async footer badge — the shape that used to twin footers and misorder slots after hydration. ");
$n1623885226000002.appendChild($n1623885226000003);
	$root.appendChild($n1623885226000002);
const $n1623885226000004 = document.createComment('if');
$root.appendChild($n1623885226000004);
let $n1623885226000006 = [];
const $n1623885226000005 = document.createComment('if-end');
const $n1623885226000007 = async () => {
	const __p = $n1623885226000004.parentNode;
	const $n1623885226000008 = document.createDocumentFragment();
const $n1623885226000009 = document.createElement("p");
$n1623885226000009.setAttribute("class", "portal-empty");
const $n1623885226000010 = document.createTextNode("No posts.");
$n1623885226000009.appendChild($n1623885226000010);
	$n1623885226000008.appendChild($n1623885226000009);
	__p.insertBefore($n1623885226000008, $n1623885226000005);
};
const $n1623885226000011 = async () => {
	const __p = $n1623885226000004.parentNode;
	const $n1623885226000012 = document.createDocumentFragment();
const $n1623885226000013 = document.createElement("h2");
$n1623885226000013.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n1623885226000014 = document.createTextNode("Portal posts");
$n1623885226000013.appendChild($n1623885226000014);
	$n1623885226000012.appendChild($n1623885226000013);
const $n1623885226000015 = document.createComment('map');
$n1623885226000012.appendChild($n1623885226000015);
let $n1623885226000017 = [];
const $n1623885226000016 = document.createComment('map-end');
const $n1623885226000018 = async (post, __e, __r) => {
	__r = __r || $n1623885226000016;
	const __p = $n1623885226000015.parentNode;
	const __it = document.createDocumentFragment();
const $n1623885226000019 = document.createElement("div");
$n1623885226000019.setAttribute("class", "bg-white rounded-lg p-4 mb-3 shadow-sm border border-gray-100");
const $n1623885226000020 = document.createElement("h3");
$n1623885226000020.setAttribute("class", "font-semibold");
const $n1623885226000021 = document.createTextNode(String((post.title) ?? ''));
$n1623885226000020.appendChild($n1623885226000021);
$n1623885226000019.appendChild($n1623885226000020);
const $n1623885226000022 = document.createElement("p");
$n1623885226000022.setAttribute("class", "text-gray-500 text-sm");
const $n1623885226000023 = document.createTextNode(String((post.excerpt) ?? ''));
$n1623885226000022.appendChild($n1623885226000023);
$n1623885226000019.appendChild($n1623885226000022);
	__it.appendChild($n1623885226000019);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n1623885226000012.appendChild($n1623885226000016);
const $n1623885226000024 = () => { const __l = posts; return __l != null && __l.length > 0; };
for (const post of posts) {
	await $n1623885226000018(post, $n1623885226000017);
}
	__p.insertBefore($n1623885226000012, $n1623885226000005);
};
$root.appendChild($n1623885226000005);
if (posts.length === 0) { await $n1623885226000007(); } else { await $n1623885226000011(); }
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["PortalPage"] = async (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1623885226000025 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Portal — layout hydration fixture";
const posts = await useFetch('/api/posts');
let $n1623885226000028 = 2; // first-claim budget: region SSR sits 2 slot(s) past the walker cursor
const $n1623885226000029 = document.createComment('if');
let $n1623885226000031 = [];
const $n1623885226000030 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n1623885226000029, $n1623885226000028);
	__hydrate.insertBeforeNextClaim($n1623885226000030, $n1623885226000028);
}
const $n1623885226000032 = async () => {
	const __cl = [];
const $n1623885226000034 = __hydrate.nextElement("p", $n1623885226000028);
$n1623885226000028 = 0;
$n1623885226000034.setAttribute("class", "portal-empty");
const $n1623885226000035 = document.createTextNode("No posts.");
if ($n1623885226000035.parentNode !== $n1623885226000034) { const __ssr = $n1623885226000034.__vsk_ssrEls || []; if (0 < __ssr.length) $n1623885226000034.insertBefore($n1623885226000035, __ssr[0]); else $n1623885226000034.appendChild($n1623885226000035); }
	__cl.push($n1623885226000034);
	__place($n1623885226000029, $n1623885226000030, __cl, $root);
};
const $n1623885226000036 = async () => {
	const __cl = [];
const $n1623885226000038 = __hydrate.nextElement("h2", $n1623885226000028);
$n1623885226000028 = 0;
$n1623885226000038.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n1623885226000039 = document.createTextNode("Portal posts");
if ($n1623885226000039.parentNode !== $n1623885226000038) { const __ssr = $n1623885226000038.__vsk_ssrEls || []; if (0 < __ssr.length) $n1623885226000038.insertBefore($n1623885226000039, __ssr[0]); else $n1623885226000038.appendChild($n1623885226000039); }
	__cl.push($n1623885226000038);
const $n1623885226000040 = document.createComment('map');
let $n1623885226000042 = [];
const $n1623885226000041 = document.createComment('map-end');
const $n1623885226000043 = async (post, __e, __r, __cl) => {
	__r = __r || $n1623885226000041;
	const __p = $n1623885226000040.parentNode;
const $n1623885226000044 = __hydrate.nextElement("div", $n1623885226000028);
$n1623885226000028 = 0;
$n1623885226000044.setAttribute("class", "bg-white rounded-lg p-4 mb-3 shadow-sm border border-gray-100");
const $n1623885226000045 = __hydrate.subWalker($n1623885226000044);
const $n1623885226000046 = $n1623885226000045.nextElement("h3", 0);
$n1623885226000046.setAttribute("class", "font-semibold");
const $n1623885226000047 = document.createTextNode(String((post.title) ?? ''));
if ($n1623885226000047.parentNode !== $n1623885226000046) { const __ssr = $n1623885226000046.__vsk_ssrEls || []; if (0 < __ssr.length) $n1623885226000046.insertBefore($n1623885226000047, __ssr[0]); else $n1623885226000046.appendChild($n1623885226000047); }
if ($n1623885226000046.parentNode !== $n1623885226000044) { if (!$n1623885226000044 || $n1623885226000046.parentNode == null || !$n1623885226000044.contains($n1623885226000046)) $n1623885226000044.appendChild($n1623885226000046); }
const $n1623885226000048 = $n1623885226000045.nextElement("p", 0);
$n1623885226000048.setAttribute("class", "text-gray-500 text-sm");
const $n1623885226000049 = document.createTextNode(String((post.excerpt) ?? ''));
if ($n1623885226000049.parentNode !== $n1623885226000048) { const __ssr = $n1623885226000048.__vsk_ssrEls || []; if (0 < __ssr.length) $n1623885226000048.insertBefore($n1623885226000049, __ssr[0]); else $n1623885226000048.appendChild($n1623885226000049); }
if ($n1623885226000048.parentNode !== $n1623885226000044) { if (!$n1623885226000044 || $n1623885226000048.parentNode == null || !$n1623885226000044.contains($n1623885226000048)) $n1623885226000044.appendChild($n1623885226000048); }
	if (__cl) __cl.push($n1623885226000044); else __p.insertBefore($n1623885226000044, __r);
};
const $n1623885226000050 = () => { const __l = posts; return __l != null && __l.length > 0; };
const $n1623885226000051 = [];
for (const post of posts) {
	await $n1623885226000043(post, $n1623885226000042, null, $n1623885226000051);
}
__place($n1623885226000040, $n1623885226000041, $n1623885226000051, $root);
	__place($n1623885226000029, $n1623885226000030, __cl, $root);
};
if (posts.length === 0) { await $n1623885226000032(); } else { await $n1623885226000036(); }
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Portal", { get: () => __components["PortalPage"], configurable: true });

Object.defineProperty(__hydrators, "Page_Portal", { get: () => __hydrators["PortalPage"], configurable: true });

{
const portalLinks = [
	{ label: 'overview', href: '/portal' },
	{ label: 'guides', href: '/portal/guides' },
	{ label: 'async', href: '/async' },
	{ label: 'map', href: '/map' }
];


__components["PortalNav"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const open = track(false);
const $n3173135781000000 = document.createElement("header");
$n3173135781000000.setAttribute("class", "portal-nav sticky top-0 z-40 border-b border-gray-200 bg-white/90");
const $n3173135781000001 = document.createElement("div");
$n3173135781000001.setAttribute("class", "mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3");
const $n3173135781000003 = (() => { const $f = document.createDocumentFragment();
const $n3173135781000004 = document.createElement("span");
$n3173135781000004.setAttribute("class", "grid size-6 place-items-center bg-black text-[11px] font-bold text-white");
const $n3173135781000005 = document.createTextNode("P");
$n3173135781000004.appendChild($n3173135781000005);
$f.appendChild($n3173135781000004);
const $n3173135781000006 = document.createElement("span");
$n3173135781000006.setAttribute("class", "text-sm font-semibold tracking-tight text-black");
const $n3173135781000007 = document.createTextNode("portal");
$n3173135781000006.appendChild($n3173135781000007);
$f.appendChild($n3173135781000006);
const $n3173135781000008 = document.createElement("span");
$n3173135781000008.setAttribute("class", "hidden font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400 sm:inline");
const $n3173135781000009 = document.createTextNode("layout-stress");
$n3173135781000008.appendChild($n3173135781000009);
$f.appendChild($n3173135781000008);
return $f; })();
const $n3173135781000002 = toDomNode(Link({ "href": "/portal", "class": "flex items-center gap-2 no-underline", children: $n3173135781000003 }));
$n3173135781000001.appendChild($n3173135781000002);
const $n3173135781000010 = document.createElement("nav");
$n3173135781000010.setAttribute("class", "hidden items-center gap-6 font-mono text-[11px] text-gray-500 md:flex");
const $n3173135781000011 = document.createComment('map');
$n3173135781000010.appendChild($n3173135781000011);
let $n3173135781000013 = [];
const $n3173135781000012 = document.createComment('map-end');
const $n3173135781000014 = (l, __e, __r) => {
	__r = __r || $n3173135781000012;
	const __p = $n3173135781000011.parentNode;
	const __it = document.createDocumentFragment();
const $n3173135781000016 = (() => { const $f = document.createDocumentFragment();
const $n3173135781000017 = document.createTextNode(String((l.label) ?? ''));
$f.appendChild($n3173135781000017);
return $f; })();
const $n3173135781000015 = toDomNode(Link({ "href": l.href, "class": "transition-colors hover:text-black no-underline text-gray-500", children: $n3173135781000016 }));
	__it.appendChild($n3173135781000015);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n3173135781000010.appendChild($n3173135781000012);
const $n3173135781000018 = () => { const __l = portalLinks; return __l != null && __l.length > 0; };
for (const l of portalLinks) {
	$n3173135781000014(l, $n3173135781000013);
}
const $n3173135781000020 = (() => { const $f = document.createDocumentFragment();
const $n3173135781000021 = document.createTextNode("Guides");
$f.appendChild($n3173135781000021);
return $f; })();
const $n3173135781000019 = toDomNode(NavLink({ "href": "/portal/guides", "class": "px-3 py-1.5 text-[11px] no-underline", children: $n3173135781000020 }));
$n3173135781000010.appendChild($n3173135781000019);
$n3173135781000001.appendChild($n3173135781000010);
const $n3173135781000022 = document.createElement("button");
$n3173135781000022.setAttribute("type", "button");
$n3173135781000022.setAttribute("class", "portal-menu-btn grid size-8 place-items-center border border-gray-200 md:hidden bg-transparent text-black");
const $n3173135781000023 = document.createComment('if');
$n3173135781000022.appendChild($n3173135781000023);
let $n3173135781000025 = [];
const $n3173135781000024 = document.createComment('if-end');
const $n3173135781000026 = () => {
	const __p = $n3173135781000023.parentNode;
	const $n3173135781000027 = document.createDocumentFragment();
const $n3173135781000028 = document.createElement("span");
const $n3173135781000029 = document.createTextNode("X");
$n3173135781000028.appendChild($n3173135781000029);
	$n3173135781000027.appendChild($n3173135781000028);
	__p.insertBefore($n3173135781000027, $n3173135781000024);
};
const $n3173135781000030 = () => {
	const __p = $n3173135781000023.parentNode;
	const $n3173135781000031 = document.createDocumentFragment();
const $n3173135781000032 = document.createElement("span");
const $n3173135781000033 = document.createTextNode("M");
$n3173135781000032.appendChild($n3173135781000033);
	$n3173135781000031.appendChild($n3173135781000032);
	__p.insertBefore($n3173135781000031, $n3173135781000024);
};
$n3173135781000022.appendChild($n3173135781000024);
if (get(open)) { $n3173135781000026(); } else { $n3173135781000030(); }
$n3173135781000022.__evh_click = () => set(open, !get(open));
$n3173135781000022.setAttribute('data-vsk-ev', '');
$n3173135781000001.appendChild($n3173135781000022);
$n3173135781000000.appendChild($n3173135781000001);
const $n3173135781000034 = document.createComment('if');
$n3173135781000000.appendChild($n3173135781000034);
let $n3173135781000036 = [];
const $n3173135781000035 = document.createComment('if-end');
const $n3173135781000037 = () => {
	const __p = $n3173135781000034.parentNode;
	const $n3173135781000038 = document.createDocumentFragment();
const $n3173135781000039 = document.createElement("nav");
$n3173135781000039.setAttribute("class", "portal-mobile-nav border-t border-gray-200 bg-white px-5 py-3 font-mono text-[12px] md:hidden");
const $n3173135781000040 = document.createComment('map');
$n3173135781000039.appendChild($n3173135781000040);
let $n3173135781000042 = [];
const $n3173135781000041 = document.createComment('map-end');
const $n3173135781000043 = (l, __e, __r) => {
	__r = __r || $n3173135781000041;
	const __p = $n3173135781000040.parentNode;
	const __it = document.createDocumentFragment();
const $n3173135781000045 = (() => { const $f = document.createDocumentFragment();
const $n3173135781000046 = document.createTextNode(String((l.label) ?? ''));
$f.appendChild($n3173135781000046);
return $f; })();
const $n3173135781000044 = toDomNode(Link({ "href": l.href, "onClick": () => set(open, false), "class": "block border-b border-gray-100 py-2.5 text-gray-500 no-underline", children: $n3173135781000045 }));
	__it.appendChild($n3173135781000044);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n3173135781000039.appendChild($n3173135781000041);
const $n3173135781000047 = () => { const __l = portalLinks; return __l != null && __l.length > 0; };
for (const l of portalLinks) {
	$n3173135781000043(l, $n3173135781000042);
}
	$n3173135781000038.appendChild($n3173135781000039);
	__p.insertBefore($n3173135781000038, $n3173135781000035);
};
$n3173135781000000.appendChild($n3173135781000035);
if (get(open)) { $n3173135781000037(); }
	$root.appendChild($n3173135781000000);
	{
	    let __iv = get(open);
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(open); return; }
	      const __nv = get(open);
	      if (__nv !== __iv) {
	        for (const e of $n3173135781000025) destroy_block(e);
	        $n3173135781000025.length = 0;
	        __cleanup($n3173135781000023, $n3173135781000024);
	        if (__nv) { $n3173135781000026(); } else { $n3173135781000030(); }
	        __iv = __nv;
	      }
	    });
	  }
	effect(() => { const __v = get(open) ? "Close menu" : "Open menu"; if (__v == null || __v === false) $n3173135781000022.removeAttribute("aria-label"); else $n3173135781000022.setAttribute("aria-label", __v === true ? 'true' : String(__v)); });
	{
	    let __iv = get(open);
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(open); return; }
	      const __nv = get(open);
	      if (__nv !== __iv) {
	        for (const e of $n3173135781000036) destroy_block(e);
	        $n3173135781000036.length = 0;
	        __cleanup($n3173135781000034, $n3173135781000035);
	        if (__nv) { $n3173135781000037(); }
	        __iv = __nv;
	      }
	    });
	  }
	if (!document.__vesk_dlg_click) {
		document.__vesk_dlg_click = true;
		document.addEventListener("click", (e) => {
			var el = e.target;
			if (el && el.nodeType !== 1) el = el.parentElement;
			while (el && el.nodeType === 1) {
				if (el.__evh_click) { el.__evh_click(e); break; }
				el = el.parentElement;
			}
		});
	}
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["PortalNav"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const open = track(false);
let $n3173135781000048 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n3173135781000049 = __hydrate.nextElement("header", $n3173135781000048);
$n3173135781000048 = 0;
$n3173135781000049.setAttribute("class", "portal-nav sticky top-0 z-40 border-b border-gray-200 bg-white/90");
const $n3173135781000050 = __hydrate.subWalker($n3173135781000049);
const $n3173135781000051 = $n3173135781000050.nextElement("div", 0);
$n3173135781000051.setAttribute("class", "mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3");
const $n3173135781000052 = $n3173135781000050.subWalker($n3173135781000051);
const $n3173135781000054 = (() => { const $f = document.createDocumentFragment();
const $n3173135781000055 = document.createElement("span");
$n3173135781000055.setAttribute("class", "grid size-6 place-items-center bg-black text-[11px] font-bold text-white");
const $n3173135781000056 = document.createTextNode("P");
$n3173135781000055.appendChild($n3173135781000056);
$f.appendChild($n3173135781000055);
const $n3173135781000057 = document.createElement("span");
$n3173135781000057.setAttribute("class", "text-sm font-semibold tracking-tight text-black");
const $n3173135781000058 = document.createTextNode("portal");
$n3173135781000057.appendChild($n3173135781000058);
$f.appendChild($n3173135781000057);
const $n3173135781000059 = document.createElement("span");
$n3173135781000059.setAttribute("class", "hidden font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400 sm:inline");
const $n3173135781000060 = document.createTextNode("layout-stress");
$n3173135781000059.appendChild($n3173135781000060);
$f.appendChild($n3173135781000059);
return $f; })();
let $n3173135781000053 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3173135781000053 = toDomNode(Link({ "href": "/portal", "class": "flex items-center gap-2 no-underline", children: $n3173135781000054 }, __registry, $n3173135781000052)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n3173135781000052.retireDetached();
if ($n3173135781000053.parentNode !== $n3173135781000051) { if (!$n3173135781000051 || $n3173135781000053.parentNode == null || !$n3173135781000051.contains($n3173135781000053)) $n3173135781000051.appendChild($n3173135781000053); }
const $n3173135781000061 = $n3173135781000052.nextElement("nav", 0);
$n3173135781000061.setAttribute("class", "hidden items-center gap-6 font-mono text-[11px] text-gray-500 md:flex");
const $n3173135781000062 = $n3173135781000052.subWalker($n3173135781000061);
const $n3173135781000063 = document.createComment('map');
let $n3173135781000065 = [];
const $n3173135781000064 = document.createComment('map-end');
const $n3173135781000066 = (l, __e, __r, __cl) => {
	__r = __r || $n3173135781000064;
	const __p = $n3173135781000063.parentNode;
const $n3173135781000068 = (() => { const $f = document.createDocumentFragment();
const $n3173135781000069 = document.createTextNode(String((l.label) ?? ''));
$f.appendChild($n3173135781000069);
return $f; })();
let $n3173135781000067 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3173135781000067 = toDomNode(Link({ "href": l.href, "class": "transition-colors hover:text-black no-underline text-gray-500", children: $n3173135781000068 }, __registry, $n3173135781000062)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n3173135781000062.retireDetached();
	if (__cl) __cl.push($n3173135781000067); else __p.insertBefore($n3173135781000067, __r);
};
const $n3173135781000070 = () => { const __l = portalLinks; return __l != null && __l.length > 0; };
const $n3173135781000071 = [];
for (const l of portalLinks) {
	$n3173135781000066(l, $n3173135781000065, null, $n3173135781000071);
}
__place($n3173135781000063, $n3173135781000064, $n3173135781000071, $n3173135781000061);
const $n3173135781000073 = (() => { const $f = document.createDocumentFragment();
const $n3173135781000074 = document.createTextNode("Guides");
$f.appendChild($n3173135781000074);
return $f; })();
let $n3173135781000072 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3173135781000072 = toDomNode(NavLink({ "href": "/portal/guides", "class": "px-3 py-1.5 text-[11px] no-underline", children: $n3173135781000073 }, __registry, $n3173135781000062)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n3173135781000062.retireDetached();
if ($n3173135781000072.parentNode !== $n3173135781000061) { if (!$n3173135781000061 || $n3173135781000072.parentNode == null || !$n3173135781000061.contains($n3173135781000072)) $n3173135781000061.appendChild($n3173135781000072); }
if ($n3173135781000061.parentNode !== $n3173135781000051) { if (!$n3173135781000051 || $n3173135781000061.parentNode == null || !$n3173135781000051.contains($n3173135781000061)) $n3173135781000051.appendChild($n3173135781000061); }
const $n3173135781000075 = $n3173135781000052.nextElement("button", 0);
$n3173135781000075.setAttribute("type", "button");
$n3173135781000075.setAttribute("class", "portal-menu-btn grid size-8 place-items-center border border-gray-200 md:hidden bg-transparent text-black");
const $n3173135781000076 = $n3173135781000052.subWalker($n3173135781000075);
const $n3173135781000077 = document.createComment('if');
let $n3173135781000079 = [];
const $n3173135781000078 = document.createComment('if-end');
const $n3173135781000080 = () => {
	const __cl = [];
const $n3173135781000082 = $n3173135781000076.nextElement("span", 0);
const $n3173135781000083 = document.createTextNode("X");
if ($n3173135781000083.parentNode !== $n3173135781000082) { const __ssr = $n3173135781000082.__vsk_ssrEls || []; if (0 < __ssr.length) $n3173135781000082.insertBefore($n3173135781000083, __ssr[0]); else $n3173135781000082.appendChild($n3173135781000083); }
	__cl.push($n3173135781000082);
	__place($n3173135781000077, $n3173135781000078, __cl, $n3173135781000075);
};
const $n3173135781000084 = () => {
	const __cl = [];
const $n3173135781000086 = $n3173135781000076.nextElement("span", 0);
const $n3173135781000087 = document.createTextNode("M");
if ($n3173135781000087.parentNode !== $n3173135781000086) { const __ssr = $n3173135781000086.__vsk_ssrEls || []; if (0 < __ssr.length) $n3173135781000086.insertBefore($n3173135781000087, __ssr[0]); else $n3173135781000086.appendChild($n3173135781000087); }
	__cl.push($n3173135781000086);
	__place($n3173135781000077, $n3173135781000078, __cl, $n3173135781000075);
};
if (get(open)) { $n3173135781000080(); } else { $n3173135781000084(); }
$n3173135781000075.__evh_click = () => set(open, !get(open));
$n3173135781000075.setAttribute('data-vsk-ev', '');
if ($n3173135781000075.parentNode !== $n3173135781000051) { if (!$n3173135781000051 || $n3173135781000075.parentNode == null || !$n3173135781000051.contains($n3173135781000075)) $n3173135781000051.appendChild($n3173135781000075); }
if ($n3173135781000051.parentNode !== $n3173135781000049) { if (!$n3173135781000049 || $n3173135781000051.parentNode == null || !$n3173135781000049.contains($n3173135781000051)) $n3173135781000049.appendChild($n3173135781000051); }
const $n3173135781000088 = document.createComment('if');
let $n3173135781000090 = [];
const $n3173135781000089 = document.createComment('if-end');
const $n3173135781000091 = () => {
	const __cl = [];
const $n3173135781000093 = $n3173135781000050.nextElement("nav", 0);
$n3173135781000093.setAttribute("class", "portal-mobile-nav border-t border-gray-200 bg-white px-5 py-3 font-mono text-[12px] md:hidden");
const $n3173135781000094 = $n3173135781000050.subWalker($n3173135781000093);
const $n3173135781000095 = document.createComment('map');
let $n3173135781000097 = [];
const $n3173135781000096 = document.createComment('map-end');
const $n3173135781000098 = (l, __e, __r, __cl) => {
	__r = __r || $n3173135781000096;
	const __p = $n3173135781000095.parentNode;
const $n3173135781000100 = (() => { const $f = document.createDocumentFragment();
const $n3173135781000101 = document.createTextNode(String((l.label) ?? ''));
$f.appendChild($n3173135781000101);
return $f; })();
let $n3173135781000099 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3173135781000099 = toDomNode(Link({ "href": l.href, "onClick": () => set(open, false), "class": "block border-b border-gray-100 py-2.5 text-gray-500 no-underline", children: $n3173135781000100 }, __registry, $n3173135781000094)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n3173135781000094.retireDetached();
	if (__cl) __cl.push($n3173135781000099); else __p.insertBefore($n3173135781000099, __r);
};
const $n3173135781000102 = () => { const __l = portalLinks; return __l != null && __l.length > 0; };
const $n3173135781000103 = [];
for (const l of portalLinks) {
	$n3173135781000098(l, $n3173135781000097, null, $n3173135781000103);
}
__place($n3173135781000095, $n3173135781000096, $n3173135781000103, $n3173135781000093);
	__cl.push($n3173135781000093);
	__place($n3173135781000088, $n3173135781000089, __cl, $n3173135781000049);
};
if (get(open)) { $n3173135781000091(); }
	if ($mount === null) $mount = $n3173135781000049;
	if ($n3173135781000049 !== $mount && $n3173135781000049.parentNode == null) $mount.appendChild($n3173135781000049);
	{
	    let __iv = get(open);
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(open); return; }
	      const __nv = get(open);
	      if (__nv !== __iv) {
	        for (const e of $n3173135781000079) destroy_block(e);
	        $n3173135781000079.length = 0;
	        __cleanup($n3173135781000077, $n3173135781000078);
	        if (__nv) { $n3173135781000080(); } else { $n3173135781000084(); }
	        __iv = __nv;
	      }
	    });
	  }
	effect(() => { const __v = get(open) ? "Close menu" : "Open menu"; if (__v == null || __v === false) $n3173135781000075.removeAttribute("aria-label"); else $n3173135781000075.setAttribute("aria-label", __v === true ? 'true' : String(__v)); });
	{
	    let __iv = get(open);
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(open); return; }
	      const __nv = get(open);
	      if (__nv !== __iv) {
	        for (const e of $n3173135781000090) destroy_block(e);
	        $n3173135781000090.length = 0;
	        __cleanup($n3173135781000088, $n3173135781000089);
	        if (__nv) { $n3173135781000091(); }
	        __iv = __nv;
	      }
	    });
	  }
	if (!document.__vesk_dlg_click) {
		document.__vesk_dlg_click = true;
		document.addEventListener("click", (e) => {
			var el = e.target;
			if (el && el.nodeType !== 1) el = el.parentElement;
			while (el && el.nodeType === 1) {
				if (el.__evh_click) { el.__evh_click(e); break; }
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

{
__components["BuildBadge"] = async (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const posts = await useFetch('/api/posts?limit=1');
const $n3609048297000000 = document.createElement("span");
$n3609048297000000.setAttribute("class", "portal-build-badge");
const $n3609048297000001 = document.createTextNode("build ");
$n3609048297000000.appendChild($n3609048297000001);
const $n3609048297000002 = document.createComment('if');
$n3609048297000000.appendChild($n3609048297000002);
let $n3609048297000004 = [];
const $n3609048297000003 = document.createComment('if-end');
const $n3609048297000005 = async () => {
	const __p = $n3609048297000002.parentNode;
	const $n3609048297000006 = document.createDocumentFragment();
const $n3609048297000007 = document.createTextNode(String((posts[0].title) ?? ''));
	$n3609048297000006.appendChild($n3609048297000007);
	__p.insertBefore($n3609048297000006, $n3609048297000003);
};
const $n3609048297000008 = async () => {
	const __p = $n3609048297000002.parentNode;
	const $n3609048297000009 = document.createDocumentFragment();
const $n3609048297000010 = document.createTextNode(String(('empty') ?? ''));
	$n3609048297000009.appendChild($n3609048297000010);
	__p.insertBefore($n3609048297000009, $n3609048297000003);
};
$n3609048297000000.appendChild($n3609048297000003);
if (posts.length > 0) { await $n3609048297000005(); } else { await $n3609048297000008(); }
	$root.appendChild($n3609048297000000);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["BuildBadge"] = async (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n3609048297000011 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const posts = await useFetch('/api/posts?limit=1');
const $n3609048297000012 = __hydrate.nextElement("span", $n3609048297000011);
$n3609048297000011 = 0;
$n3609048297000012.setAttribute("class", "portal-build-badge");
const $n3609048297000013 = __hydrate.subWalker($n3609048297000012);
const $n3609048297000014 = document.createTextNode("build ");
if ($n3609048297000014.parentNode !== $n3609048297000012) { const __ssr = $n3609048297000012.__vsk_ssrEls || []; if (0 < __ssr.length) $n3609048297000012.insertBefore($n3609048297000014, __ssr[0]); else $n3609048297000012.appendChild($n3609048297000014); }
const $n3609048297000015 = document.createComment('if');
let $n3609048297000017 = [];
const $n3609048297000016 = document.createComment('if-end');
const $n3609048297000018 = async () => {
	const __cl = [];
const $n3609048297000020 = document.createTextNode(String((posts[0].title) ?? ''));
	__cl.push($n3609048297000020);
	__place($n3609048297000015, $n3609048297000016, __cl, $n3609048297000012);
};
const $n3609048297000021 = async () => {
	const __cl = [];
const $n3609048297000023 = document.createTextNode(String(('empty') ?? ''));
	__cl.push($n3609048297000023);
	__place($n3609048297000015, $n3609048297000016, __cl, $n3609048297000012);
};
if (posts.length > 0) { await $n3609048297000018(); } else { await $n3609048297000021(); }
	if ($mount === null) $mount = $n3609048297000012;
	if ($n3609048297000012 !== $mount && $n3609048297000012.parentNode == null) $mount.appendChild($n3609048297000012);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

{
const columns = [
	{
		title: "Product",
		links: [
			{ label: "Overview", href: "/portal" },
			{ label: "Guides", href: "/portal/guides" },
			{ label: "Async", href: "/async" }
		]
	},

	{
		title: "Developers",
		links: [
			{ label: "Map", href: "/map" },
			{ label: "Posts", href: "/posts" },
			{
				label: "Docs",
				href: "https://example.com/docs",
				external: true
			}
		]
	},

	{
		title: "Company",
		links: [
			{ label: "About", href: "/about" },
			{ label: "Blog", href: "/blog" }
		]
	}
];


__components["PortalFooter"] = async (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2737013607000000 = document.createElement("footer");
$n2737013607000000.setAttribute("class", "portal-footer bg-white");
const $n2737013607000001 = document.createElement("div");
$n2737013607000001.setAttribute("class", "mx-auto w-full max-w-6xl px-5 py-12");
const $n2737013607000002 = document.createElement("div");
$n2737013607000002.setAttribute("class", "grid gap-10 lg:grid-cols-[1.2fr_2fr]");
const $n2737013607000003 = document.createElement("div");
const $n2737013607000004 = document.createElement("div");
$n2737013607000004.setAttribute("class", "flex items-center gap-2");
const $n2737013607000005 = document.createElement("span");
$n2737013607000005.setAttribute("class", "grid size-6 place-items-center bg-black font-display text-[11px] font-bold text-white");
const $n2737013607000006 = document.createTextNode(" P ");
$n2737013607000005.appendChild($n2737013607000006);
$n2737013607000004.appendChild($n2737013607000005);
const $n2737013607000007 = document.createElement("span");
$n2737013607000007.setAttribute("class", "font-display text-sm font-semibold tracking-tight");
const $n2737013607000008 = document.createTextNode("portal");
$n2737013607000007.appendChild($n2737013607000008);
$n2737013607000004.appendChild($n2737013607000007);
$n2737013607000003.appendChild($n2737013607000004);
const $n2737013607000009 = document.createElement("p");
$n2737013607000009.setAttribute("class", "mt-4 max-w-[34ch] font-mono text-[11.5px] leading-relaxed text-gray-500");
const $n2737013607000010 = document.createTextNode(" A layout-stress fixture mirroring a real documentation site footer. ");
$n2737013607000009.appendChild($n2737013607000010);
$n2737013607000003.appendChild($n2737013607000009);
$n2737013607000002.appendChild($n2737013607000003);
const $n2737013607000011 = document.createElement("div");
$n2737013607000011.setAttribute("class", "grid grid-cols-2 gap-8 sm:grid-cols-3");
const $n2737013607000012 = document.createComment('map');
$n2737013607000011.appendChild($n2737013607000012);
let $n2737013607000014 = [];
const $n2737013607000013 = document.createComment('map-end');
const $n2737013607000015 = async (col, __e, __r) => {
	__r = __r || $n2737013607000013;
	const __p = $n2737013607000012.parentNode;
	const __it = document.createDocumentFragment();
const $n2737013607000016 = document.createElement("div");
$n2737013607000016.setAttribute("class", "portal-col");
const $n2737013607000017 = document.createElement("p");
$n2737013607000017.setAttribute("class", "eyebrow mb-3");
const $n2737013607000018 = document.createTextNode(String((col.title) ?? ''));
$n2737013607000017.appendChild($n2737013607000018);
$n2737013607000016.appendChild($n2737013607000017);
const $n2737013607000019 = document.createElement("ul");
$n2737013607000019.setAttribute("class", "font-mono text-[12px] list-none m-0 p-0");
const $n2737013607000020 = document.createComment('map');
$n2737013607000019.appendChild($n2737013607000020);
let $n2737013607000022 = [];
const $n2737013607000021 = document.createComment('map-end');
const $n2737013607000023 = async (link, __e, __r) => {
	__r = __r || $n2737013607000021;
	const __p = $n2737013607000020.parentNode;
	const __it = document.createDocumentFragment();
const $n2737013607000024 = document.createElement("li");
const $n2737013607000025 = document.createComment('if');
$n2737013607000024.appendChild($n2737013607000025);
let $n2737013607000027 = [];
const $n2737013607000026 = document.createComment('if-end');
const $n2737013607000028 = async () => {
	const __p = $n2737013607000025.parentNode;
	const $n2737013607000029 = document.createDocumentFragment();
const $n2737013607000031 = (() => { const $f = document.createDocumentFragment();
const $n2737013607000032 = document.createTextNode(String((link.label) ?? ''));
$f.appendChild($n2737013607000032);
const $n2737013607000033 = document.createElement("span");
$n2737013607000033.setAttribute("class", "text-[10px]");
const $n2737013607000034 = document.createTextNode("↗");
$n2737013607000033.appendChild($n2737013607000034);
$f.appendChild($n2737013607000033);
return $f; })();
const $n2737013607000030 = toDomNode(await Link({ "href": link.href, "target": "_blank", "rel": "noopener", "class": "block py-1 text-gray-500 transition-colors hover:text-black no-underline", children: $n2737013607000031 }));
	$n2737013607000029.appendChild($n2737013607000030);
	__p.insertBefore($n2737013607000029, $n2737013607000026);
};
const $n2737013607000035 = async () => {
	const __p = $n2737013607000025.parentNode;
	const $n2737013607000036 = document.createDocumentFragment();
const $n2737013607000038 = (() => { const $f = document.createDocumentFragment();
const $n2737013607000039 = document.createTextNode(String((link.label) ?? ''));
$f.appendChild($n2737013607000039);
return $f; })();
const $n2737013607000037 = toDomNode(await Link({ "href": link.href, "class": "block py-1 text-gray-500 transition-colors hover:text-black no-underline", children: $n2737013607000038 }));
	$n2737013607000036.appendChild($n2737013607000037);
	__p.insertBefore($n2737013607000036, $n2737013607000026);
};
$n2737013607000024.appendChild($n2737013607000026);
if (link.external) { await $n2737013607000028(); } else { await $n2737013607000035(); }
	__it.appendChild($n2737013607000024);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2737013607000019.appendChild($n2737013607000021);
const $n2737013607000040 = () => { const __l = col.links; return __l != null && __l.length > 0; };
for (const link of col.links) {
	await $n2737013607000023(link, $n2737013607000022);
}
$n2737013607000016.appendChild($n2737013607000019);
	__it.appendChild($n2737013607000016);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2737013607000011.appendChild($n2737013607000013);
const $n2737013607000041 = () => { const __l = columns; return __l != null && __l.length > 0; };
for (const col of columns) {
	await $n2737013607000015(col, $n2737013607000014);
}
$n2737013607000002.appendChild($n2737013607000011);
$n2737013607000001.appendChild($n2737013607000002);
const $n2737013607000042 = document.createElement("div");
$n2737013607000042.setAttribute("class", "mt-12 flex flex-col gap-2 border-t border-gray-200 pt-5 font-mono text-[11px] text-gray-500 sm:flex-row sm:items-center sm:justify-between");
const $n2737013607000043 = document.createElement("span");
const $n2737013607000044 = document.createTextNode("© 2026 Portal · a layout hydration fixture");
$n2737013607000043.appendChild($n2737013607000044);
$n2737013607000042.appendChild($n2737013607000043);
const $n2737013607000045 = document.createElement("span");
const $n2737013607000046 = document.createTextNode("portal ");
$n2737013607000045.appendChild($n2737013607000046);
if (__components["BuildBadge"] == null) throw new Error("Component \"BuildBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2737013607000047 = toDomNode(await __components["BuildBadge"]({  }));
$n2737013607000045.appendChild($n2737013607000047);
$n2737013607000042.appendChild($n2737013607000045);
const $n2737013607000048 = document.createElement("p");
const $n2737013607000049 = document.createTextNode("Test Author (vesk-fixture)");
$n2737013607000048.appendChild($n2737013607000049);
$n2737013607000042.appendChild($n2737013607000048);
$n2737013607000001.appendChild($n2737013607000042);
$n2737013607000000.appendChild($n2737013607000001);
	$root.appendChild($n2737013607000000);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["PortalFooter"] = async (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2737013607000050 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2737013607000051 = __hydrate.nextElement("footer", $n2737013607000050);
$n2737013607000050 = 0;
$n2737013607000051.setAttribute("class", "portal-footer bg-white");
const $n2737013607000052 = __hydrate.subWalker($n2737013607000051);
const $n2737013607000053 = $n2737013607000052.nextElement("div", 0);
$n2737013607000053.setAttribute("class", "mx-auto w-full max-w-6xl px-5 py-12");
const $n2737013607000054 = $n2737013607000052.subWalker($n2737013607000053);
const $n2737013607000055 = $n2737013607000054.nextElement("div", 0);
$n2737013607000055.setAttribute("class", "grid gap-10 lg:grid-cols-[1.2fr_2fr]");
const $n2737013607000056 = $n2737013607000054.subWalker($n2737013607000055);
const $n2737013607000065 = $n2737013607000055.__vsk_ssrEls ? $n2737013607000055.__vsk_ssrEls[0] : (() => {
	const $n2737013607000057 = document.createElement("div");
	const $n2737013607000058 = document.createElement("div");
	$n2737013607000058.setAttribute("class", "flex items-center gap-2");
	const $n2737013607000059 = document.createElement("span");
	$n2737013607000059.setAttribute("class", "grid size-6 place-items-center bg-black font-display text-[11px] font-bold text-white");
	const $n2737013607000060 = document.createTextNode(" P ");
	$n2737013607000059.appendChild($n2737013607000060);
	$n2737013607000058.appendChild($n2737013607000059);
	const $n2737013607000061 = document.createElement("span");
	$n2737013607000061.setAttribute("class", "font-display text-sm font-semibold tracking-tight");
	const $n2737013607000062 = document.createTextNode("portal");
	$n2737013607000061.appendChild($n2737013607000062);
	$n2737013607000058.appendChild($n2737013607000061);
	$n2737013607000057.appendChild($n2737013607000058);
	const $n2737013607000063 = document.createElement("p");
	$n2737013607000063.setAttribute("class", "mt-4 max-w-[34ch] font-mono text-[11.5px] leading-relaxed text-gray-500");
	const $n2737013607000064 = document.createTextNode(" A layout-stress fixture mirroring a real documentation site footer. ");
	$n2737013607000063.appendChild($n2737013607000064);
	$n2737013607000057.appendChild($n2737013607000063);
	return $n2737013607000057;
})();
if ($n2737013607000065.parentNode !== $n2737013607000055) { if (!$n2737013607000055 || $n2737013607000065.parentNode == null || !$n2737013607000055.contains($n2737013607000065)) $n2737013607000055.appendChild($n2737013607000065); }
const $n2737013607000066 = $n2737013607000056.nextElement("div", 1);
$n2737013607000066.setAttribute("class", "grid grid-cols-2 gap-8 sm:grid-cols-3");
const $n2737013607000067 = $n2737013607000056.subWalker($n2737013607000066);
const $n2737013607000068 = document.createComment('map');
let $n2737013607000070 = [];
const $n2737013607000069 = document.createComment('map-end');
const $n2737013607000071 = async (col, __e, __r, __cl) => {
	__r = __r || $n2737013607000069;
	const __p = $n2737013607000068.parentNode;
const $n2737013607000072 = $n2737013607000067.nextElement("div", 0);
$n2737013607000072.setAttribute("class", "portal-col");
const $n2737013607000073 = $n2737013607000067.subWalker($n2737013607000072);
const $n2737013607000074 = $n2737013607000073.nextElement("p", 0);
$n2737013607000074.setAttribute("class", "eyebrow mb-3");
const $n2737013607000075 = document.createTextNode(String((col.title) ?? ''));
if ($n2737013607000075.parentNode !== $n2737013607000074) { const __ssr = $n2737013607000074.__vsk_ssrEls || []; if (0 < __ssr.length) $n2737013607000074.insertBefore($n2737013607000075, __ssr[0]); else $n2737013607000074.appendChild($n2737013607000075); }
if ($n2737013607000074.parentNode !== $n2737013607000072) { if (!$n2737013607000072 || $n2737013607000074.parentNode == null || !$n2737013607000072.contains($n2737013607000074)) $n2737013607000072.appendChild($n2737013607000074); }
const $n2737013607000076 = $n2737013607000073.nextElement("ul", 0);
$n2737013607000076.setAttribute("class", "font-mono text-[12px] list-none m-0 p-0");
const $n2737013607000077 = $n2737013607000073.subWalker($n2737013607000076);
const $n2737013607000078 = document.createComment('map');
let $n2737013607000080 = [];
const $n2737013607000079 = document.createComment('map-end');
const $n2737013607000081 = async (link, __e, __r, __cl) => {
	__r = __r || $n2737013607000079;
	const __p = $n2737013607000078.parentNode;
const $n2737013607000082 = $n2737013607000077.nextElement("li", 0);
const $n2737013607000083 = $n2737013607000077.subWalker($n2737013607000082);
const $n2737013607000084 = document.createComment('if');
let $n2737013607000086 = [];
const $n2737013607000085 = document.createComment('if-end');
const $n2737013607000087 = async () => {
	const __cl = [];
const $n2737013607000090 = (() => { const $f = document.createDocumentFragment();
const $n2737013607000091 = document.createTextNode(String((link.label) ?? ''));
$f.appendChild($n2737013607000091);
const $n2737013607000092 = document.createElement("span");
$n2737013607000092.setAttribute("class", "text-[10px]");
const $n2737013607000093 = document.createTextNode("↗");
$n2737013607000092.appendChild($n2737013607000093);
$f.appendChild($n2737013607000092);
return $f; })();
let $n2737013607000089 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2737013607000089 = toDomNode(await Link({ "href": link.href, "target": "_blank", "rel": "noopener", "class": "block py-1 text-gray-500 transition-colors hover:text-black no-underline", children: $n2737013607000090 }, __registry, $n2737013607000083)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2737013607000083.retireDetached();
	__cl.push($n2737013607000089);
	__place($n2737013607000084, $n2737013607000085, __cl, $n2737013607000082);
};
const $n2737013607000094 = async () => {
	const __cl = [];
const $n2737013607000097 = (() => { const $f = document.createDocumentFragment();
const $n2737013607000098 = document.createTextNode(String((link.label) ?? ''));
$f.appendChild($n2737013607000098);
return $f; })();
let $n2737013607000096 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2737013607000096 = toDomNode(await Link({ "href": link.href, "class": "block py-1 text-gray-500 transition-colors hover:text-black no-underline", children: $n2737013607000097 }, __registry, $n2737013607000083)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2737013607000083.retireDetached();
	__cl.push($n2737013607000096);
	__place($n2737013607000084, $n2737013607000085, __cl, $n2737013607000082);
};
if (link.external) { await $n2737013607000087(); } else { await $n2737013607000094(); }
	if (__cl) __cl.push($n2737013607000082); else __p.insertBefore($n2737013607000082, __r);
};
const $n2737013607000099 = () => { const __l = col.links; return __l != null && __l.length > 0; };
const $n2737013607000100 = [];
for (const link of col.links) {
	await $n2737013607000081(link, $n2737013607000080, null, $n2737013607000100);
}
__place($n2737013607000078, $n2737013607000079, $n2737013607000100, $n2737013607000076);
if ($n2737013607000076.parentNode !== $n2737013607000072) { if (!$n2737013607000072 || $n2737013607000076.parentNode == null || !$n2737013607000072.contains($n2737013607000076)) $n2737013607000072.appendChild($n2737013607000076); }
	if (__cl) __cl.push($n2737013607000072); else __p.insertBefore($n2737013607000072, __r);
};
const $n2737013607000101 = () => { const __l = columns; return __l != null && __l.length > 0; };
const $n2737013607000102 = [];
for (const col of columns) {
	await $n2737013607000071(col, $n2737013607000070, null, $n2737013607000102);
}
__place($n2737013607000068, $n2737013607000069, $n2737013607000102, $n2737013607000066);
if ($n2737013607000066.parentNode !== $n2737013607000055) { if (!$n2737013607000055 || $n2737013607000066.parentNode == null || !$n2737013607000055.contains($n2737013607000066)) $n2737013607000055.appendChild($n2737013607000066); }
if ($n2737013607000055.parentNode !== $n2737013607000053) { if (!$n2737013607000053 || $n2737013607000055.parentNode == null || !$n2737013607000053.contains($n2737013607000055)) $n2737013607000053.appendChild($n2737013607000055); }
const $n2737013607000103 = $n2737013607000054.nextElement("div", 0);
$n2737013607000103.setAttribute("class", "mt-12 flex flex-col gap-2 border-t border-gray-200 pt-5 font-mono text-[11px] text-gray-500 sm:flex-row sm:items-center sm:justify-between");
const $n2737013607000104 = $n2737013607000054.subWalker($n2737013607000103);
const $n2737013607000107 = $n2737013607000103.__vsk_ssrEls ? $n2737013607000103.__vsk_ssrEls[0] : (() => {
	const $n2737013607000105 = document.createElement("span");
	const $n2737013607000106 = document.createTextNode("© 2026 Portal · a layout hydration fixture");
	$n2737013607000105.appendChild($n2737013607000106);
	return $n2737013607000105;
})();
if ($n2737013607000107.parentNode !== $n2737013607000103) { if (!$n2737013607000103 || $n2737013607000107.parentNode == null || !$n2737013607000103.contains($n2737013607000107)) $n2737013607000103.appendChild($n2737013607000107); }
const $n2737013607000108 = $n2737013607000104.nextElement("span", 1);
const $n2737013607000109 = $n2737013607000104.subWalker($n2737013607000108);
const $n2737013607000110 = document.createTextNode("portal ");
if ($n2737013607000110.parentNode !== $n2737013607000108) { const __ssr = $n2737013607000108.__vsk_ssrEls || []; if (0 < __ssr.length) $n2737013607000108.insertBefore($n2737013607000110, __ssr[0]); else $n2737013607000108.appendChild($n2737013607000110); }
if (__hydrators["BuildBadge"] == null) throw new Error("Component \"BuildBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n2737013607000111 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2737013607000111 = toDomNode(await __hydrators["BuildBadge"]({  }, __registry, $n2737013607000109)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n2737013607000111.parentNode !== $n2737013607000108) { if (!$n2737013607000108 || $n2737013607000111.parentNode == null || !$n2737013607000108.contains($n2737013607000111)) $n2737013607000108.appendChild($n2737013607000111); }
if ($n2737013607000108.parentNode !== $n2737013607000103) { if (!$n2737013607000103 || $n2737013607000108.parentNode == null || !$n2737013607000103.contains($n2737013607000108)) $n2737013607000103.appendChild($n2737013607000108); }
const $n2737013607000114 = $n2737013607000103.__vsk_ssrEls ? $n2737013607000103.__vsk_ssrEls[2] : (() => {
	const $n2737013607000112 = document.createElement("p");
	const $n2737013607000113 = document.createTextNode("Test Author (vesk-fixture)");
	$n2737013607000112.appendChild($n2737013607000113);
	return $n2737013607000112;
})();
if ($n2737013607000114.parentNode !== $n2737013607000103) { if (!$n2737013607000103 || $n2737013607000114.parentNode == null || !$n2737013607000103.contains($n2737013607000114)) $n2737013607000103.appendChild($n2737013607000114); }
if ($n2737013607000103.parentNode !== $n2737013607000053) { if (!$n2737013607000053 || $n2737013607000103.parentNode == null || !$n2737013607000053.contains($n2737013607000103)) $n2737013607000053.appendChild($n2737013607000103); }
if ($n2737013607000053.parentNode !== $n2737013607000051) { if (!$n2737013607000051 || $n2737013607000053.parentNode == null || !$n2737013607000051.contains($n2737013607000053)) $n2737013607000051.appendChild($n2737013607000053); }
	if ($mount === null) $mount = $n2737013607000051;
	if ($n2737013607000051 !== $mount && $n2737013607000051.parentNode == null) $mount.appendChild($n2737013607000051);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

{
__components["PortalLayout"] = async (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2819262071000000 = document.createElement("div");
$n2819262071000000.setAttribute("class", "portal-layout min-h-screen bg-white text-black antialiased");
if (__components["PortalNav"] == null) throw new Error("Component \"PortalNav\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2819262071000001 = toDomNode(await __components["PortalNav"]({  }));
$n2819262071000000.appendChild($n2819262071000001);
const $n2819262071000002 = document.createElement("main");
$n2819262071000002.setAttribute("class", "portal-main mx-auto w-full max-w-6xl px-5 py-8");
if (props.children !== undefined && props.children !== null) $n2819262071000002.appendChild(props.children);
$n2819262071000000.appendChild($n2819262071000002);
if (__components["PortalFooter"] == null) throw new Error("Component \"PortalFooter\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2819262071000003 = toDomNode(await __components["PortalFooter"]({  }));
$n2819262071000000.appendChild($n2819262071000003);
	$root.appendChild($n2819262071000000);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["PortalLayout"] = async (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2819262071000004 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2819262071000005 = __hydrate.nextElement("div", $n2819262071000004);
$n2819262071000004 = 0;
$n2819262071000005.setAttribute("class", "portal-layout min-h-screen bg-white text-black antialiased");
const $n2819262071000006 = __hydrate.subWalker($n2819262071000005);
if (__hydrators["PortalNav"] == null) throw new Error("Component \"PortalNav\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n2819262071000007 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2819262071000007 = toDomNode(await __hydrators["PortalNav"]({  }, __registry, $n2819262071000006)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n2819262071000007.parentNode !== $n2819262071000005) { if (!$n2819262071000005 || $n2819262071000007.parentNode == null || !$n2819262071000005.contains($n2819262071000007)) $n2819262071000005.appendChild($n2819262071000007); }
const $n2819262071000008 = $n2819262071000006.nextElement("main", 0);
$n2819262071000008.setAttribute("class", "portal-main mx-auto w-full max-w-6xl px-5 py-8");
const $n2819262071000009 = $n2819262071000006.subWalker($n2819262071000008);
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    const __slot = createLayoutSlot($n2819262071000009, $n2819262071000008);
    const __child = props.children(__slot.walker);
    if (__child && typeof __child.then === 'function') __pendingChild = __slot.track(__child);
  } else {
    $n2819262071000008.appendChild(props.children);
  }
}
if ($n2819262071000008.parentNode !== $n2819262071000005) { if (!$n2819262071000005 || $n2819262071000008.parentNode == null || !$n2819262071000005.contains($n2819262071000008)) $n2819262071000005.appendChild($n2819262071000008); }
if (__hydrators["PortalFooter"] == null) throw new Error("Component \"PortalFooter\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n2819262071000010 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2819262071000010 = toDomNode(await __hydrators["PortalFooter"]({  }, __registry, $n2819262071000006)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n2819262071000010.parentNode !== $n2819262071000005) { if (!$n2819262071000005 || $n2819262071000010.parentNode == null || !$n2819262071000005.contains($n2819262071000010)) $n2819262071000005.appendChild($n2819262071000010); }
	if ($mount === null) $mount = $n2819262071000005;
	if ($n2819262071000005 !== $mount && $n2819262071000005.parentNode == null) $mount.appendChild($n2819262071000005);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Layout_Portal", { get: () => __components["PortalLayout"], configurable: true });

Object.defineProperty(__hydrators, "Layout_Portal", { get: () => __hydrators["PortalLayout"], configurable: true });
})();
