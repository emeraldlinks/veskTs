(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const storeLinks = [
	{
		label: '/store/widget',
		href: '/store/widget',
		note: 'renders normally'
	},

	{
		label: '/store/missing',
		href: '/store/missing',
		note: 'throws NotFoundError → store not-found'
	},

	{
		label: '/store/boom',
		href: '/store/boom',
		note: 'throws Error → store error boundary'
	}
];


__components["Store"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n487712071000000 = document.createElement("h1");
$n487712071000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n487712071000001 = document.createTextNode("Store");
$n487712071000000.appendChild($n487712071000001);
	$root.appendChild($n487712071000000);
const $n487712071000002 = document.createElement("p");
$n487712071000002.setAttribute("class", "text-gray-600 mb-6");
const $n487712071000003 = document.createTextNode("Route-level error and not-found boundaries live under /store.");
$n487712071000002.appendChild($n487712071000003);
	$root.appendChild($n487712071000002);
const $n487712071000004 = document.createElement("ul");
$n487712071000004.setAttribute("class", "space-y-3");
const $n487712071000005 = document.createComment('map');
$n487712071000004.appendChild($n487712071000005);
let $n487712071000007 = [];
const $n487712071000006 = document.createComment('map-end');
const $n487712071000008 = (link, __e, __r) => {
	__r = __r || $n487712071000006;
	const __p = $n487712071000005.parentNode;
	const __it = document.createDocumentFragment();
const $n487712071000009 = document.createElement("li");
const $n487712071000011 = (() => { const $f = document.createDocumentFragment();
const $n487712071000012 = document.createTextNode(String((link.label) ?? ''));
$f.appendChild($n487712071000012);
const $n487712071000013 = document.createTextNode(" — ");
$f.appendChild($n487712071000013);
const $n487712071000014 = document.createTextNode(String((link.note) ?? ''));
$f.appendChild($n487712071000014);
return $f; })();
const $n487712071000010 = toDomNode(Link({ "href": link.href, "class": "text-blue-600 no-underline hover:underline", children: $n487712071000011 }));
$n487712071000009.appendChild($n487712071000010);
	__it.appendChild($n487712071000009);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n487712071000004.appendChild($n487712071000006);
const $n487712071000015 = () => { const __l = storeLinks; return __l != null && __l.length > 0; };
for (const link of storeLinks) {
	$n487712071000008(link, $n487712071000007);
}
	$root.appendChild($n487712071000004);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Store"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n487712071000016 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n487712071000019 = __hydrate.nextElement("ul", $n487712071000016 + 2);
$n487712071000016 = 0;
$n487712071000019.setAttribute("class", "space-y-3");
const $n487712071000020 = __hydrate.subWalker($n487712071000019);
const $n487712071000021 = document.createComment('map');
let $n487712071000023 = [];
const $n487712071000022 = document.createComment('map-end');
const $n487712071000024 = (link, __e, __r, __cl) => {
	__r = __r || $n487712071000022;
	const __p = $n487712071000021.parentNode;
const $n487712071000025 = $n487712071000020.nextElement("li", 0);
const $n487712071000026 = $n487712071000020.subWalker($n487712071000025);
const $n487712071000028 = (() => { const $f = document.createDocumentFragment();
const $n487712071000029 = document.createTextNode(String((link.label) ?? ''));
$f.appendChild($n487712071000029);
const $n487712071000030 = document.createTextNode(" — ");
$f.appendChild($n487712071000030);
const $n487712071000031 = document.createTextNode(String((link.note) ?? ''));
$f.appendChild($n487712071000031);
return $f; })();
let $n487712071000027 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n487712071000027 = toDomNode(Link({ "href": link.href, "class": "text-blue-600 no-underline hover:underline", children: $n487712071000028 }, __registry, $n487712071000026)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n487712071000026.retireDetached();
if ($n487712071000027.parentNode !== $n487712071000025) { if (!$n487712071000025 || $n487712071000027.parentNode == null || !$n487712071000025.contains($n487712071000027)) $n487712071000025.appendChild($n487712071000027); }
	if (__cl) __cl.push($n487712071000025); else __p.insertBefore($n487712071000025, __r);
};
const $n487712071000032 = () => { const __l = storeLinks; return __l != null && __l.length > 0; };
const $n487712071000033 = [];
for (const link of storeLinks) {
	$n487712071000024(link, $n487712071000023, null, $n487712071000033);
}
__place($n487712071000021, $n487712071000022, $n487712071000033, $n487712071000019);
	if ($mount === null) $mount = $n487712071000019;
	if ($n487712071000019 !== $mount && $n487712071000019.parentNode == null) $mount.appendChild($n487712071000019);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Store", { get: () => __components["Store"], configurable: true });

Object.defineProperty(__hydrators, "Page_Store", { get: () => __hydrators["Store"], configurable: true });

{
__components["StoreLayout"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1180669214000000 = document.createElement("div");
$n1180669214000000.setAttribute("class", "store-layout");
const $n1180669214000001 = document.createElement("div");
$n1180669214000001.setAttribute("class", "flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-8 py-2");
const $n1180669214000002 = document.createElement("span");
$n1180669214000002.setAttribute("class", "text-[11px] font-semibold uppercase tracking-wider text-gray-400");
const $n1180669214000003 = document.createTextNode("Store layout");
$n1180669214000002.appendChild($n1180669214000003);
$n1180669214000001.appendChild($n1180669214000002);
const $n1180669214000004 = document.createComment('if');
$n1180669214000001.appendChild($n1180669214000004);
let $n1180669214000006 = [];
const $n1180669214000005 = document.createComment('if-end');
const $n1180669214000007 = () => {
	const __p = $n1180669214000004.parentNode;
	const $n1180669214000008 = document.createDocumentFragment();
const $n1180669214000009 = document.createElement("span");
$n1180669214000009.setAttribute("class", "text-[11px] text-gray-500");
const $n1180669214000010 = document.createTextNode("item: ");
$n1180669214000009.appendChild($n1180669214000010);
const $n1180669214000011 = document.createTextNode('');
$n1180669214000006.push(effect(() => { const __v = props.params.item; $n1180669214000011.data = __v == null ? '' : String(__v); }));
$n1180669214000009.appendChild($n1180669214000011);
	$n1180669214000008.appendChild($n1180669214000009);
	__p.insertBefore($n1180669214000008, $n1180669214000005);
};
const $n1180669214000012 = () => {
	const __p = $n1180669214000004.parentNode;
	const $n1180669214000013 = document.createDocumentFragment();
const $n1180669214000014 = document.createTextNode(String((null) ?? ''));
	$n1180669214000013.appendChild($n1180669214000014);
	__p.insertBefore($n1180669214000013, $n1180669214000005);
};
$n1180669214000001.appendChild($n1180669214000005);
if (props.params?.item) { $n1180669214000007(); } else { $n1180669214000012(); }
$n1180669214000000.appendChild($n1180669214000001);
if (props.children !== undefined && props.children !== null) $n1180669214000000.appendChild(props.children);
	$root.appendChild($n1180669214000000);
	{
	    let __iv = props.params?.item;
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.params?.item; return; }
	      const __nv = props.params?.item;
	      if (__nv !== __iv) {
	        for (const e of $n1180669214000006) destroy_block(e);
	        $n1180669214000006.length = 0;
	        __cleanup($n1180669214000004, $n1180669214000005);
	        if (__nv) { $n1180669214000007(); } else { $n1180669214000012(); }
	        __iv = __nv;
	      }
	    });
	  }
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["StoreLayout"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1180669214000015 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n1180669214000016 = __hydrate.nextElement("div", $n1180669214000015);
$n1180669214000015 = 0;
$n1180669214000016.setAttribute("class", "store-layout");
const $n1180669214000017 = __hydrate.subWalker($n1180669214000016);
const $n1180669214000018 = $n1180669214000017.nextElement("div", 0);
$n1180669214000018.setAttribute("class", "flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-8 py-2");
const $n1180669214000019 = $n1180669214000017.subWalker($n1180669214000018);
const $n1180669214000022 = $n1180669214000018.__vsk_ssrEls ? $n1180669214000018.__vsk_ssrEls[0] : (() => {
	const $n1180669214000020 = document.createElement("span");
	$n1180669214000020.setAttribute("class", "text-[11px] font-semibold uppercase tracking-wider text-gray-400");
	const $n1180669214000021 = document.createTextNode("Store layout");
	$n1180669214000020.appendChild($n1180669214000021);
	return $n1180669214000020;
})();
if ($n1180669214000022.parentNode !== $n1180669214000018) { if (!$n1180669214000018 || $n1180669214000022.parentNode == null || !$n1180669214000018.contains($n1180669214000022)) $n1180669214000018.appendChild($n1180669214000022); }
let $n1180669214000023 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n1180669214000024 = document.createComment('if');
let $n1180669214000026 = [];
const $n1180669214000025 = document.createComment('if-end');
const $n1180669214000027 = () => {
	const __cl = [];
const $n1180669214000029 = $n1180669214000019.nextElement("span", $n1180669214000023);
$n1180669214000023 = 0;
$n1180669214000029.setAttribute("class", "text-[11px] text-gray-500");
const $n1180669214000030 = document.createTextNode("item: ");
if ($n1180669214000030.parentNode !== $n1180669214000029) { const __ssr = $n1180669214000029.__vsk_ssrEls || []; if (0 < __ssr.length) $n1180669214000029.insertBefore($n1180669214000030, __ssr[0]); else $n1180669214000029.appendChild($n1180669214000030); }
const $n1180669214000031 = document.createTextNode('');
$n1180669214000026.push(effect(() => { const __v = props.params.item; $n1180669214000031.data = __v == null ? '' : String(__v); }));
if ($n1180669214000031.parentNode !== $n1180669214000029) { const __ssr = $n1180669214000029.__vsk_ssrEls || []; if (0 < __ssr.length) $n1180669214000029.insertBefore($n1180669214000031, __ssr[0]); else $n1180669214000029.appendChild($n1180669214000031); }
	__cl.push($n1180669214000029);
	__place($n1180669214000024, $n1180669214000025, __cl, $n1180669214000018);
};
const $n1180669214000032 = () => {
	const __cl = [];
const $n1180669214000034 = document.createTextNode(String((null) ?? ''));
	__cl.push($n1180669214000034);
	__place($n1180669214000024, $n1180669214000025, __cl, $n1180669214000018);
};
if (props.params?.item) { $n1180669214000027(); } else { $n1180669214000032(); }
if ($n1180669214000018.parentNode !== $n1180669214000016) { if (!$n1180669214000016 || $n1180669214000018.parentNode == null || !$n1180669214000016.contains($n1180669214000018)) $n1180669214000016.appendChild($n1180669214000018); }
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    const __slot = createLayoutSlot($n1180669214000017, $n1180669214000016);
    const __child = props.children(__slot.walker);
    if (__child && typeof __child.then === 'function') __pendingChild = __slot.track(__child);
  } else {
    $n1180669214000016.appendChild(props.children);
  }
}
	if ($mount === null) $mount = $n1180669214000016;
	if ($n1180669214000016 !== $mount && $n1180669214000016.parentNode == null) $mount.appendChild($n1180669214000016);
	{
	    let __iv = props.params?.item;
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.params?.item; return; }
	      const __nv = props.params?.item;
	      if (__nv !== __iv) {
	        for (const e of $n1180669214000026) destroy_block(e);
	        $n1180669214000026.length = 0;
	        __cleanup($n1180669214000024, $n1180669214000025);
	        if (__nv) { $n1180669214000027(); } else { $n1180669214000032(); }
	        __iv = __nv;
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

Object.defineProperty(__components, "Layout_Store", { get: () => __components["StoreLayout"], configurable: true });

Object.defineProperty(__hydrators, "Layout_Store", { get: () => __hydrators["StoreLayout"], configurable: true });

{
__components["StoreError"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1884515830000000 = document.createElement("div");
$n1884515830000000.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg");
const $n1884515830000001 = document.createElement("h1");
$n1884515830000001.setAttribute("class", "text-2xl font-bold text-amber-800 mb-2");
const $n1884515830000002 = document.createTextNode("Store Error Boundary");
$n1884515830000001.appendChild($n1884515830000002);
$n1884515830000000.appendChild($n1884515830000001);
const $n1884515830000003 = document.createElement("p");
$n1884515830000003.setAttribute("class", "text-amber-700 mb-4");
const $n1884515830000004 = document.createTextNode('');
$n1884515830000003.appendChild($n1884515830000004);
$n1884515830000000.appendChild($n1884515830000003);
const $n1884515830000005 = document.createElement("pre");
$n1884515830000005.setAttribute("class", "bg-amber-100 p-3 rounded text-xs font-mono overflow-x-auto");
const $n1884515830000006 = document.createTextNode('');
$n1884515830000005.appendChild($n1884515830000006);
$n1884515830000000.appendChild($n1884515830000005);
const $n1884515830000007 = document.createElement("p");
$n1884515830000007.setAttribute("class", "text-sm text-amber-600");
const $n1884515830000008 = document.createTextNode('');
$n1884515830000007.appendChild($n1884515830000008);
$n1884515830000000.appendChild($n1884515830000007);
	$root.appendChild($n1884515830000000);
	effect(() => { const __v = props.error; $n1884515830000004.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.stack; $n1884515830000006.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.url; $n1884515830000008.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["StoreError"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1884515830000009 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n1884515830000010 = __hydrate.nextElement("div", $n1884515830000009);
$n1884515830000009 = 0;
$n1884515830000010.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg");
const $n1884515830000011 = __hydrate.subWalker($n1884515830000010);
const $n1884515830000014 = $n1884515830000010.__vsk_ssrEls ? $n1884515830000010.__vsk_ssrEls[0] : (() => {
	const $n1884515830000012 = document.createElement("h1");
	$n1884515830000012.setAttribute("class", "text-2xl font-bold text-amber-800 mb-2");
	const $n1884515830000013 = document.createTextNode("Store Error Boundary");
	$n1884515830000012.appendChild($n1884515830000013);
	return $n1884515830000012;
})();
if ($n1884515830000014.parentNode !== $n1884515830000010) { if (!$n1884515830000010 || $n1884515830000014.parentNode == null || !$n1884515830000010.contains($n1884515830000014)) $n1884515830000010.appendChild($n1884515830000014); }
const $n1884515830000015 = $n1884515830000011.nextElement("p", 1);
$n1884515830000015.setAttribute("class", "text-amber-700 mb-4");
const $n1884515830000016 = document.createTextNode(String($n1884515830000015.__vsk_ssrText ?? ''));
if ($n1884515830000016.parentNode !== $n1884515830000015) { const __ssr = $n1884515830000015.__vsk_ssrEls || []; if (0 < __ssr.length) $n1884515830000015.insertBefore($n1884515830000016, __ssr[0]); else $n1884515830000015.appendChild($n1884515830000016); }
if ($n1884515830000015.parentNode !== $n1884515830000010) { if (!$n1884515830000010 || $n1884515830000015.parentNode == null || !$n1884515830000010.contains($n1884515830000015)) $n1884515830000010.appendChild($n1884515830000015); }
const $n1884515830000017 = $n1884515830000011.nextElement("pre", 0);
$n1884515830000017.setAttribute("class", "bg-amber-100 p-3 rounded text-xs font-mono overflow-x-auto");
const $n1884515830000018 = document.createTextNode(String($n1884515830000017.__vsk_ssrText ?? ''));
if ($n1884515830000018.parentNode !== $n1884515830000017) { const __ssr = $n1884515830000017.__vsk_ssrEls || []; if (0 < __ssr.length) $n1884515830000017.insertBefore($n1884515830000018, __ssr[0]); else $n1884515830000017.appendChild($n1884515830000018); }
if ($n1884515830000017.parentNode !== $n1884515830000010) { if (!$n1884515830000010 || $n1884515830000017.parentNode == null || !$n1884515830000010.contains($n1884515830000017)) $n1884515830000010.appendChild($n1884515830000017); }
const $n1884515830000019 = $n1884515830000011.nextElement("p", 0);
$n1884515830000019.setAttribute("class", "text-sm text-amber-600");
const $n1884515830000020 = document.createTextNode(String($n1884515830000019.__vsk_ssrText ?? ''));
if ($n1884515830000020.parentNode !== $n1884515830000019) { const __ssr = $n1884515830000019.__vsk_ssrEls || []; if (0 < __ssr.length) $n1884515830000019.insertBefore($n1884515830000020, __ssr[0]); else $n1884515830000019.appendChild($n1884515830000020); }
if ($n1884515830000019.parentNode !== $n1884515830000010) { if (!$n1884515830000010 || $n1884515830000019.parentNode == null || !$n1884515830000010.contains($n1884515830000019)) $n1884515830000010.appendChild($n1884515830000019); }
	if ($mount === null) $mount = $n1884515830000010;
	if ($n1884515830000010 !== $mount && $n1884515830000010.parentNode == null) $mount.appendChild($n1884515830000010);
	effect(() => { const __v = props.error; $n1884515830000016.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.stack; $n1884515830000018.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.url; $n1884515830000020.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Error_Store", { get: () => __components["StoreError"], configurable: true });

Object.defineProperty(__hydrators, "Error_Store", { get: () => __hydrators["StoreError"], configurable: true });

{
__components["StoreNotFound"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1475974116000000 = document.createElement("div");
$n1475974116000000.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-rose-50 border-l-4 border-rose-500 rounded-r-lg text-center");
const $n1475974116000001 = document.createElement("h1");
$n1475974116000001.setAttribute("class", "text-3xl font-bold text-rose-700 mb-2");
const $n1475974116000002 = document.createTextNode("Store Not Found");
$n1475974116000001.appendChild($n1475974116000002);
$n1475974116000000.appendChild($n1475974116000001);
const $n1475974116000003 = document.createElement("p");
$n1475974116000003.setAttribute("class", "text-rose-600 mb-6");
const $n1475974116000004 = document.createTextNode("That store item doesn't exist: ");
$n1475974116000003.appendChild($n1475974116000004);
const $n1475974116000005 = document.createElement("code");
$n1475974116000005.setAttribute("class", "bg-rose-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n1475974116000006 = document.createTextNode('');
$n1475974116000005.appendChild($n1475974116000006);
$n1475974116000003.appendChild($n1475974116000005);
$n1475974116000000.appendChild($n1475974116000003);
const $n1475974116000008 = (() => { const $f = document.createDocumentFragment();
const $n1475974116000009 = document.createTextNode("← Back to store");
$f.appendChild($n1475974116000009);
return $f; })();
const $n1475974116000007 = toDomNode(Link({ "href": "/store", "class": "text-rose-700 no-underline hover:underline font-medium", children: $n1475974116000008 }));
$n1475974116000000.appendChild($n1475974116000007);
	$root.appendChild($n1475974116000000);
	effect(() => { const __v = props.url; $n1475974116000006.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["StoreNotFound"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1475974116000010 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n1475974116000011 = __hydrate.nextElement("div", $n1475974116000010);
$n1475974116000010 = 0;
$n1475974116000011.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-rose-50 border-l-4 border-rose-500 rounded-r-lg text-center");
const $n1475974116000012 = __hydrate.subWalker($n1475974116000011);
const $n1475974116000015 = $n1475974116000011.__vsk_ssrEls ? $n1475974116000011.__vsk_ssrEls[0] : (() => {
	const $n1475974116000013 = document.createElement("h1");
	$n1475974116000013.setAttribute("class", "text-3xl font-bold text-rose-700 mb-2");
	const $n1475974116000014 = document.createTextNode("Store Not Found");
	$n1475974116000013.appendChild($n1475974116000014);
	return $n1475974116000013;
})();
if ($n1475974116000015.parentNode !== $n1475974116000011) { if (!$n1475974116000011 || $n1475974116000015.parentNode == null || !$n1475974116000011.contains($n1475974116000015)) $n1475974116000011.appendChild($n1475974116000015); }
const $n1475974116000016 = $n1475974116000012.nextElement("p", 1);
$n1475974116000016.setAttribute("class", "text-rose-600 mb-6");
const $n1475974116000017 = $n1475974116000012.subWalker($n1475974116000016);
const $n1475974116000018 = document.createTextNode("That store item doesn't exist: ");
if ($n1475974116000018.parentNode !== $n1475974116000016) { const __ssr = $n1475974116000016.__vsk_ssrEls || []; if (0 < __ssr.length) $n1475974116000016.insertBefore($n1475974116000018, __ssr[0]); else $n1475974116000016.appendChild($n1475974116000018); }
const $n1475974116000019 = $n1475974116000017.nextElement("code", 0);
$n1475974116000019.setAttribute("class", "bg-rose-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n1475974116000020 = document.createTextNode(String($n1475974116000019.__vsk_ssrText ?? ''));
if ($n1475974116000020.parentNode !== $n1475974116000019) { const __ssr = $n1475974116000019.__vsk_ssrEls || []; if (0 < __ssr.length) $n1475974116000019.insertBefore($n1475974116000020, __ssr[0]); else $n1475974116000019.appendChild($n1475974116000020); }
if ($n1475974116000019.parentNode !== $n1475974116000016) { if (!$n1475974116000016 || $n1475974116000019.parentNode == null || !$n1475974116000016.contains($n1475974116000019)) $n1475974116000016.appendChild($n1475974116000019); }
if ($n1475974116000016.parentNode !== $n1475974116000011) { if (!$n1475974116000011 || $n1475974116000016.parentNode == null || !$n1475974116000011.contains($n1475974116000016)) $n1475974116000011.appendChild($n1475974116000016); }
const $n1475974116000022 = (() => { const $f = document.createDocumentFragment();
const $n1475974116000023 = document.createTextNode("← Back to store");
$f.appendChild($n1475974116000023);
return $f; })();
let $n1475974116000021 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n1475974116000021 = toDomNode(Link({ "href": "/store", "class": "text-rose-700 no-underline hover:underline font-medium", children: $n1475974116000022 }, __registry, $n1475974116000012)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n1475974116000012.retireDetached();
if ($n1475974116000021.parentNode !== $n1475974116000011) { if (!$n1475974116000011 || $n1475974116000021.parentNode == null || !$n1475974116000011.contains($n1475974116000021)) $n1475974116000011.appendChild($n1475974116000021); }
	if ($mount === null) $mount = $n1475974116000011;
	if ($n1475974116000011 !== $mount && $n1475974116000011.parentNode == null) $mount.appendChild($n1475974116000011);
	effect(() => { const __v = props.url; $n1475974116000020.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "NotFound_Store", { get: () => __components["StoreNotFound"], configurable: true });

Object.defineProperty(__hydrators, "NotFound_Store", { get: () => __hydrators["StoreNotFound"], configurable: true });
})();
