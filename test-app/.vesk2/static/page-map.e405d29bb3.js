(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const users = [
	{ id: 1, name: 'Ada', role: 'admin' },
	{ id: 2, name: 'Grace', role: 'dev' },
	{ id: 3, name: 'Alan', role: 'dev' }
];
const numbers = [1, 2, 3, 4, 5];


__components["MapDemo"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const rkItems = track([10, 20, 30]);
const rkNext = track(40);
document.title = "Map — inline .map() in JSX";
const $n2908859066000000 = document.createElement("h1");
$n2908859066000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n2908859066000001 = document.createTextNode("Inline .map() Demo");
$n2908859066000000.appendChild($n2908859066000001);
	$root.appendChild($n2908859066000000);
const $n2908859066000002 = document.createElement("h2");
$n2908859066000002.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2908859066000003 = document.createTextNode("map over objects");
$n2908859066000002.appendChild($n2908859066000003);
	$root.appendChild($n2908859066000002);
const $n2908859066000004 = document.createElement("ul");
$n2908859066000004.setAttribute("class", "space-y-2");
const $n2908859066000005 = document.createComment('map');
$n2908859066000004.appendChild($n2908859066000005);
let $n2908859066000007 = [];
const $n2908859066000006 = document.createComment('map-end');
const $n2908859066000008 = (u, __e, __r) => {
	__r = __r || $n2908859066000006;
	const __p = $n2908859066000005.parentNode;
	const __it = document.createDocumentFragment();
const $n2908859066000009 = document.createElement("li");
$n2908859066000009.setAttribute("class", "bg-gray-50 rounded px-3 py-2");
const $n2908859066000010 = document.createElement("b");
const $n2908859066000011 = document.createTextNode(String((u.name) ?? ''));
$n2908859066000010.appendChild($n2908859066000011);
$n2908859066000009.appendChild($n2908859066000010);
const $n2908859066000012 = document.createTextNode(" — ");
$n2908859066000009.appendChild($n2908859066000012);
const $n2908859066000013 = document.createTextNode(String((u.role) ?? ''));
$n2908859066000009.appendChild($n2908859066000013);
	__it.appendChild($n2908859066000009);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2908859066000004.appendChild($n2908859066000006);
const $n2908859066000014 = () => { const __l = users; return __l != null && __l.length > 0; };
for (const u of users) {
	$n2908859066000008(u, $n2908859066000007);
}
	$root.appendChild($n2908859066000004);
const $n2908859066000015 = document.createElement("h2");
$n2908859066000015.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2908859066000016 = document.createTextNode("map with index");
$n2908859066000015.appendChild($n2908859066000016);
	$root.appendChild($n2908859066000015);
const $n2908859066000017 = document.createElement("p");
const $n2908859066000018 = document.createComment('map');
$n2908859066000017.appendChild($n2908859066000018);
let $n2908859066000020 = [];
const $n2908859066000019 = document.createComment('map-end');
const $n2908859066000021 = (u, __i, __e, __r) => {
	__r = __r || $n2908859066000019;
	const i = __i;
	const __p = $n2908859066000018.parentNode;
	const __it = document.createDocumentFragment();
const $n2908859066000022 = document.createElement("span");
$n2908859066000022.setAttribute("class", "mr-3");
const $n2908859066000023 = document.createTextNode("#");
$n2908859066000022.appendChild($n2908859066000023);
const $n2908859066000024 = document.createTextNode(String((i + 1) ?? ''));
$n2908859066000022.appendChild($n2908859066000024);
const $n2908859066000025 = document.createTextNode(": ");
$n2908859066000022.appendChild($n2908859066000025);
const $n2908859066000026 = document.createTextNode(String((u.name) ?? ''));
$n2908859066000022.appendChild($n2908859066000026);
	__it.appendChild($n2908859066000022);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2908859066000017.appendChild($n2908859066000019);
const $n2908859066000027 = () => { const __l = users; return __l != null && __l.length > 0; };
let __i = 0;
for (const u of users) {
	$n2908859066000021(u, __i, $n2908859066000020);
	__i++;
}
	$root.appendChild($n2908859066000017);
const $n2908859066000028 = document.createElement("h2");
$n2908859066000028.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2908859066000029 = document.createTextNode("map with keys");
$n2908859066000028.appendChild($n2908859066000029);
	$root.appendChild($n2908859066000028);
const $n2908859066000030 = document.createElement("div");
$n2908859066000030.setAttribute("class", "flex gap-2");
const $n2908859066000031 = document.createComment('map');
$n2908859066000030.appendChild($n2908859066000031);
let $n2908859066000033 = [];
const $n2908859066000032 = document.createComment('map-end');
const $n2908859066000034 = (n, __e, __r) => {
	__r = __r || $n2908859066000032;
	const __p = $n2908859066000031.parentNode;
	const __it = document.createDocumentFragment();
const $n2908859066000035 = document.createElement("span");
$n2908859066000035.setAttribute("class", "bg-blue-600 text-white text-sm px-3 py-1 rounded-full");
const $n2908859066000036 = document.createTextNode(String((n) ?? ''));
$n2908859066000035.appendChild($n2908859066000036);
	__it.appendChild($n2908859066000035);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2908859066000030.appendChild($n2908859066000032);
const $n2908859066000037 = () => { const __l = numbers; return __l != null && __l.length > 0; };
let $n2908859066000038 = () => {};
const $n2908859066000039 = () => { $n2908859066000038 = reconcile($n2908859066000031, $n2908859066000032, numbers, (n) => n, (n, __i, __e) => $n2908859066000034(n, __e)); };
$n2908859066000039();
	$root.appendChild($n2908859066000030);
const $n2908859066000040 = document.createElement("h2");
$n2908859066000040.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2908859066000041 = document.createTextNode("reactive keyed map (claim-by-key)");
$n2908859066000040.appendChild($n2908859066000041);
	$root.appendChild($n2908859066000040);
const $n2908859066000042 = document.createElement("div");
$n2908859066000042.setAttribute("class", "flex gap-2 mb-2");
const $n2908859066000043 = document.createElement("button");
$n2908859066000043.setAttribute("class", "rounded bg-gray-200 px-3 py-1 text-sm");
const $n2908859066000044 = document.createTextNode("Add");
$n2908859066000043.appendChild($n2908859066000044);
$n2908859066000043.__evh_click = () => {
	set(rkItems, [...get(rkItems), get(rkNext)]);
	set(rkNext, get(rkNext) + 1);
};
$n2908859066000043.setAttribute('data-vsk-ev', '');
$n2908859066000042.appendChild($n2908859066000043);
const $n2908859066000045 = document.createElement("button");
$n2908859066000045.setAttribute("class", "rounded bg-gray-200 px-3 py-1 text-sm");
const $n2908859066000046 = document.createTextNode("Remove last");
$n2908859066000045.appendChild($n2908859066000046);
$n2908859066000045.__evh_click = () => {
	if (get(rkItems).length > 0) set(rkItems, get(rkItems).slice(0, -1));
};
$n2908859066000045.setAttribute('data-vsk-ev', '');
$n2908859066000042.appendChild($n2908859066000045);
const $n2908859066000047 = document.createElement("button");
$n2908859066000047.setAttribute("class", "rounded bg-gray-200 px-3 py-1 text-sm");
const $n2908859066000048 = document.createTextNode("Reverse");
$n2908859066000047.appendChild($n2908859066000048);
$n2908859066000047.__evh_click = () => {
	if (get(rkItems).length > 0) set(rkItems, [...get(rkItems)].reverse());
};
$n2908859066000047.setAttribute('data-vsk-ev', '');
$n2908859066000042.appendChild($n2908859066000047);
	$root.appendChild($n2908859066000042);
const $n2908859066000049 = document.createElement("div");
$n2908859066000049.setAttribute("id", "rk-list");
$n2908859066000049.setAttribute("class", "flex gap-2");
const $n2908859066000050 = document.createComment('map');
$n2908859066000049.appendChild($n2908859066000050);
let $n2908859066000052 = [];
const $n2908859066000051 = document.createComment('map-end');
const $n2908859066000053 = (n, __e, __r) => {
	__r = __r || $n2908859066000051;
	const __p = $n2908859066000050.parentNode;
	const __it = document.createDocumentFragment();
const $n2908859066000054 = document.createElement("span");
$n2908859066000054.setAttribute("class", "rk-chip bg-green-600 text-white text-sm px-3 py-1 rounded-full");
const $n2908859066000055 = document.createTextNode(String((n) ?? ''));
$n2908859066000054.appendChild($n2908859066000055);
	__it.appendChild($n2908859066000054);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2908859066000049.appendChild($n2908859066000051);
const $n2908859066000056 = () => { const __l = get(rkItems); return __l != null && __l.length > 0; };
let $n2908859066000057 = () => {};
const $n2908859066000058 = () => { $n2908859066000057 = reconcile($n2908859066000050, $n2908859066000051, get(rkItems), (n) => n, (n, __i, __e) => $n2908859066000053(n, __e)); };
$n2908859066000058();
	$root.appendChild($n2908859066000049);
const $n2908859066000059 = document.createElement("h2");
$n2908859066000059.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2908859066000060 = document.createTextNode("chained map + filter");
$n2908859066000059.appendChild($n2908859066000060);
	$root.appendChild($n2908859066000059);
const $n2908859066000061 = document.createElement("p");
const $n2908859066000062 = document.createComment('map');
$n2908859066000061.appendChild($n2908859066000062);
let $n2908859066000064 = [];
const $n2908859066000063 = document.createComment('map-end');
const $n2908859066000065 = (n, __e, __r) => {
	__r = __r || $n2908859066000063;
	const __p = $n2908859066000062.parentNode;
	const __it = document.createDocumentFragment();
const $n2908859066000066 = document.createElement("span");
$n2908859066000066.setAttribute("class", "mr-3");
const $n2908859066000067 = document.createTextNode(String((n) ?? ''));
$n2908859066000066.appendChild($n2908859066000067);
const $n2908859066000068 = document.createTextNode("²=");
$n2908859066000066.appendChild($n2908859066000068);
const $n2908859066000069 = document.createTextNode(String((n * n) ?? ''));
$n2908859066000066.appendChild($n2908859066000069);
	__it.appendChild($n2908859066000066);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2908859066000061.appendChild($n2908859066000063);
const $n2908859066000070 = () => { const __l = numbers.filter((n) => n % 2 === 1); return __l != null && __l.length > 0; };
for (const n of numbers.filter((n) => n % 2 === 1)) {
	$n2908859066000065(n, $n2908859066000064);
}
	$root.appendChild($n2908859066000061);
	{
	  let __first = true;
	  effect(() => {
	    const __nv = get(rkItems);
	    if (__first) { __first = false; __nv; $n2908859066000057(get(rkItems)); return; }
	    $n2908859066000057(get(rkItems));
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __nv = numbers.filter((n) => n % 2 === 1);
	    if (__first) { __first = false; __nv; return; }
	    for (const e of $n2908859066000064) destroy_block(e);
	    $n2908859066000064.length = 0;
	    __cleanup($n2908859066000062, $n2908859066000063);
	    for (const n of numbers.filter((n) => n % 2 === 1)) {
	    	$n2908859066000065(n, $n2908859066000064);
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
__hydrators["MapDemo"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const rkItems = track([10, 20, 30]);
const rkNext = track(40);
let $n2908859066000071 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Map — inline .map() in JSX";
const $n2908859066000074 = __hydrate.nextElement("ul", $n2908859066000071 + 2);
$n2908859066000071 = 0;
$n2908859066000074.setAttribute("class", "space-y-2");
const $n2908859066000075 = __hydrate.subWalker($n2908859066000074);
const $n2908859066000076 = document.createComment('map');
let $n2908859066000078 = [];
const $n2908859066000077 = document.createComment('map-end');
const $n2908859066000079 = (u, __e, __r, __cl) => {
	__r = __r || $n2908859066000077;
	const __p = $n2908859066000076.parentNode;
const $n2908859066000080 = $n2908859066000075.nextElement("li", 0);
$n2908859066000080.setAttribute("class", "bg-gray-50 rounded px-3 py-2");
const $n2908859066000081 = $n2908859066000075.subWalker($n2908859066000080);
const $n2908859066000082 = $n2908859066000081.nextElement("b", 0);
const $n2908859066000083 = document.createTextNode(String((u.name) ?? ''));
if ($n2908859066000083.parentNode !== $n2908859066000082) { const __ssr = $n2908859066000082.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000082.insertBefore($n2908859066000083, __ssr[0]); else $n2908859066000082.appendChild($n2908859066000083); }
if ($n2908859066000082.parentNode !== $n2908859066000080) { if (!$n2908859066000080 || $n2908859066000082.parentNode == null || !$n2908859066000080.contains($n2908859066000082)) $n2908859066000080.appendChild($n2908859066000082); }
const $n2908859066000084 = document.createTextNode(" — ");
if ($n2908859066000084.parentNode !== $n2908859066000080) { const __ssr = $n2908859066000080.__vsk_ssrEls || []; if (1 < __ssr.length) $n2908859066000080.insertBefore($n2908859066000084, __ssr[1]); else $n2908859066000080.appendChild($n2908859066000084); }
const $n2908859066000085 = document.createTextNode(String((u.role) ?? ''));
if ($n2908859066000085.parentNode !== $n2908859066000080) { const __ssr = $n2908859066000080.__vsk_ssrEls || []; if (1 < __ssr.length) $n2908859066000080.insertBefore($n2908859066000085, __ssr[1]); else $n2908859066000080.appendChild($n2908859066000085); }
	if (__cl) __cl.push($n2908859066000080); else __p.insertBefore($n2908859066000080, __r);
};
const $n2908859066000086 = () => { const __l = users; return __l != null && __l.length > 0; };
const $n2908859066000087 = [];
for (const u of users) {
	$n2908859066000079(u, $n2908859066000078, null, $n2908859066000087);
}
__place($n2908859066000076, $n2908859066000077, $n2908859066000087, $n2908859066000074);
	if ($mount === null) $mount = $n2908859066000074;
	if ($n2908859066000074 !== $mount && $n2908859066000074.parentNode == null) $mount.appendChild($n2908859066000074);
const $n2908859066000089 = __hydrate.nextElement("p", 1);
const $n2908859066000090 = __hydrate.subWalker($n2908859066000089);
const $n2908859066000091 = document.createComment('map');
let $n2908859066000093 = [];
const $n2908859066000092 = document.createComment('map-end');
const $n2908859066000094 = (u, __i, __e, __r, __cl) => {
	__r = __r || $n2908859066000092;
	const i = __i;
	const __p = $n2908859066000091.parentNode;
const $n2908859066000095 = $n2908859066000090.nextElement("span", 0);
$n2908859066000095.setAttribute("class", "mr-3");
const $n2908859066000096 = document.createTextNode("#");
if ($n2908859066000096.parentNode !== $n2908859066000095) { const __ssr = $n2908859066000095.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000095.insertBefore($n2908859066000096, __ssr[0]); else $n2908859066000095.appendChild($n2908859066000096); }
const $n2908859066000097 = document.createTextNode(String((i + 1) ?? ''));
if ($n2908859066000097.parentNode !== $n2908859066000095) { const __ssr = $n2908859066000095.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000095.insertBefore($n2908859066000097, __ssr[0]); else $n2908859066000095.appendChild($n2908859066000097); }
const $n2908859066000098 = document.createTextNode(": ");
if ($n2908859066000098.parentNode !== $n2908859066000095) { const __ssr = $n2908859066000095.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000095.insertBefore($n2908859066000098, __ssr[0]); else $n2908859066000095.appendChild($n2908859066000098); }
const $n2908859066000099 = document.createTextNode(String((u.name) ?? ''));
if ($n2908859066000099.parentNode !== $n2908859066000095) { const __ssr = $n2908859066000095.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000095.insertBefore($n2908859066000099, __ssr[0]); else $n2908859066000095.appendChild($n2908859066000099); }
	if (__cl) __cl.push($n2908859066000095); else __p.insertBefore($n2908859066000095, __r);
};
const $n2908859066000100 = () => { const __l = users; return __l != null && __l.length > 0; };
const $n2908859066000101 = [];
let __i = 0;
for (const u of users) {
	$n2908859066000094(u, __i, $n2908859066000093, null, $n2908859066000101);
	__i++;
}
__place($n2908859066000091, $n2908859066000092, $n2908859066000101, $n2908859066000089);
	if ($mount === null) $mount = $n2908859066000089;
	if ($n2908859066000089 !== $mount && $n2908859066000089.parentNode == null) $mount.appendChild($n2908859066000089);
const $n2908859066000103 = __hydrate.nextElement("div", 1);
$n2908859066000103.setAttribute("class", "flex gap-2");
const $n2908859066000104 = __hydrate.subWalker($n2908859066000103);
const $n2908859066000105 = document.createComment('map');
let $n2908859066000107 = [];
const $n2908859066000106 = document.createComment('map-end');
const $n2908859066000108 = (n, __e, __r, __root) => {
	__r = __r || $n2908859066000106;
	const __p = $n2908859066000105.parentNode;
	const __it = document.createDocumentFragment();
const $n2908859066000109 = __root || document.createElement("span");
$n2908859066000109.setAttribute("class", "bg-blue-600 text-white text-sm px-3 py-1 rounded-full");
const $n2908859066000110 = document.createTextNode(String((n) ?? ''));
if ($n2908859066000110.parentNode !== $n2908859066000109) { const __ssr = $n2908859066000109.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000109.insertBefore($n2908859066000110, __ssr[0]); else $n2908859066000109.appendChild($n2908859066000110); }
	if (__root != null) { if ($n2908859066000109.parentNode == null) __p.insertBefore($n2908859066000109, __root.nextSibling); } else __it.appendChild($n2908859066000109);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
const $n2908859066000111 = () => { const __l = numbers; return __l != null && __l.length > 0; };
let $n2908859066000112 = () => {};
const $n2908859066000113 = () => { $n2908859066000112 = reconcileHydrated($n2908859066000105, $n2908859066000106, numbers, (n) => n, (n, __i, __e, __root) => $n2908859066000108(n, __e, null, __root), __hydrate, $n2908859066000103, 0); };
$n2908859066000113();
	if ($mount === null) $mount = $n2908859066000103;
	if ($n2908859066000103 !== $mount && $n2908859066000103.parentNode == null) $mount.appendChild($n2908859066000103);
const $n2908859066000115 = __hydrate.nextElement("div", 1);
$n2908859066000115.setAttribute("class", "flex gap-2 mb-2");
const $n2908859066000116 = __hydrate.subWalker($n2908859066000115);
const $n2908859066000117 = $n2908859066000116.nextElement("button", 0);
$n2908859066000117.setAttribute("class", "rounded bg-gray-200 px-3 py-1 text-sm");
const $n2908859066000118 = document.createTextNode("Add");
if ($n2908859066000118.parentNode !== $n2908859066000117) { const __ssr = $n2908859066000117.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000117.insertBefore($n2908859066000118, __ssr[0]); else $n2908859066000117.appendChild($n2908859066000118); }
$n2908859066000117.__evh_click = () => {
	set(rkItems, [...get(rkItems), get(rkNext)]);
	set(rkNext, get(rkNext) + 1);
};
$n2908859066000117.setAttribute('data-vsk-ev', '');
if ($n2908859066000117.parentNode !== $n2908859066000115) { if (!$n2908859066000115 || $n2908859066000117.parentNode == null || !$n2908859066000115.contains($n2908859066000117)) $n2908859066000115.appendChild($n2908859066000117); }
const $n2908859066000119 = $n2908859066000116.nextElement("button", 0);
$n2908859066000119.setAttribute("class", "rounded bg-gray-200 px-3 py-1 text-sm");
const $n2908859066000120 = document.createTextNode("Remove last");
if ($n2908859066000120.parentNode !== $n2908859066000119) { const __ssr = $n2908859066000119.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000119.insertBefore($n2908859066000120, __ssr[0]); else $n2908859066000119.appendChild($n2908859066000120); }
$n2908859066000119.__evh_click = () => {
	if (get(rkItems).length > 0) set(rkItems, get(rkItems).slice(0, -1));
};
$n2908859066000119.setAttribute('data-vsk-ev', '');
if ($n2908859066000119.parentNode !== $n2908859066000115) { if (!$n2908859066000115 || $n2908859066000119.parentNode == null || !$n2908859066000115.contains($n2908859066000119)) $n2908859066000115.appendChild($n2908859066000119); }
const $n2908859066000121 = $n2908859066000116.nextElement("button", 0);
$n2908859066000121.setAttribute("class", "rounded bg-gray-200 px-3 py-1 text-sm");
const $n2908859066000122 = document.createTextNode("Reverse");
if ($n2908859066000122.parentNode !== $n2908859066000121) { const __ssr = $n2908859066000121.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000121.insertBefore($n2908859066000122, __ssr[0]); else $n2908859066000121.appendChild($n2908859066000122); }
$n2908859066000121.__evh_click = () => {
	if (get(rkItems).length > 0) set(rkItems, [...get(rkItems)].reverse());
};
$n2908859066000121.setAttribute('data-vsk-ev', '');
if ($n2908859066000121.parentNode !== $n2908859066000115) { if (!$n2908859066000115 || $n2908859066000121.parentNode == null || !$n2908859066000115.contains($n2908859066000121)) $n2908859066000115.appendChild($n2908859066000121); }
	if ($mount === null) $mount = $n2908859066000115;
	if ($n2908859066000115 !== $mount && $n2908859066000115.parentNode == null) $mount.appendChild($n2908859066000115);
const $n2908859066000123 = __hydrate.nextElement("div", 0);
$n2908859066000123.setAttribute("id", "rk-list");
$n2908859066000123.setAttribute("class", "flex gap-2");
const $n2908859066000124 = __hydrate.subWalker($n2908859066000123);
const $n2908859066000125 = document.createComment('map');
let $n2908859066000127 = [];
const $n2908859066000126 = document.createComment('map-end');
const $n2908859066000128 = (n, __e, __r, __root) => {
	__r = __r || $n2908859066000126;
	const __p = $n2908859066000125.parentNode;
	const __it = document.createDocumentFragment();
const $n2908859066000129 = __root || document.createElement("span");
$n2908859066000129.setAttribute("class", "rk-chip bg-green-600 text-white text-sm px-3 py-1 rounded-full");
const $n2908859066000130 = document.createTextNode(String((n) ?? ''));
if ($n2908859066000130.parentNode !== $n2908859066000129) { const __ssr = $n2908859066000129.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000129.insertBefore($n2908859066000130, __ssr[0]); else $n2908859066000129.appendChild($n2908859066000130); }
	if (__root != null) { if ($n2908859066000129.parentNode == null) __p.insertBefore($n2908859066000129, __root.nextSibling); } else __it.appendChild($n2908859066000129);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
const $n2908859066000131 = () => { const __l = get(rkItems); return __l != null && __l.length > 0; };
let $n2908859066000132 = () => {};
const $n2908859066000133 = () => { $n2908859066000132 = reconcileHydrated($n2908859066000125, $n2908859066000126, get(rkItems), (n) => n, (n, __i, __e, __root) => $n2908859066000128(n, __e, null, __root), __hydrate, $n2908859066000123, 0); };
$n2908859066000133();
	if ($mount === null) $mount = $n2908859066000123;
	if ($n2908859066000123 !== $mount && $n2908859066000123.parentNode == null) $mount.appendChild($n2908859066000123);
const $n2908859066000135 = __hydrate.nextElement("p", 1);
const $n2908859066000136 = __hydrate.subWalker($n2908859066000135);
const $n2908859066000137 = document.createComment('map');
let $n2908859066000139 = [];
const $n2908859066000138 = document.createComment('map-end');
const $n2908859066000140 = (n, __e, __r, __cl) => {
	__r = __r || $n2908859066000138;
	const __p = $n2908859066000137.parentNode;
const $n2908859066000141 = $n2908859066000136.nextElement("span", 0);
$n2908859066000141.setAttribute("class", "mr-3");
const $n2908859066000142 = document.createTextNode(String((n) ?? ''));
if ($n2908859066000142.parentNode !== $n2908859066000141) { const __ssr = $n2908859066000141.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000141.insertBefore($n2908859066000142, __ssr[0]); else $n2908859066000141.appendChild($n2908859066000142); }
const $n2908859066000143 = document.createTextNode("²=");
if ($n2908859066000143.parentNode !== $n2908859066000141) { const __ssr = $n2908859066000141.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000141.insertBefore($n2908859066000143, __ssr[0]); else $n2908859066000141.appendChild($n2908859066000143); }
const $n2908859066000144 = document.createTextNode(String((n * n) ?? ''));
if ($n2908859066000144.parentNode !== $n2908859066000141) { const __ssr = $n2908859066000141.__vsk_ssrEls || []; if (0 < __ssr.length) $n2908859066000141.insertBefore($n2908859066000144, __ssr[0]); else $n2908859066000141.appendChild($n2908859066000144); }
	if (__cl) __cl.push($n2908859066000141); else __p.insertBefore($n2908859066000141, __r);
};
const $n2908859066000145 = () => { const __l = numbers.filter((n) => n % 2 === 1); return __l != null && __l.length > 0; };
const $n2908859066000146 = [];
for (const n of numbers.filter((n) => n % 2 === 1)) {
	$n2908859066000140(n, $n2908859066000139, null, $n2908859066000146);
}
__place($n2908859066000137, $n2908859066000138, $n2908859066000146, $n2908859066000135);
	if ($mount === null) $mount = $n2908859066000135;
	if ($n2908859066000135 !== $mount && $n2908859066000135.parentNode == null) $mount.appendChild($n2908859066000135);
	{
	  let __first = true;
	  effect(() => {
	    const __nv = get(rkItems);
	    if (__first) { __first = false; __nv; $n2908859066000132(get(rkItems)); return; }
	    $n2908859066000132(get(rkItems));
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __nv = numbers.filter((n) => n % 2 === 1);
	    if (__first) { __first = false; __nv; return; }
	    for (const e of $n2908859066000139) destroy_block(e);
	    $n2908859066000139.length = 0;
	    __cleanup($n2908859066000137, $n2908859066000138);
	    for (const n of numbers.filter((n) => n % 2 === 1)) {
	    	$n2908859066000140(n, $n2908859066000139);
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

Object.defineProperty(__components, "Page_Map", { get: () => __components["MapDemo"], configurable: true });

Object.defineProperty(__hydrators, "Page_Map", { get: () => __hydrators["MapDemo"], configurable: true });
})();
