(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["Home"] = async (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const count = track(10);
const postCe = track([]);
useFetch("/api/posts", { key: "posts", into: postCe });
document.title = " VeskTS test app ";
const $n2754711321000000 = document.createElement("div");
$n2754711321000000.setAttribute("class", '');
const $n2754711321000001 = document.createComment('map');
$n2754711321000000.appendChild($n2754711321000001);
let $n2754711321000003 = [];
const $n2754711321000002 = document.createComment('map-end');
const $n2754711321000004 = async (p, __e, __r) => {
	__r = __r || $n2754711321000002;
	const __p = $n2754711321000001.parentNode;
	const __it = document.createDocumentFragment();
const $n2754711321000005 = document.createElement("p");
const $n2754711321000006 = document.createTextNode(String((p.title) ?? ''));
$n2754711321000005.appendChild($n2754711321000006);
	__it.appendChild($n2754711321000005);
const $n2754711321000007 = document.createElement("p");
const $n2754711321000008 = document.createTextNode(String((p.slug) ?? ''));
$n2754711321000007.appendChild($n2754711321000008);
	__it.appendChild($n2754711321000007);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n2754711321000000.appendChild($n2754711321000002);
const $n2754711321000009 = () => { const __l = get(postCe); return __l != null && __l.length > 0; };
for (const p of get(postCe)) {
	await $n2754711321000004(p, $n2754711321000003);
}
	$root.appendChild($n2754711321000000);
const $n2754711321000010 = document.createElement("h1");
$n2754711321000010.setAttribute("class", "text-4xl font-bold mb-2");
const $n2754711321000011 = document.createTextNode("Welcome to Vesk");
$n2754711321000010.appendChild($n2754711321000011);
	$root.appendChild($n2754711321000010);
const $n2754711321000012 = document.createElement("p");
$n2754711321000012.setAttribute("class", "text-gray-500 mb-4 text-purple-500");
const $n2754711321000013 = document.createTextNode(" A compiler-first reactive UI framework for the post-VDOM web. I love to build technology people use everyday ");
$n2754711321000012.appendChild($n2754711321000013);
	$root.appendChild($n2754711321000012);
const $n2754711321000014 = document.createElement("p");
const $n2754711321000015 = document.createTextNode('');
$n2754711321000014.appendChild($n2754711321000015);
	$root.appendChild($n2754711321000014);
const $n2754711321000016 = document.createComment('if');
$root.appendChild($n2754711321000016);
let $n2754711321000018 = [];
const $n2754711321000017 = document.createComment('if-end');
const $n2754711321000019 = async () => {
	const __p = $n2754711321000016.parentNode;
	const $n2754711321000020 = document.createDocumentFragment();
const $n2754711321000021 = document.createElement("p");
const $n2754711321000022 = document.createTextNode(" 2 is higher");
$n2754711321000021.appendChild($n2754711321000022);
	$n2754711321000020.appendChild($n2754711321000021);
	__p.insertBefore($n2754711321000020, $n2754711321000017);
};
const $n2754711321000023 = async () => {
	const __p = $n2754711321000016.parentNode;
	const $n2754711321000024 = document.createDocumentFragment();
const $n2754711321000025 = document.createElement("p");
const $n2754711321000026 = document.createTextNode(" Hurray 3 people won");
$n2754711321000025.appendChild($n2754711321000026);
	$n2754711321000024.appendChild($n2754711321000025);
	__p.insertBefore($n2754711321000024, $n2754711321000017);
};
$root.appendChild($n2754711321000017);
if (2 > 3) { await $n2754711321000019(); } else { await $n2754711321000023(); }
const $n2754711321000027 = document.createElement("button");
const $n2754711321000028 = document.createTextNode(" + ");
$n2754711321000027.appendChild($n2754711321000028);
$n2754711321000027.__evh_click = () => set(count, get(count) + 1);
$n2754711321000027.setAttribute('data-vsk-ev', '');
	$root.appendChild($n2754711321000027);
const $n2754711321000029 = document.createElement("div");
$n2754711321000029.setAttribute("class", "bg-white gg rounded-xl p-6 shadow-sm border border-gray-100");
const $n2754711321000030 = document.createElement("h2");
$n2754711321000030.setAttribute("class", "text-xl  font-semibold mb-2");
const $n2754711321000031 = document.createTextNode("Getting Started");
$n2754711321000030.appendChild($n2754711321000031);
$n2754711321000029.appendChild($n2754711321000030);
const $n2754711321000032 = document.createElement("p");
const $n2754711321000033 = document.createTextNode("Edit ");
$n2754711321000032.appendChild($n2754711321000033);
const $n2754711321000034 = document.createElement("code");
$n2754711321000034.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n2754711321000035 = document.createTextNode("app/page.vsk");
$n2754711321000034.appendChild($n2754711321000035);
$n2754711321000032.appendChild($n2754711321000034);
const $n2754711321000036 = document.createTextNode(" to change this page.");
$n2754711321000032.appendChild($n2754711321000036);
$n2754711321000029.appendChild($n2754711321000032);
const $n2754711321000037 = document.createElement("style");
const $n2754711321000038 = document.createTextNode(" .gg { color: red; background: 3; border: 4px; }  ");
$n2754711321000037.appendChild($n2754711321000038);
$n2754711321000029.appendChild($n2754711321000037);
if (__components["Appx"] == null) throw new Error("Component \"Appx\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2754711321000039 = toDomNode(await __components["Appx"]({  }));
$n2754711321000029.appendChild($n2754711321000039);
if (__components["Appxx"] == null) throw new Error("Component \"Appxx\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2754711321000040 = toDomNode(await __components["Appxx"]({ "count": count }));
$n2754711321000029.appendChild($n2754711321000040);
	$root.appendChild($n2754711321000029);
	{
	  let __first = true;
	  effect(async () => {
	    const __nv = get(postCe);
	    if (__first) { __first = false; __nv; return; }
	    for (const e of $n2754711321000003) destroy_block(e);
	    $n2754711321000003.length = 0;
	    __cleanup($n2754711321000001, $n2754711321000002);
	    for (const p of get(postCe)) {
	    	await $n2754711321000004(p, $n2754711321000003);
	    }
	  });
	}
	effect(() => { const __v = get(count); $n2754711321000015.data = __v == null ? '' : String(__v); });
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

__components["Throws"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
if (props.fail) throw new Error(props.msg);
const $n2754711321000041 = document.createElement("p");
const $n2754711321000042 = document.createTextNode("OK");
$n2754711321000041.appendChild($n2754711321000042);
	$root.appendChild($n2754711321000041);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Appx"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2754711321000043 = document.createComment('try');
$root.appendChild($n2754711321000043);
let $n2754711321000045 = [];
const $n2754711321000044 = document.createComment('try-end');
const $n2754711321000046 = () => {
	const __p = $n2754711321000043.parentNode;
if (__components["Throws"] == null) throw new Error("Component \"Throws\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2754711321000047 = toDomNode(__components["Throws"]({ "fail": true, "count": 0, "msg": "Boom!" }));
	__p.insertBefore($n2754711321000047, $n2754711321000044);
};
const $n2754711321000048 = (e) => {
	const __p = $n2754711321000043.parentNode;
const $n2754711321000049 = document.createElement("p");
$n2754711321000049.setAttribute("class", "error");
const $n2754711321000050 = document.createTextNode("Error: ");
$n2754711321000049.appendChild($n2754711321000050);
const $n2754711321000051 = document.createTextNode(String((e.message) ?? ''));
$n2754711321000049.appendChild($n2754711321000051);
	__p.insertBefore($n2754711321000049, $n2754711321000044);
};
$root.appendChild($n2754711321000044);
try { $n2754711321000046(); } catch(e) { $n2754711321000048(e); }
const $n2754711321000052 = () => {
	const __p = $n2754711321000043.parentNode;
if (__runtime_comps["Throws"] == null) throw new Error("Component \"Throws\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2754711321000053 = toDomNode(__runtime_comps["Throws"]({ "fail": true, "count": 0, "msg": "Boom!" }));
	__p.insertBefore($n2754711321000053, $n2754711321000044);
};
const $n2754711321000054 = (e) => {
	const __p = $n2754711321000043.parentNode;
const $n2754711321000055 = document.createElement("p");
$n2754711321000055.setAttribute("class", "error");
const $n2754711321000056 = document.createTextNode("Error: ");
$n2754711321000055.appendChild($n2754711321000056);
const $n2754711321000057 = document.createTextNode(String((e.message) ?? ''));
$n2754711321000055.appendChild($n2754711321000057);
	__p.insertBefore($n2754711321000055, $n2754711321000044);
};
	{
	    effect(() => {
	      for (const e of $n2754711321000045) destroy_block(e);
	      $n2754711321000045.length = 0;
	      __cleanup($n2754711321000043, $n2754711321000044);
	      try { $n2754711321000052(); } catch(e) { $n2754711321000054(e); }
	    });
	  }
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Throw"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
if (props.count < 15) throw new Error(props.msg);
const $n2754711321000058 = document.createElement("p");
const $n2754711321000059 = document.createTextNode("OK ");
$n2754711321000058.appendChild($n2754711321000059);
const $n2754711321000060 = document.createTextNode('');
$n2754711321000058.appendChild($n2754711321000060);
	$root.appendChild($n2754711321000058);
	effect(() => { const __v = props.count; $n2754711321000060.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Appxx"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2754711321000061 = document.createElement("p");
const $n2754711321000062 = document.createTextNode(" Count: ");
$n2754711321000061.appendChild($n2754711321000062);
const $n2754711321000063 = document.createTextNode('');
$n2754711321000061.appendChild($n2754711321000063);
	$root.appendChild($n2754711321000061);
const $n2754711321000064 = document.createComment('try');
$root.appendChild($n2754711321000064);
let $n2754711321000066 = [];
const $n2754711321000065 = document.createComment('try-end');
const $n2754711321000067 = () => {
	const __p = $n2754711321000064.parentNode;
if (__components["Throw"] == null) throw new Error("Component \"Throw\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2754711321000068 = toDomNode(__components["Throw"]({ "count": props.count, "fail": true, "msg": `Insufficient! ${props.count} ` }));
	__p.insertBefore($n2754711321000068, $n2754711321000065);
};
const $n2754711321000069 = (e) => {
	const __p = $n2754711321000064.parentNode;
const $n2754711321000070 = document.createElement("p");
$n2754711321000070.setAttribute("class", "error");
const $n2754711321000071 = document.createTextNode("Error: ");
$n2754711321000070.appendChild($n2754711321000071);
const $n2754711321000072 = document.createTextNode(String((e.message) ?? ''));
$n2754711321000070.appendChild($n2754711321000072);
	__p.insertBefore($n2754711321000070, $n2754711321000065);
};
$root.appendChild($n2754711321000065);
try { $n2754711321000067(); } catch(e) { $n2754711321000069(e); }
const $n2754711321000073 = () => {
	const __p = $n2754711321000064.parentNode;
if (__runtime_comps["Throw"] == null) throw new Error("Component \"Throw\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2754711321000074 = toDomNode(__runtime_comps["Throw"]({ "count": props.count, "fail": true, "msg": `Insufficient! ${props.count} ` }));
	__p.insertBefore($n2754711321000074, $n2754711321000065);
};
const $n2754711321000075 = (e) => {
	const __p = $n2754711321000064.parentNode;
const $n2754711321000076 = document.createElement("p");
$n2754711321000076.setAttribute("class", "error");
const $n2754711321000077 = document.createTextNode("Error: ");
$n2754711321000076.appendChild($n2754711321000077);
const $n2754711321000078 = document.createTextNode(String((e.message) ?? ''));
$n2754711321000076.appendChild($n2754711321000078);
	__p.insertBefore($n2754711321000076, $n2754711321000065);
};
	effect(() => { const __v = props.count; $n2754711321000063.data = __v == null ? '' : String(__v); });
	{
	    effect(() => {
	      for (const e of $n2754711321000066) destroy_block(e);
	      $n2754711321000066.length = 0;
	      __cleanup($n2754711321000064, $n2754711321000065);
	      try { $n2754711321000073(); } catch(e) { $n2754711321000075(e); }
	    });
	  }
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Home"] = async (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const count = track(10);
const postCe = track([]);
let $n2754711321000079 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
useFetch("/api/posts", { key: "posts", into: postCe });
document.title = " VeskTS test app ";
const $n2754711321000080 = __hydrate.nextElement("div", $n2754711321000079);
$n2754711321000079 = 0;
$n2754711321000080.setAttribute("class", '');
const $n2754711321000081 = __hydrate.subWalker($n2754711321000080);
const $n2754711321000082 = document.createComment('map');
let $n2754711321000084 = [];
const $n2754711321000083 = document.createComment('map-end');
const $n2754711321000085 = async (p, __e, __r, __cl) => {
	__r = __r || $n2754711321000083;
	const __p = $n2754711321000082.parentNode;
const $n2754711321000086 = $n2754711321000081.nextElement("p", 0);
const $n2754711321000087 = document.createTextNode(String((p.title) ?? ''));
if ($n2754711321000087.parentNode !== $n2754711321000086) { const __ssr = $n2754711321000086.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000086.insertBefore($n2754711321000087, __ssr[0]); else $n2754711321000086.appendChild($n2754711321000087); }
	if (__cl) __cl.push($n2754711321000086); else __p.insertBefore($n2754711321000086, __r);
const $n2754711321000088 = $n2754711321000081.nextElement("p", 0);
const $n2754711321000089 = document.createTextNode(String((p.slug) ?? ''));
if ($n2754711321000089.parentNode !== $n2754711321000088) { const __ssr = $n2754711321000088.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000088.insertBefore($n2754711321000089, __ssr[0]); else $n2754711321000088.appendChild($n2754711321000089); }
	if (__cl) __cl.push($n2754711321000088); else __p.insertBefore($n2754711321000088, __r);
};
const $n2754711321000090 = () => { const __l = get(postCe); return __l != null && __l.length > 0; };
const $n2754711321000091 = [];
for (const p of get(postCe)) {
	await $n2754711321000085(p, $n2754711321000084, null, $n2754711321000091);
}
__place($n2754711321000082, $n2754711321000083, $n2754711321000091, $n2754711321000080);
	if ($mount === null) $mount = $n2754711321000080;
	if ($n2754711321000080 !== $mount && $n2754711321000080.parentNode == null) $mount.appendChild($n2754711321000080);
const $n2754711321000094 = __hydrate.nextElement("p", 2);
const $n2754711321000095 = document.createTextNode(String($n2754711321000094.__vsk_ssrText ?? ''));
if ($n2754711321000095.parentNode !== $n2754711321000094) { const __ssr = $n2754711321000094.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000094.insertBefore($n2754711321000095, __ssr[0]); else $n2754711321000094.appendChild($n2754711321000095); }
	if ($mount === null) $mount = $n2754711321000094;
	if ($n2754711321000094 !== $mount && $n2754711321000094.parentNode == null) $mount.appendChild($n2754711321000094);
const $n2754711321000096 = document.createComment('if');
let $n2754711321000098 = [];
const $n2754711321000097 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2754711321000096);
	__hydrate.insertBeforeNextClaim($n2754711321000097);
}
const $n2754711321000099 = async () => {
	const __cl = [];
const $n2754711321000101 = __hydrate.nextElement("p", 0);
const $n2754711321000102 = document.createTextNode(" 2 is higher");
if ($n2754711321000102.parentNode !== $n2754711321000101) { const __ssr = $n2754711321000101.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000101.insertBefore($n2754711321000102, __ssr[0]); else $n2754711321000101.appendChild($n2754711321000102); }
	__cl.push($n2754711321000101);
	__place($n2754711321000096, $n2754711321000097, __cl, $root);
};
const $n2754711321000103 = async () => {
	const __cl = [];
const $n2754711321000105 = __hydrate.nextElement("p", 0);
const $n2754711321000106 = document.createTextNode(" Hurray 3 people won");
if ($n2754711321000106.parentNode !== $n2754711321000105) { const __ssr = $n2754711321000105.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000105.insertBefore($n2754711321000106, __ssr[0]); else $n2754711321000105.appendChild($n2754711321000106); }
	__cl.push($n2754711321000105);
	__place($n2754711321000096, $n2754711321000097, __cl, $root);
};
if (2 > 3) { await $n2754711321000099(); } else { await $n2754711321000103(); }
const $n2754711321000107 = __hydrate.nextElement("button", 0);
const $n2754711321000108 = document.createTextNode(" + ");
if ($n2754711321000108.parentNode !== $n2754711321000107) { const __ssr = $n2754711321000107.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000107.insertBefore($n2754711321000108, __ssr[0]); else $n2754711321000107.appendChild($n2754711321000108); }
$n2754711321000107.__evh_click = () => set(count, get(count) + 1);
$n2754711321000107.setAttribute('data-vsk-ev', '');
	if ($mount === null) $mount = $n2754711321000107;
	if ($n2754711321000107 !== $mount && $n2754711321000107.parentNode == null) $mount.appendChild($n2754711321000107);
const $n2754711321000109 = __hydrate.nextElement("div", 0);
$n2754711321000109.setAttribute("class", "bg-white gg rounded-xl p-6 shadow-sm border border-gray-100");
const $n2754711321000110 = __hydrate.subWalker($n2754711321000109);
const $n2754711321000113 = $n2754711321000109.__vsk_ssrEls ? $n2754711321000109.__vsk_ssrEls[0] : (() => {
	const $n2754711321000111 = document.createElement("h2");
	$n2754711321000111.setAttribute("class", "text-xl  font-semibold mb-2");
	const $n2754711321000112 = document.createTextNode("Getting Started");
	$n2754711321000111.appendChild($n2754711321000112);
	return $n2754711321000111;
})();
if ($n2754711321000113.parentNode !== $n2754711321000109) { if (!$n2754711321000109 || $n2754711321000113.parentNode == null || !$n2754711321000109.contains($n2754711321000113)) $n2754711321000109.appendChild($n2754711321000113); }
const $n2754711321000119 = $n2754711321000109.__vsk_ssrEls ? $n2754711321000109.__vsk_ssrEls[1] : (() => {
	const $n2754711321000114 = document.createElement("p");
	const $n2754711321000115 = document.createTextNode("Edit ");
	$n2754711321000114.appendChild($n2754711321000115);
	const $n2754711321000116 = document.createElement("code");
	$n2754711321000116.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
	const $n2754711321000117 = document.createTextNode("app/page.vsk");
	$n2754711321000116.appendChild($n2754711321000117);
	$n2754711321000114.appendChild($n2754711321000116);
	const $n2754711321000118 = document.createTextNode(" to change this page.");
	$n2754711321000114.appendChild($n2754711321000118);
	return $n2754711321000114;
})();
if ($n2754711321000119.parentNode !== $n2754711321000109) { if (!$n2754711321000109 || $n2754711321000119.parentNode == null || !$n2754711321000109.contains($n2754711321000119)) $n2754711321000109.appendChild($n2754711321000119); }
const $n2754711321000122 = $n2754711321000109.__vsk_ssrEls ? $n2754711321000109.__vsk_ssrEls[2] : (() => {
	const $n2754711321000120 = document.createElement("style");
	const $n2754711321000121 = document.createTextNode(" .gg { color: red; background: 3; border: 4px; }  ");
	$n2754711321000120.appendChild($n2754711321000121);
	return $n2754711321000120;
})();
if ($n2754711321000122.parentNode !== $n2754711321000109) { if (!$n2754711321000109 || $n2754711321000122.parentNode == null || !$n2754711321000109.contains($n2754711321000122)) $n2754711321000109.appendChild($n2754711321000122); }
if (__hydrators["Appx"] == null) throw new Error("Component \"Appx\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
$n2754711321000110.injectSkipK(3);
let $n2754711321000123 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2754711321000123 = toDomNode(await __hydrators["Appx"]({  }, __registry, $n2754711321000110)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n2754711321000123.parentNode !== $n2754711321000109) { if (!$n2754711321000109 || $n2754711321000123.parentNode == null || !$n2754711321000109.contains($n2754711321000123)) $n2754711321000109.appendChild($n2754711321000123); }
if (__hydrators["Appxx"] == null) throw new Error("Component \"Appxx\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n2754711321000124 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2754711321000124 = toDomNode(await __hydrators["Appxx"]({ "count": count }, __registry, $n2754711321000110)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n2754711321000124.parentNode !== $n2754711321000109) { if (!$n2754711321000109 || $n2754711321000124.parentNode == null || !$n2754711321000109.contains($n2754711321000124)) $n2754711321000109.appendChild($n2754711321000124); }
	if ($mount === null) $mount = $n2754711321000109;
	if ($n2754711321000109 !== $mount && $n2754711321000109.parentNode == null) $mount.appendChild($n2754711321000109);
	{
	  let __first = true;
	  effect(async () => {
	    const __nv = get(postCe);
	    if (__first) { __first = false; __nv; return; }
	    for (const e of $n2754711321000084) destroy_block(e);
	    $n2754711321000084.length = 0;
	    __cleanup($n2754711321000082, $n2754711321000083);
	    for (const p of get(postCe)) {
	    	await $n2754711321000085(p, $n2754711321000084);
	    }
	  });
	}
	effect(() => { const __v = get(count); $n2754711321000095.data = __v == null ? '' : String(__v); });
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

__hydrators["Throws"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2754711321000125 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
	__hydrate.claimOnly(undefined, $n2754711321000125);
	$n2754711321000125 = 0;
if (props.fail) throw new Error(props.msg);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Appx"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2754711321000127 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2754711321000128 = document.createComment('try');
let $n2754711321000130 = [];
const $n2754711321000129 = document.createComment('try-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2754711321000128, $n2754711321000127);
	__hydrate.insertBeforeNextClaim($n2754711321000129, $n2754711321000127);
}
const $n2754711321000131 = () => {
	const __p = $n2754711321000128.parentNode;
	const __cl = [];
if (__hydrators["Throws"] == null) throw new Error("Component \"Throws\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
__hydrate.injectSkipK($n2754711321000127);
let $n2754711321000132 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2754711321000132 = toDomNode(__hydrators["Throws"]({ "fail": true, "count": 0, "msg": "Boom!" }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2754711321000127 = 0;
	__cl.push($n2754711321000132);
	__place($n2754711321000128, $n2754711321000129, __cl, $root);
};
const $n2754711321000133 = (e) => {
	const __p = $n2754711321000128.parentNode;
	const __cl = [];
const $n2754711321000134 = __hydrate.nextElement("p", $n2754711321000127);
$n2754711321000127 = 0;
$n2754711321000134.setAttribute("class", "error");
const $n2754711321000135 = document.createTextNode("Error: ");
if ($n2754711321000135.parentNode !== $n2754711321000134) { const __ssr = $n2754711321000134.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000134.insertBefore($n2754711321000135, __ssr[0]); else $n2754711321000134.appendChild($n2754711321000135); }
const $n2754711321000136 = document.createTextNode(String((e.message) ?? ''));
if ($n2754711321000136.parentNode !== $n2754711321000134) { const __ssr = $n2754711321000134.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000134.insertBefore($n2754711321000136, __ssr[0]); else $n2754711321000134.appendChild($n2754711321000136); }
	__cl.push($n2754711321000134);
	__place($n2754711321000128, $n2754711321000129, __cl, $root);
};
try { $n2754711321000131(); } catch(e) { $n2754711321000133(e); }
const $n2754711321000137 = () => {
	const __p = $n2754711321000128.parentNode;
if (__runtime_comps["Throws"] == null) throw new Error("Component \"Throws\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2754711321000138 = toDomNode(__runtime_comps["Throws"]({ "fail": true, "count": 0, "msg": "Boom!" }));
	__p.insertBefore($n2754711321000138, $n2754711321000129);
};
const $n2754711321000139 = (e) => {
	const __p = $n2754711321000128.parentNode;
const $n2754711321000140 = document.createElement("p");
$n2754711321000140.setAttribute("class", "error");
const $n2754711321000141 = document.createTextNode("Error: ");
$n2754711321000140.appendChild($n2754711321000141);
const $n2754711321000142 = document.createTextNode(String((e.message) ?? ''));
$n2754711321000140.appendChild($n2754711321000142);
	__p.insertBefore($n2754711321000140, $n2754711321000129);
};
	{
	    effect(() => {
	      for (const e of $n2754711321000130) destroy_block(e);
	      $n2754711321000130.length = 0;
	      __cleanup($n2754711321000128, $n2754711321000129);
	      try { $n2754711321000137(); } catch(e) { $n2754711321000139(e); }
	    });
	  }
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Throw"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2754711321000143 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
if (props.count < 15) throw new Error(props.msg);
const $n2754711321000144 = __hydrate.nextElement("p", $n2754711321000143);
$n2754711321000143 = 0;
const $n2754711321000145 = document.createTextNode("OK ");
if ($n2754711321000145.parentNode !== $n2754711321000144) { const __ssr = $n2754711321000144.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000144.insertBefore($n2754711321000145, __ssr[0]); else $n2754711321000144.appendChild($n2754711321000145); }
const $n2754711321000146 = document.createTextNode('');
if ($n2754711321000146.parentNode !== $n2754711321000144) { const __ssr = $n2754711321000144.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000144.insertBefore($n2754711321000146, __ssr[0]); else $n2754711321000144.appendChild($n2754711321000146); }
	if ($mount === null) $mount = $n2754711321000144;
	if ($n2754711321000144 !== $mount && $n2754711321000144.parentNode == null) $mount.appendChild($n2754711321000144);
	effect(() => { const __v = props.count; $n2754711321000146.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Appxx"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2754711321000147 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2754711321000148 = __hydrate.nextElement("p", $n2754711321000147);
$n2754711321000147 = 0;
const $n2754711321000149 = document.createTextNode(" Count: ");
if ($n2754711321000149.parentNode !== $n2754711321000148) { const __ssr = $n2754711321000148.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000148.insertBefore($n2754711321000149, __ssr[0]); else $n2754711321000148.appendChild($n2754711321000149); }
const $n2754711321000150 = document.createTextNode('');
if ($n2754711321000150.parentNode !== $n2754711321000148) { const __ssr = $n2754711321000148.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000148.insertBefore($n2754711321000150, __ssr[0]); else $n2754711321000148.appendChild($n2754711321000150); }
	if ($mount === null) $mount = $n2754711321000148;
	if ($n2754711321000148 !== $mount && $n2754711321000148.parentNode == null) $mount.appendChild($n2754711321000148);
const $n2754711321000151 = document.createComment('try');
let $n2754711321000153 = [];
const $n2754711321000152 = document.createComment('try-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2754711321000151);
	__hydrate.insertBeforeNextClaim($n2754711321000152);
}
const $n2754711321000154 = () => {
	const __p = $n2754711321000151.parentNode;
	const __cl = [];
if (__hydrators["Throw"] == null) throw new Error("Component \"Throw\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n2754711321000155 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2754711321000155 = toDomNode(__hydrators["Throw"]({ "count": props.count, "fail": true, "msg": `Insufficient! ${props.count} ` }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
	__cl.push($n2754711321000155);
	__place($n2754711321000151, $n2754711321000152, __cl, $root);
};
const $n2754711321000156 = (e) => {
	const __p = $n2754711321000151.parentNode;
	const __cl = [];
const $n2754711321000157 = __hydrate.nextElement("p", 0);
$n2754711321000157.setAttribute("class", "error");
const $n2754711321000158 = document.createTextNode("Error: ");
if ($n2754711321000158.parentNode !== $n2754711321000157) { const __ssr = $n2754711321000157.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000157.insertBefore($n2754711321000158, __ssr[0]); else $n2754711321000157.appendChild($n2754711321000158); }
const $n2754711321000159 = document.createTextNode(String((e.message) ?? ''));
if ($n2754711321000159.parentNode !== $n2754711321000157) { const __ssr = $n2754711321000157.__vsk_ssrEls || []; if (0 < __ssr.length) $n2754711321000157.insertBefore($n2754711321000159, __ssr[0]); else $n2754711321000157.appendChild($n2754711321000159); }
	__cl.push($n2754711321000157);
	__place($n2754711321000151, $n2754711321000152, __cl, $root);
};
try { $n2754711321000154(); } catch(e) { $n2754711321000156(e); }
const $n2754711321000160 = () => {
	const __p = $n2754711321000151.parentNode;
if (__runtime_comps["Throw"] == null) throw new Error("Component \"Throw\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2754711321000161 = toDomNode(__runtime_comps["Throw"]({ "count": props.count, "fail": true, "msg": `Insufficient! ${props.count} ` }));
	__p.insertBefore($n2754711321000161, $n2754711321000152);
};
const $n2754711321000162 = (e) => {
	const __p = $n2754711321000151.parentNode;
const $n2754711321000163 = document.createElement("p");
$n2754711321000163.setAttribute("class", "error");
const $n2754711321000164 = document.createTextNode("Error: ");
$n2754711321000163.appendChild($n2754711321000164);
const $n2754711321000165 = document.createTextNode(String((e.message) ?? ''));
$n2754711321000163.appendChild($n2754711321000165);
	__p.insertBefore($n2754711321000163, $n2754711321000152);
};
	effect(() => { const __v = props.count; $n2754711321000150.data = __v == null ? '' : String(__v); });
	{
	    effect(() => {
	      for (const e of $n2754711321000153) destroy_block(e);
	      $n2754711321000153.length = 0;
	      __cleanup($n2754711321000151, $n2754711321000152);
	      try { $n2754711321000160(); } catch(e) { $n2754711321000162(e); }
	    });
	  }
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Index", { get: () => __components["Home"], configurable: true });

Object.defineProperty(__hydrators, "Page_Index", { get: () => __hydrators["Home"], configurable: true });

{
const navItems = [
	{ label: 'Home', href: '/' },
	{ label: 'About', href: '/about' },
	{ label: 'Blog', href: '/blog' },
	{ label: 'Posts', href: '/posts' },
	{ label: 'Statements', href: '/statements' },
	{ label: 'GuardTest', href: '/guardtest' },
	{ label: 'Async', href: '/async' },
	{ label: 'Map', href: '/map' },
	{ label: 'Empty', href: '/empty' },
	{ label: 'Md', href: '/md' },
	{ label: 'Md HTML', href: '/md-html' },
	{ label: 'Broken', href: '/broken' },
	{ label: 'StandaloneDep', href: '/standalonedep' },
	{ label: 'Portal', href: '/portal' },
	{ label: 'StoreApi', href: '/store-api' }
];


__components["Layout"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	if (!document.getElementById("vesk-Layout")) {
			const s = document.createElement('style'); s.id = "vesk-Layout"; s.textContent = "  .nav { margin-left: 20px; display: flex; gap: 10px; } "; document.head.appendChild(s);
	}
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
{ let el = document.querySelector("link[href=\"/favicon.svg\"]"); if (!el) { el = document.createElement("link"); document.head.appendChild(el); }
el.setAttribute("rel", "shortcut icon");
el.setAttribute("href", "/favicon.svg");
el.setAttribute("type", "image/x-icon");
}
const $n626616240000000 = toDomNode(LoadingIndicator({ "height": 3, "throttle": 0, "duration": 1500 }));
	$root.appendChild($n626616240000000);
const $n626616240000001 = document.createElement("nav");
$n626616240000001.setAttribute("class", "flex nav gap-6 px-8 py-4 border-b border-gray-200 bg-white");
const $n626616240000002 = document.createComment('map');
$n626616240000001.appendChild($n626616240000002);
let $n626616240000004 = [];
const $n626616240000003 = document.createComment('map-end');
const $n626616240000005 = (item, __e, __r) => {
	__r = __r || $n626616240000003;
	const __p = $n626616240000002.parentNode;
	const __it = document.createDocumentFragment();
const $n626616240000007 = (() => { const $f = document.createDocumentFragment();
const $n626616240000008 = document.createTextNode(String((item.label) ?? ''));
$f.appendChild($n626616240000008);
return $f; })();
const $n626616240000006 = toDomNode(NavLink({ "href": item.href, "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n626616240000007 }));
	__it.appendChild($n626616240000006);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n626616240000001.appendChild($n626616240000003);
const $n626616240000009 = () => { const __l = navItems; return __l != null && __l.length > 0; };
for (const item of navItems) {
	$n626616240000005(item, $n626616240000004);
}
	$root.appendChild($n626616240000001);
const $n626616240000010 = document.createElement("main");
$n626616240000010.setAttribute("class", "max-w-3xl mx-auto my-8 px-4");
if (props.children !== undefined && props.children !== null) $n626616240000010.appendChild(props.children);
	$root.appendChild($n626616240000010);
const $n626616240000011 = document.createElement("footer");
$n626616240000011.setAttribute("class", "text-center py-8 text-gray-400 text-sm");
const $n626616240000012 = document.createElement("p");
const $n626616240000013 = document.createTextNode("Powered by Vesk");
$n626616240000012.appendChild($n626616240000013);
$n626616240000011.appendChild($n626616240000012);
	$root.appendChild($n626616240000011);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Layout"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	if (!document.getElementById("vesk-Layout")) {
			const s = document.createElement('style'); s.id = "vesk-Layout"; s.textContent = "  .nav { margin-left: 20px; display: flex; gap: 10px; } "; document.head.appendChild(s);
	}
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n626616240000014 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
__hydrate.injectSkipK($n626616240000014);
let $n626616240000015 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n626616240000015 = toDomNode(LoadingIndicator({ "height": 3, "throttle": 0, "duration": 1500 }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n626616240000014 = 0;
__hydrate.retireDetached();
	if ($mount === null) $mount = $n626616240000015;
	if ($n626616240000015 !== $mount && $n626616240000015.parentNode == null) $mount.appendChild($n626616240000015);
const $n626616240000016 = __hydrate.nextElement("nav", 0);
$n626616240000016.setAttribute("class", "flex nav gap-6 px-8 py-4 border-b border-gray-200 bg-white");
const $n626616240000017 = __hydrate.subWalker($n626616240000016);
const $n626616240000018 = document.createComment('map');
let $n626616240000020 = [];
const $n626616240000019 = document.createComment('map-end');
const $n626616240000021 = (item, __e, __r, __cl) => {
	__r = __r || $n626616240000019;
	const __p = $n626616240000018.parentNode;
const $n626616240000023 = (() => { const $f = document.createDocumentFragment();
const $n626616240000024 = document.createTextNode(String((item.label) ?? ''));
$f.appendChild($n626616240000024);
return $f; })();
let $n626616240000022 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n626616240000022 = toDomNode(NavLink({ "href": item.href, "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n626616240000023 }, __registry, $n626616240000017)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n626616240000017.retireDetached();
	if (__cl) __cl.push($n626616240000022); else __p.insertBefore($n626616240000022, __r);
};
const $n626616240000025 = () => { const __l = navItems; return __l != null && __l.length > 0; };
const $n626616240000026 = [];
for (const item of navItems) {
	$n626616240000021(item, $n626616240000020, null, $n626616240000026);
}
__place($n626616240000018, $n626616240000019, $n626616240000026, $n626616240000016);
	if ($mount === null) $mount = $n626616240000016;
	if ($n626616240000016 !== $mount && $n626616240000016.parentNode == null) $mount.appendChild($n626616240000016);
const $n626616240000027 = __hydrate.nextElement("main", 0);
$n626616240000027.setAttribute("class", "max-w-3xl mx-auto my-8 px-4");
const $n626616240000028 = __hydrate.subWalker($n626616240000027);
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    const __slot = createLayoutSlot($n626616240000028, $n626616240000027);
    const __child = props.children(__slot.walker);
    if (__child && typeof __child.then === 'function') __pendingChild = __slot.track(__child);
  } else {
    $n626616240000027.appendChild(props.children);
  }
}
	if ($mount === null) $mount = $n626616240000027;
	if ($n626616240000027 !== $mount && $n626616240000027.parentNode == null) $mount.appendChild($n626616240000027);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Layout_Index", { get: () => __components["Layout"], configurable: true });

Object.defineProperty(__hydrators, "Layout_Index", { get: () => __hydrators["Layout"], configurable: true });

{
__components["ErrorPage"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n174903600000000 = document.createElement("div");
$n174903600000000.setAttribute("class", "min-h-screen flex items-center justify-center bg-gray-50");
const $n174903600000001 = document.createElement("div");
$n174903600000001.setAttribute("class", "max-w-2xl mx-auto p-8 bg-white rounded-xl shadow-sm border border-gray-200");
const $n174903600000002 = document.createElement("h1");
$n174903600000002.setAttribute("class", "text-4xl font-bold text-red-600 mb-4");
const $n174903600000003 = document.createTextNode("Error ");
$n174903600000002.appendChild($n174903600000003);
const $n174903600000004 = document.createTextNode('');
$n174903600000002.appendChild($n174903600000004);
$n174903600000001.appendChild($n174903600000002);
const $n174903600000005 = document.createElement("p");
$n174903600000005.setAttribute("class", "text-lg text-gray-700 mb-6");
const $n174903600000006 = document.createTextNode('');
$n174903600000005.appendChild($n174903600000006);
$n174903600000001.appendChild($n174903600000005);
const $n174903600000007 = document.createElement("pre");
$n174903600000007.setAttribute("class", "bg-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto max-h-64 overflow-y-auto");
const $n174903600000008 = document.createTextNode('');
$n174903600000007.appendChild($n174903600000008);
$n174903600000001.appendChild($n174903600000007);
const $n174903600000009 = document.createElement("p");
$n174903600000009.setAttribute("class", "mt-6 text-gray-500 text-sm");
const $n174903600000010 = document.createTextNode('');
$n174903600000009.appendChild($n174903600000010);
$n174903600000001.appendChild($n174903600000009);
$n174903600000000.appendChild($n174903600000001);
	$root.appendChild($n174903600000000);
	effect(() => { const __v = props.statusCode; $n174903600000004.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.error; $n174903600000006.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.stack; $n174903600000008.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.url; $n174903600000010.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["ErrorPage"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n174903600000011 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n174903600000012 = __hydrate.nextElement("div", $n174903600000011);
$n174903600000011 = 0;
$n174903600000012.setAttribute("class", "min-h-screen flex items-center justify-center bg-gray-50");
const $n174903600000013 = __hydrate.subWalker($n174903600000012);
const $n174903600000014 = $n174903600000013.nextElement("div", 0);
$n174903600000014.setAttribute("class", "max-w-2xl mx-auto p-8 bg-white rounded-xl shadow-sm border border-gray-200");
const $n174903600000015 = $n174903600000013.subWalker($n174903600000014);
const $n174903600000016 = $n174903600000015.nextElement("h1", 0);
$n174903600000016.setAttribute("class", "text-4xl font-bold text-red-600 mb-4");
const $n174903600000017 = document.createTextNode("Error ");
if ($n174903600000017.parentNode !== $n174903600000016) { const __ssr = $n174903600000016.__vsk_ssrEls || []; if (0 < __ssr.length) $n174903600000016.insertBefore($n174903600000017, __ssr[0]); else $n174903600000016.appendChild($n174903600000017); }
const $n174903600000018 = document.createTextNode('');
if ($n174903600000018.parentNode !== $n174903600000016) { const __ssr = $n174903600000016.__vsk_ssrEls || []; if (0 < __ssr.length) $n174903600000016.insertBefore($n174903600000018, __ssr[0]); else $n174903600000016.appendChild($n174903600000018); }
if ($n174903600000016.parentNode !== $n174903600000014) { if (!$n174903600000014 || $n174903600000016.parentNode == null || !$n174903600000014.contains($n174903600000016)) $n174903600000014.appendChild($n174903600000016); }
const $n174903600000019 = $n174903600000015.nextElement("p", 0);
$n174903600000019.setAttribute("class", "text-lg text-gray-700 mb-6");
const $n174903600000020 = document.createTextNode(String($n174903600000019.__vsk_ssrText ?? ''));
if ($n174903600000020.parentNode !== $n174903600000019) { const __ssr = $n174903600000019.__vsk_ssrEls || []; if (0 < __ssr.length) $n174903600000019.insertBefore($n174903600000020, __ssr[0]); else $n174903600000019.appendChild($n174903600000020); }
if ($n174903600000019.parentNode !== $n174903600000014) { if (!$n174903600000014 || $n174903600000019.parentNode == null || !$n174903600000014.contains($n174903600000019)) $n174903600000014.appendChild($n174903600000019); }
const $n174903600000021 = $n174903600000015.nextElement("pre", 0);
$n174903600000021.setAttribute("class", "bg-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto max-h-64 overflow-y-auto");
const $n174903600000022 = document.createTextNode(String($n174903600000021.__vsk_ssrText ?? ''));
if ($n174903600000022.parentNode !== $n174903600000021) { const __ssr = $n174903600000021.__vsk_ssrEls || []; if (0 < __ssr.length) $n174903600000021.insertBefore($n174903600000022, __ssr[0]); else $n174903600000021.appendChild($n174903600000022); }
if ($n174903600000021.parentNode !== $n174903600000014) { if (!$n174903600000014 || $n174903600000021.parentNode == null || !$n174903600000014.contains($n174903600000021)) $n174903600000014.appendChild($n174903600000021); }
const $n174903600000023 = $n174903600000015.nextElement("p", 0);
$n174903600000023.setAttribute("class", "mt-6 text-gray-500 text-sm");
const $n174903600000024 = document.createTextNode(String($n174903600000023.__vsk_ssrText ?? ''));
if ($n174903600000024.parentNode !== $n174903600000023) { const __ssr = $n174903600000023.__vsk_ssrEls || []; if (0 < __ssr.length) $n174903600000023.insertBefore($n174903600000024, __ssr[0]); else $n174903600000023.appendChild($n174903600000024); }
if ($n174903600000023.parentNode !== $n174903600000014) { if (!$n174903600000014 || $n174903600000023.parentNode == null || !$n174903600000014.contains($n174903600000023)) $n174903600000014.appendChild($n174903600000023); }
if ($n174903600000014.parentNode !== $n174903600000012) { if (!$n174903600000012 || $n174903600000014.parentNode == null || !$n174903600000012.contains($n174903600000014)) $n174903600000012.appendChild($n174903600000014); }
	if ($mount === null) $mount = $n174903600000012;
	if ($n174903600000012 !== $mount && $n174903600000012.parentNode == null) $mount.appendChild($n174903600000012);
	effect(() => { const __v = props.statusCode; $n174903600000018.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.error; $n174903600000020.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.stack; $n174903600000022.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.url; $n174903600000024.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Error_Index", { get: () => __components["ErrorPage"], configurable: true });

Object.defineProperty(__hydrators, "Error_Index", { get: () => __hydrators["ErrorPage"], configurable: true });

{
__components["NotFound404"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n3965392962000000 = document.createElement("main");
$n3965392962000000.setAttribute("class", "max-w-3xl mx-auto my-16 px-4 text-center");
const $n3965392962000001 = document.createElement("h1");
$n3965392962000001.setAttribute("class", "text-6xl font-bold text-gray-200 mb-4");
const $n3965392962000002 = document.createTextNode("404");
$n3965392962000001.appendChild($n3965392962000002);
$n3965392962000000.appendChild($n3965392962000001);
const $n3965392962000003 = document.createElement("h2");
$n3965392962000003.setAttribute("class", "text-2xl font-semibold mb-2");
const $n3965392962000004 = document.createTextNode("Page Not Found");
$n3965392962000003.appendChild($n3965392962000004);
$n3965392962000000.appendChild($n3965392962000003);
const $n3965392962000005 = document.createElement("p");
$n3965392962000005.setAttribute("class", "text-gray-500 mb-8");
const $n3965392962000006 = document.createTextNode("Sorry, we couldn't find ");
$n3965392962000005.appendChild($n3965392962000006);
const $n3965392962000007 = document.createElement("code");
$n3965392962000007.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n3965392962000008 = document.createTextNode('');
$n3965392962000007.appendChild($n3965392962000008);
$n3965392962000005.appendChild($n3965392962000007);
$n3965392962000000.appendChild($n3965392962000005);
const $n3965392962000010 = (() => { const $f = document.createDocumentFragment();
const $n3965392962000011 = document.createTextNode("← Go home");
$f.appendChild($n3965392962000011);
return $f; })();
const $n3965392962000009 = toDomNode(Link({ "href": "/", "class": "text-blue-600 no-underline hover:underline font-medium", children: $n3965392962000010 }));
$n3965392962000000.appendChild($n3965392962000009);
	$root.appendChild($n3965392962000000);
	effect(() => { const __v = props.url; $n3965392962000008.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["NotFound404"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n3965392962000012 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n3965392962000013 = __hydrate.nextElement("main", $n3965392962000012);
$n3965392962000012 = 0;
$n3965392962000013.setAttribute("class", "max-w-3xl mx-auto my-16 px-4 text-center");
const $n3965392962000014 = __hydrate.subWalker($n3965392962000013);
const $n3965392962000017 = $n3965392962000013.__vsk_ssrEls ? $n3965392962000013.__vsk_ssrEls[0] : (() => {
	const $n3965392962000015 = document.createElement("h1");
	$n3965392962000015.setAttribute("class", "text-6xl font-bold text-gray-200 mb-4");
	const $n3965392962000016 = document.createTextNode("404");
	$n3965392962000015.appendChild($n3965392962000016);
	return $n3965392962000015;
})();
if ($n3965392962000017.parentNode !== $n3965392962000013) { if (!$n3965392962000013 || $n3965392962000017.parentNode == null || !$n3965392962000013.contains($n3965392962000017)) $n3965392962000013.appendChild($n3965392962000017); }
const $n3965392962000020 = $n3965392962000013.__vsk_ssrEls ? $n3965392962000013.__vsk_ssrEls[1] : (() => {
	const $n3965392962000018 = document.createElement("h2");
	$n3965392962000018.setAttribute("class", "text-2xl font-semibold mb-2");
	const $n3965392962000019 = document.createTextNode("Page Not Found");
	$n3965392962000018.appendChild($n3965392962000019);
	return $n3965392962000018;
})();
if ($n3965392962000020.parentNode !== $n3965392962000013) { if (!$n3965392962000013 || $n3965392962000020.parentNode == null || !$n3965392962000013.contains($n3965392962000020)) $n3965392962000013.appendChild($n3965392962000020); }
const $n3965392962000021 = $n3965392962000014.nextElement("p", 2);
$n3965392962000021.setAttribute("class", "text-gray-500 mb-8");
const $n3965392962000022 = $n3965392962000014.subWalker($n3965392962000021);
const $n3965392962000023 = document.createTextNode("Sorry, we couldn't find ");
if ($n3965392962000023.parentNode !== $n3965392962000021) { const __ssr = $n3965392962000021.__vsk_ssrEls || []; if (0 < __ssr.length) $n3965392962000021.insertBefore($n3965392962000023, __ssr[0]); else $n3965392962000021.appendChild($n3965392962000023); }
const $n3965392962000024 = $n3965392962000022.nextElement("code", 0);
$n3965392962000024.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n3965392962000025 = document.createTextNode(String($n3965392962000024.__vsk_ssrText ?? ''));
if ($n3965392962000025.parentNode !== $n3965392962000024) { const __ssr = $n3965392962000024.__vsk_ssrEls || []; if (0 < __ssr.length) $n3965392962000024.insertBefore($n3965392962000025, __ssr[0]); else $n3965392962000024.appendChild($n3965392962000025); }
if ($n3965392962000024.parentNode !== $n3965392962000021) { if (!$n3965392962000021 || $n3965392962000024.parentNode == null || !$n3965392962000021.contains($n3965392962000024)) $n3965392962000021.appendChild($n3965392962000024); }
if ($n3965392962000021.parentNode !== $n3965392962000013) { if (!$n3965392962000013 || $n3965392962000021.parentNode == null || !$n3965392962000013.contains($n3965392962000021)) $n3965392962000013.appendChild($n3965392962000021); }
const $n3965392962000027 = (() => { const $f = document.createDocumentFragment();
const $n3965392962000028 = document.createTextNode("← Go home");
$f.appendChild($n3965392962000028);
return $f; })();
let $n3965392962000026 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3965392962000026 = toDomNode(Link({ "href": "/", "class": "text-blue-600 no-underline hover:underline font-medium", children: $n3965392962000027 }, __registry, $n3965392962000014)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n3965392962000014.retireDetached();
if ($n3965392962000026.parentNode !== $n3965392962000013) { if (!$n3965392962000013 || $n3965392962000026.parentNode == null || !$n3965392962000013.contains($n3965392962000026)) $n3965392962000013.appendChild($n3965392962000026); }
	if ($mount === null) $mount = $n3965392962000013;
	if ($n3965392962000013 !== $mount && $n3965392962000013.parentNode == null) $mount.appendChild($n3965392962000013);
	effect(() => { const __v = props.url; $n3965392962000025.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "NotFound_Index", { get: () => __components["NotFound404"], configurable: true });

Object.defineProperty(__hydrators, "NotFound_Index", { get: () => __hydrators["NotFound404"], configurable: true });
})();
