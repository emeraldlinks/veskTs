(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["PostCard"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1582813765000000 = document.createElement("article");
$n1582813765000000.setAttribute("class", "bg-white rounded-lg p-6 mb-4 shadow-sm border border-gray-100");
const $n1582813765000001 = document.createElement("div");
$n1582813765000001.setAttribute("class", "flex items-center justify-between mb-2");
const $n1582813765000002 = document.createElement("h2");
$n1582813765000002.setAttribute("class", "text-xl font-semibold");
const $n1582813765000003 = document.createTextNode('');
$n1582813765000002.appendChild($n1582813765000003);
$n1582813765000001.appendChild($n1582813765000002);
const $n1582813765000004 = document.createElement("span");
$n1582813765000004.setAttribute("class", "text-gray-400 text-sm");
const $n1582813765000005 = document.createTextNode('');
$n1582813765000004.appendChild($n1582813765000005);
$n1582813765000001.appendChild($n1582813765000004);
$n1582813765000000.appendChild($n1582813765000001);
const $n1582813765000006 = document.createElement("p");
$n1582813765000006.setAttribute("class", "text-gray-500 mb-3");
const $n1582813765000007 = document.createTextNode('');
$n1582813765000006.appendChild($n1582813765000007);
$n1582813765000000.appendChild($n1582813765000006);
const $n1582813765000008 = document.createElement("div");
$n1582813765000008.setAttribute("class", "flex gap-2 mb-3");
const $n1582813765000009 = document.createComment('for');
$n1582813765000008.appendChild($n1582813765000009);
let $n1582813765000011 = [];
const $n1582813765000010 = document.createComment('for-end');
const $n1582813765000012 = () => {
	const __p = $n1582813765000009.parentNode;
	const __b = document.createDocumentFragment();
	for (const tag of (Array.isArray(props.post.tags) ? props.post.tags : (props.post.tags == null ? [] : Object.keys(props.post.tags)))) {
const $n1582813765000013 = document.createElement("span");
$n1582813765000013.setAttribute("class", "bg-blue-50 text-blue-600 text-xs px-2 py-1 rounded-full");
const $n1582813765000014 = document.createTextNode(String((tag) ?? ''));
$n1582813765000013.appendChild($n1582813765000014);
	__b.appendChild($n1582813765000013);
	}
	__p.insertBefore(__b, $n1582813765000010);
};
$n1582813765000008.appendChild($n1582813765000010);
$n1582813765000012();
$n1582813765000000.appendChild($n1582813765000008);
const $n1582813765000015 = document.createElement("p");
$n1582813765000015.setAttribute("class", "text-gray-400 text-sm");
const $n1582813765000016 = document.createTextNode("By ");
$n1582813765000015.appendChild($n1582813765000016);
const $n1582813765000017 = document.createTextNode('');
$n1582813765000015.appendChild($n1582813765000017);
$n1582813765000000.appendChild($n1582813765000015);
	$root.appendChild($n1582813765000000);
	effect(() => { const __v = props.post.title; $n1582813765000003.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.post.date; $n1582813765000005.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.post.excerpt; $n1582813765000007.data = __v == null ? '' : String(__v); });
	{
	  let __busy = false;
	  let __iv = undefined;
	  let __first = true;
	  effect(() => {
	    if (__first) { __first = false; __iv = (props.post.tags); return; }
	    if (__busy) return;
	    const __nv = (props.post.tags);
	    if (__nv !== __iv) {
	      for (const e of $n1582813765000011) destroy_block(e);
	      $n1582813765000011.length = 0;
	      __cleanup($n1582813765000009, $n1582813765000010);
	      __busy = true;
	      $n1582813765000012();
	      __busy = false;
	      __iv = (props.post.tags);
	    }
	  });
	}
	effect(() => { const __v = props.post.author; $n1582813765000017.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["PostsSummary"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const summary = useFetch('/api/posts', {
		key: 'posts',
		staleTime: 30000,
	});
const $n1582813765000018 = document.createElement("p");
$n1582813765000018.setAttribute("class", "text-gray-500 text-sm mt-2");
	$root.appendChild($n1582813765000018);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Posts"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const postsCell = track([]);
document.title = "Posts — useFetch demo";
const postsResource = useFetch('/api/posts', {
	key: 'posts',
	into: postsCell,
	staleTime: 30000,
	keepPreviousData: true,
	retry: 2,
	retryDelay: 400,
	timeout: 8000
});
const $n1582813765000019 = document.createElement("div");
$n1582813765000019.setAttribute("class", "flex items-center justify-between mb-6");
const $n1582813765000020 = document.createElement("div");
const $n1582813765000021 = document.createElement("h1");
$n1582813765000021.setAttribute("class", "text-3xl font-bold mb-1");
const $n1582813765000022 = document.createTextNode("Posts");
$n1582813765000021.appendChild($n1582813765000022);
$n1582813765000020.appendChild($n1582813765000021);
const $n1582813765000023 = document.createElement("p");
$n1582813765000023.setAttribute("class", "text-gray-500");
const $n1582813765000024 = document.createTextNode(" Fetched with useFetch — deduped, cached with staleTime, retried with backoff, timed out, and written into a tracked cell. ");
$n1582813765000023.appendChild($n1582813765000024);
$n1582813765000020.appendChild($n1582813765000023);
$n1582813765000019.appendChild($n1582813765000020);
const $n1582813765000025 = document.createElement("div");
$n1582813765000025.setAttribute("class", "flex items-center gap-3");
const $n1582813765000026 = document.createElement("span");
$n1582813765000026.setAttribute("class", "text-sm text-gray-400");
const $n1582813765000027 = document.createComment('if');
$n1582813765000026.appendChild($n1582813765000027);
let $n1582813765000029 = [];
const $n1582813765000028 = document.createComment('if-end');
const $n1582813765000030 = () => {
	const __p = $n1582813765000027.parentNode;
	const $n1582813765000031 = document.createDocumentFragment();
const $n1582813765000032 = document.createComment('if');
$n1582813765000031.appendChild($n1582813765000032);
let $n1582813765000034 = [];
const $n1582813765000033 = document.createComment('if-end');
const $n1582813765000035 = () => {
	const __p = $n1582813765000032.parentNode;
	const $n1582813765000036 = document.createDocumentFragment();
const $n1582813765000037 = document.createTextNode(String(('Refreshing…') ?? ''));
	$n1582813765000036.appendChild($n1582813765000037);
	__p.insertBefore($n1582813765000036, $n1582813765000033);
};
const $n1582813765000038 = () => {
	const __p = $n1582813765000032.parentNode;
	const $n1582813765000039 = document.createDocumentFragment();
const $n1582813765000040 = document.createTextNode(String(('Loading…') ?? ''));
	$n1582813765000039.appendChild($n1582813765000040);
	__p.insertBefore($n1582813765000039, $n1582813765000033);
};
$n1582813765000031.appendChild($n1582813765000033);
if (get(postsCell).length > 0) { $n1582813765000035(); } else { $n1582813765000038(); }
$n1582813765000029.push((() => {
    let __iv = get(postsCell).length > 0;
    let __first = true;
    return effect(() => {
      if (__first) { __first = false; __iv = get(postsCell).length > 0; return; }
      const __nv = get(postsCell).length > 0;
      if (__nv !== __iv) {
        for (const e of $n1582813765000034) destroy_block(e);
        $n1582813765000034.length = 0;
        __cleanup($n1582813765000032, $n1582813765000033);
        if (__nv) { $n1582813765000035(); } else { $n1582813765000038(); }
        __iv = __nv;
      }
    });
  })());
	__p.insertBefore($n1582813765000031, $n1582813765000028);
};
const $n1582813765000041 = () => {
	const __p = $n1582813765000027.parentNode;
	const $n1582813765000042 = document.createDocumentFragment();
const $n1582813765000043 = document.createTextNode(String(('Fresh') ?? ''));
	$n1582813765000042.appendChild($n1582813765000043);
	__p.insertBefore($n1582813765000042, $n1582813765000028);
};
$n1582813765000026.appendChild($n1582813765000028);
if (postsResource.loading) { $n1582813765000030(); } else { $n1582813765000041(); }
$n1582813765000025.appendChild($n1582813765000026);
const $n1582813765000044 = document.createElement("button");
$n1582813765000044.setAttribute("class", "bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg");
const $n1582813765000045 = document.createTextNode("Refresh");
$n1582813765000044.appendChild($n1582813765000045);
$n1582813765000044.__evh_click = () => postsResource.refresh();
$n1582813765000044.setAttribute('data-vsk-ev', '');
$n1582813765000025.appendChild($n1582813765000044);
$n1582813765000019.appendChild($n1582813765000025);
	$root.appendChild($n1582813765000019);
const $n1582813765000046 = document.createComment('if');
$root.appendChild($n1582813765000046);
let $n1582813765000048 = [];
const $n1582813765000047 = document.createComment('if-end');
const $n1582813765000049 = () => {
	const __p = $n1582813765000046.parentNode;
	const $n1582813765000050 = document.createDocumentFragment();
const $n1582813765000051 = document.createElement("div");
$n1582813765000051.setAttribute("class", "bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4");
const $n1582813765000052 = document.createElement("p");
$n1582813765000052.setAttribute("class", "mb-2");
const $n1582813765000053 = document.createTextNode("Failed to load posts: ");
$n1582813765000052.appendChild($n1582813765000053);
const $n1582813765000054 = document.createTextNode(String((postsResource.error.message) ?? ''));
$n1582813765000052.appendChild($n1582813765000054);
$n1582813765000051.appendChild($n1582813765000052);
const $n1582813765000055 = document.createElement("button");
$n1582813765000055.setAttribute("class", "bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-lg");
const $n1582813765000056 = document.createTextNode("Retry");
$n1582813765000055.appendChild($n1582813765000056);
$n1582813765000055.__evh_click = () => postsResource.refresh();
$n1582813765000055.setAttribute('data-vsk-ev', '');
$n1582813765000051.appendChild($n1582813765000055);
	$n1582813765000050.appendChild($n1582813765000051);
	__p.insertBefore($n1582813765000050, $n1582813765000047);
};
$root.appendChild($n1582813765000047);
if (postsResource.error) { $n1582813765000049(); }
const $n1582813765000057 = document.createComment('map');
$root.appendChild($n1582813765000057);
let $n1582813765000059 = [];
const $n1582813765000058 = document.createComment('map-end');
const $n1582813765000060 = (post, __e, __r) => {
	__r = __r || $n1582813765000058;
	const __p = $n1582813765000057.parentNode;
	const __it = document.createDocumentFragment();
if (__components["PostCard"] == null) throw new Error("Component \"PostCard\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n1582813765000061 = toDomNode(__components["PostCard"]({ "post": post }));
	__it.appendChild($n1582813765000061);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$root.appendChild($n1582813765000058);
const $n1582813765000062 = () => { const __l = get(postsCell); return __l != null && __l.length > 0; };
for (const post of get(postsCell)) {
	$n1582813765000060(post, $n1582813765000059);
}
if (__components["PostsSummary"] == null) throw new Error("Component \"PostsSummary\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n1582813765000063 = toDomNode(__components["PostsSummary"]({  }));
	$root.appendChild($n1582813765000063);
	{
	  let __first = true;
	  effect(() => {
	    const __nv = get(postsCell);
	    if (__first) { __first = false; __nv; return; }
	    for (const e of $n1582813765000059) destroy_block(e);
	    $n1582813765000059.length = 0;
	    __cleanup($n1582813765000057, $n1582813765000058);
	    for (const post of get(postsCell)) {
	    	$n1582813765000060(post, $n1582813765000059);
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
__hydrators["PostCard"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1582813765000064 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n1582813765000065 = __hydrate.nextElement("article", $n1582813765000064);
$n1582813765000064 = 0;
$n1582813765000065.setAttribute("class", "bg-white rounded-lg p-6 mb-4 shadow-sm border border-gray-100");
const $n1582813765000066 = __hydrate.subWalker($n1582813765000065);
const $n1582813765000067 = $n1582813765000066.nextElement("div", 0);
$n1582813765000067.setAttribute("class", "flex items-center justify-between mb-2");
const $n1582813765000068 = $n1582813765000066.subWalker($n1582813765000067);
const $n1582813765000069 = $n1582813765000068.nextElement("h2", 0);
$n1582813765000069.setAttribute("class", "text-xl font-semibold");
const $n1582813765000070 = document.createTextNode(String($n1582813765000069.__vsk_ssrText ?? ''));
if ($n1582813765000070.parentNode !== $n1582813765000069) { const __ssr = $n1582813765000069.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000069.insertBefore($n1582813765000070, __ssr[0]); else $n1582813765000069.appendChild($n1582813765000070); }
if ($n1582813765000069.parentNode !== $n1582813765000067) { if (!$n1582813765000067 || $n1582813765000069.parentNode == null || !$n1582813765000067.contains($n1582813765000069)) $n1582813765000067.appendChild($n1582813765000069); }
const $n1582813765000071 = $n1582813765000068.nextElement("span", 0);
$n1582813765000071.setAttribute("class", "text-gray-400 text-sm");
const $n1582813765000072 = document.createTextNode(String($n1582813765000071.__vsk_ssrText ?? ''));
if ($n1582813765000072.parentNode !== $n1582813765000071) { const __ssr = $n1582813765000071.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000071.insertBefore($n1582813765000072, __ssr[0]); else $n1582813765000071.appendChild($n1582813765000072); }
if ($n1582813765000071.parentNode !== $n1582813765000067) { if (!$n1582813765000067 || $n1582813765000071.parentNode == null || !$n1582813765000067.contains($n1582813765000071)) $n1582813765000067.appendChild($n1582813765000071); }
if ($n1582813765000067.parentNode !== $n1582813765000065) { if (!$n1582813765000065 || $n1582813765000067.parentNode == null || !$n1582813765000065.contains($n1582813765000067)) $n1582813765000065.appendChild($n1582813765000067); }
const $n1582813765000073 = $n1582813765000066.nextElement("p", 0);
$n1582813765000073.setAttribute("class", "text-gray-500 mb-3");
const $n1582813765000074 = document.createTextNode(String($n1582813765000073.__vsk_ssrText ?? ''));
if ($n1582813765000074.parentNode !== $n1582813765000073) { const __ssr = $n1582813765000073.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000073.insertBefore($n1582813765000074, __ssr[0]); else $n1582813765000073.appendChild($n1582813765000074); }
if ($n1582813765000073.parentNode !== $n1582813765000065) { if (!$n1582813765000065 || $n1582813765000073.parentNode == null || !$n1582813765000065.contains($n1582813765000073)) $n1582813765000065.appendChild($n1582813765000073); }
const $n1582813765000075 = $n1582813765000066.nextElement("div", 0);
$n1582813765000075.setAttribute("class", "flex gap-2 mb-3");
const $n1582813765000076 = $n1582813765000066.subWalker($n1582813765000075);
const $n1582813765000077 = document.createComment('for');
let $n1582813765000079 = [];
const $n1582813765000078 = document.createComment('for-end');
const $n1582813765000080 = () => {
	const __cl = [];
	for (const tag of (Array.isArray(props.post.tags) ? props.post.tags : (props.post.tags == null ? [] : Object.keys(props.post.tags)))) {
const $n1582813765000081 = $n1582813765000076.nextElement("span", 0);
$n1582813765000081.setAttribute("class", "bg-blue-50 text-blue-600 text-xs px-2 py-1 rounded-full");
const $n1582813765000082 = document.createTextNode(String((tag) ?? ''));
if ($n1582813765000082.parentNode !== $n1582813765000081) { const __ssr = $n1582813765000081.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000081.insertBefore($n1582813765000082, __ssr[0]); else $n1582813765000081.appendChild($n1582813765000082); }
	__cl.push($n1582813765000081);
	}
	__place($n1582813765000077, $n1582813765000078, __cl, $n1582813765000075);
};
$n1582813765000080();
if ($n1582813765000075.parentNode !== $n1582813765000065) { if (!$n1582813765000065 || $n1582813765000075.parentNode == null || !$n1582813765000065.contains($n1582813765000075)) $n1582813765000065.appendChild($n1582813765000075); }
const $n1582813765000083 = $n1582813765000066.nextElement("p", 0);
$n1582813765000083.setAttribute("class", "text-gray-400 text-sm");
const $n1582813765000084 = document.createTextNode("By ");
if ($n1582813765000084.parentNode !== $n1582813765000083) { const __ssr = $n1582813765000083.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000083.insertBefore($n1582813765000084, __ssr[0]); else $n1582813765000083.appendChild($n1582813765000084); }
const $n1582813765000085 = document.createTextNode('');
if ($n1582813765000085.parentNode !== $n1582813765000083) { const __ssr = $n1582813765000083.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000083.insertBefore($n1582813765000085, __ssr[0]); else $n1582813765000083.appendChild($n1582813765000085); }
if ($n1582813765000083.parentNode !== $n1582813765000065) { if (!$n1582813765000065 || $n1582813765000083.parentNode == null || !$n1582813765000065.contains($n1582813765000083)) $n1582813765000065.appendChild($n1582813765000083); }
	if ($mount === null) $mount = $n1582813765000065;
	if ($n1582813765000065 !== $mount && $n1582813765000065.parentNode == null) $mount.appendChild($n1582813765000065);
	effect(() => { const __v = props.post.title; $n1582813765000070.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.post.date; $n1582813765000072.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.post.excerpt; $n1582813765000074.data = __v == null ? '' : String(__v); });
	{
	  let __busy = false;
	  let __iv = undefined;
	  let __first = true;
	  effect(() => {
	    if (__first) { __first = false; __iv = (props.post.tags); return; }
	    if (__busy) return;
	    const __nv = (props.post.tags);
	    if (__nv !== __iv) {
	      for (const e of $n1582813765000079) destroy_block(e);
	      $n1582813765000079.length = 0;
	      __cleanup($n1582813765000077, $n1582813765000078);
	      __busy = true;
	      $n1582813765000080();
	      __busy = false;
	      __iv = (props.post.tags);
	    }
	  });
	}
	effect(() => { const __v = props.post.author; $n1582813765000085.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["PostsSummary"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1582813765000086 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
	__hydrate.claimOnly(undefined, $n1582813765000086);
	$n1582813765000086 = 0;
const summary = useFetch('/api/posts', {
		key: 'posts',
		staleTime: 30000,
	});
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Posts"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const postsCell = track([]);
let $n1582813765000088 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Posts — useFetch demo";
const postsResource = useFetch('/api/posts', {
	key: 'posts',
	into: postsCell,
	staleTime: 30000,
	keepPreviousData: true,
	retry: 2,
	retryDelay: 400,
	timeout: 8000
});
const $n1582813765000089 = __hydrate.nextElement("div", $n1582813765000088);
$n1582813765000088 = 0;
$n1582813765000089.setAttribute("class", "flex items-center justify-between mb-6");
const $n1582813765000090 = __hydrate.subWalker($n1582813765000089);
const $n1582813765000096 = $n1582813765000089.__vsk_ssrEls ? $n1582813765000089.__vsk_ssrEls[0] : (() => {
	const $n1582813765000091 = document.createElement("div");
	const $n1582813765000092 = document.createElement("h1");
	$n1582813765000092.setAttribute("class", "text-3xl font-bold mb-1");
	const $n1582813765000093 = document.createTextNode("Posts");
	$n1582813765000092.appendChild($n1582813765000093);
	$n1582813765000091.appendChild($n1582813765000092);
	const $n1582813765000094 = document.createElement("p");
	$n1582813765000094.setAttribute("class", "text-gray-500");
	const $n1582813765000095 = document.createTextNode(" Fetched with useFetch — deduped, cached with staleTime, retried with backoff, timed out, and written into a tracked cell. ");
	$n1582813765000094.appendChild($n1582813765000095);
	$n1582813765000091.appendChild($n1582813765000094);
	return $n1582813765000091;
})();
if ($n1582813765000096.parentNode !== $n1582813765000089) { if (!$n1582813765000089 || $n1582813765000096.parentNode == null || !$n1582813765000089.contains($n1582813765000096)) $n1582813765000089.appendChild($n1582813765000096); }
const $n1582813765000097 = $n1582813765000090.nextElement("div", 1);
$n1582813765000097.setAttribute("class", "flex items-center gap-3");
const $n1582813765000098 = $n1582813765000090.subWalker($n1582813765000097);
const $n1582813765000099 = $n1582813765000098.nextElement("span", 0);
$n1582813765000099.setAttribute("class", "text-sm text-gray-400");
const $n1582813765000100 = $n1582813765000098.subWalker($n1582813765000099);
const $n1582813765000101 = document.createComment('if');
let $n1582813765000103 = [];
const $n1582813765000102 = document.createComment('if-end');
const $n1582813765000104 = () => {
	const __cl = [];
const $n1582813765000106 = document.createComment('if');
let $n1582813765000108 = [];
const $n1582813765000107 = document.createComment('if-end');
const $n1582813765000109 = () => {
	const __cl = [];
const $n1582813765000111 = document.createTextNode(String(('Refreshing…') ?? ''));
	__cl.push($n1582813765000111);
	__place($n1582813765000106, $n1582813765000107, __cl, $n1582813765000099);
};
const $n1582813765000112 = () => {
	const __cl = [];
const $n1582813765000114 = document.createTextNode(String(('Loading…') ?? ''));
	__cl.push($n1582813765000114);
	__place($n1582813765000106, $n1582813765000107, __cl, $n1582813765000099);
};
if (get(postsCell).length > 0) { $n1582813765000109(); } else { $n1582813765000112(); }
$n1582813765000103.push((() => {
    let __iv = get(postsCell).length > 0;
    let __first = true;
    return effect(() => {
      if (__first) { __first = false; __iv = get(postsCell).length > 0; return; }
      const __nv = get(postsCell).length > 0;
      if (__nv !== __iv) {
        for (const e of $n1582813765000108) destroy_block(e);
        $n1582813765000108.length = 0;
        __cleanup($n1582813765000106, $n1582813765000107);
        if (__nv) { $n1582813765000109(); } else { $n1582813765000112(); }
        __iv = __nv;
      }
    });
  })());
	__place($n1582813765000101, $n1582813765000102, __cl, $n1582813765000099);
};
const $n1582813765000115 = () => {
	const __cl = [];
const $n1582813765000117 = document.createTextNode(String(('Fresh') ?? ''));
	__cl.push($n1582813765000117);
	__place($n1582813765000101, $n1582813765000102, __cl, $n1582813765000099);
};
if (postsResource.loading) { $n1582813765000104(); } else { $n1582813765000115(); }
if ($n1582813765000099.parentNode !== $n1582813765000097) { if (!$n1582813765000097 || $n1582813765000099.parentNode == null || !$n1582813765000097.contains($n1582813765000099)) $n1582813765000097.appendChild($n1582813765000099); }
const $n1582813765000118 = $n1582813765000098.nextElement("button", 0);
$n1582813765000118.setAttribute("class", "bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg");
const $n1582813765000119 = document.createTextNode("Refresh");
if ($n1582813765000119.parentNode !== $n1582813765000118) { const __ssr = $n1582813765000118.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000118.insertBefore($n1582813765000119, __ssr[0]); else $n1582813765000118.appendChild($n1582813765000119); }
$n1582813765000118.__evh_click = () => postsResource.refresh();
$n1582813765000118.setAttribute('data-vsk-ev', '');
if ($n1582813765000118.parentNode !== $n1582813765000097) { if (!$n1582813765000097 || $n1582813765000118.parentNode == null || !$n1582813765000097.contains($n1582813765000118)) $n1582813765000097.appendChild($n1582813765000118); }
if ($n1582813765000097.parentNode !== $n1582813765000089) { if (!$n1582813765000089 || $n1582813765000097.parentNode == null || !$n1582813765000089.contains($n1582813765000097)) $n1582813765000089.appendChild($n1582813765000097); }
	if ($mount === null) $mount = $n1582813765000089;
	if ($n1582813765000089 !== $mount && $n1582813765000089.parentNode == null) $mount.appendChild($n1582813765000089);
const $n1582813765000120 = document.createComment('if');
let $n1582813765000122 = [];
const $n1582813765000121 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n1582813765000120);
	__hydrate.insertBeforeNextClaim($n1582813765000121);
}
const $n1582813765000123 = () => {
	const __cl = [];
const $n1582813765000125 = __hydrate.nextElement("div", 0);
$n1582813765000125.setAttribute("class", "bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4");
const $n1582813765000126 = __hydrate.subWalker($n1582813765000125);
const $n1582813765000127 = $n1582813765000126.nextElement("p", 0);
$n1582813765000127.setAttribute("class", "mb-2");
const $n1582813765000128 = document.createTextNode("Failed to load posts: ");
if ($n1582813765000128.parentNode !== $n1582813765000127) { const __ssr = $n1582813765000127.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000127.insertBefore($n1582813765000128, __ssr[0]); else $n1582813765000127.appendChild($n1582813765000128); }
const $n1582813765000129 = document.createTextNode(String((postsResource.error.message) ?? ''));
if ($n1582813765000129.parentNode !== $n1582813765000127) { const __ssr = $n1582813765000127.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000127.insertBefore($n1582813765000129, __ssr[0]); else $n1582813765000127.appendChild($n1582813765000129); }
if ($n1582813765000127.parentNode !== $n1582813765000125) { if (!$n1582813765000125 || $n1582813765000127.parentNode == null || !$n1582813765000125.contains($n1582813765000127)) $n1582813765000125.appendChild($n1582813765000127); }
const $n1582813765000130 = $n1582813765000126.nextElement("button", 0);
$n1582813765000130.setAttribute("class", "bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-lg");
const $n1582813765000131 = document.createTextNode("Retry");
if ($n1582813765000131.parentNode !== $n1582813765000130) { const __ssr = $n1582813765000130.__vsk_ssrEls || []; if (0 < __ssr.length) $n1582813765000130.insertBefore($n1582813765000131, __ssr[0]); else $n1582813765000130.appendChild($n1582813765000131); }
$n1582813765000130.__evh_click = () => postsResource.refresh();
$n1582813765000130.setAttribute('data-vsk-ev', '');
if ($n1582813765000130.parentNode !== $n1582813765000125) { if (!$n1582813765000125 || $n1582813765000130.parentNode == null || !$n1582813765000125.contains($n1582813765000130)) $n1582813765000125.appendChild($n1582813765000130); }
	__cl.push($n1582813765000125);
	__place($n1582813765000120, $n1582813765000121, __cl, $root);
};
if (postsResource.error) { $n1582813765000123(); }
const $n1582813765000132 = document.createComment('map');
let $n1582813765000134 = [];
const $n1582813765000133 = document.createComment('map-end');
const $n1582813765000135 = (post, __e, __r, __cl) => {
	__r = __r || $n1582813765000133;
	const __p = $n1582813765000132.parentNode;
if (__hydrators["PostCard"] == null) throw new Error("Component \"PostCard\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n1582813765000136 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n1582813765000136 = toDomNode(__hydrators["PostCard"]({ "post": post }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
	if (__cl) __cl.push($n1582813765000136); else __p.insertBefore($n1582813765000136, __r);
};
const $n1582813765000137 = () => { const __l = get(postsCell); return __l != null && __l.length > 0; };
const $n1582813765000138 = [];
for (const post of get(postsCell)) {
	$n1582813765000135(post, $n1582813765000134, null, $n1582813765000138);
}
__place($n1582813765000132, $n1582813765000133, $n1582813765000138, $root);
if (__hydrators["PostsSummary"] == null) throw new Error("Component \"PostsSummary\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n1582813765000139 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n1582813765000139 = toDomNode(__hydrators["PostsSummary"]({  }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
	if ($mount === null) $mount = $n1582813765000139;
	if ($n1582813765000139 !== $mount && $n1582813765000139.parentNode == null) $mount.appendChild($n1582813765000139);
	{
	  let __first = true;
	  effect(() => {
	    const __nv = get(postsCell);
	    if (__first) { __first = false; __nv; return; }
	    for (const e of $n1582813765000134) destroy_block(e);
	    $n1582813765000134.length = 0;
	    __cleanup($n1582813765000132, $n1582813765000133);
	    for (const post of get(postsCell)) {
	    	$n1582813765000135(post, $n1582813765000134);
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

Object.defineProperty(__components, "Page_Posts", { get: () => __components["Posts"], configurable: true });

Object.defineProperty(__hydrators, "Page_Posts", { get: () => __hydrators["Posts"], configurable: true });
})();
