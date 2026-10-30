(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const initialTodos = [{ id: 1, text: 'Buy milk' }, { id: 2, text: 'Write docs' }];


__components["EmptyDemo"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const todos = track(initialTodos);
document.title = "Empty — keyed for-of with empty fallback";
function clear() {
	set(todos, []);
}
function restore() {
	set(todos, [...initialTodos]);
}
const $n1802141559000000 = document.createElement("h1");
$n1802141559000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n1802141559000001 = document.createTextNode("Empty-state Demo");
$n1802141559000000.appendChild($n1802141559000001);
	$root.appendChild($n1802141559000000);
const $n1802141559000002 = document.createElement("div");
$n1802141559000002.setAttribute("class", "flex gap-2 mb-6");
const $n1802141559000003 = document.createElement("button");
$n1802141559000003.setAttribute("class", "bg-red-600 text-white text-sm px-3 py-1 rounded");
const $n1802141559000004 = document.createTextNode("Clear");
$n1802141559000003.appendChild($n1802141559000004);
$n1802141559000003.__evh_click = clear;
$n1802141559000003.setAttribute('data-vsk-ev', '');
$n1802141559000002.appendChild($n1802141559000003);
const $n1802141559000005 = document.createElement("button");
$n1802141559000005.setAttribute("class", "bg-blue-600 text-white text-sm px-3 py-1 rounded");
const $n1802141559000006 = document.createTextNode("Restore");
$n1802141559000005.appendChild($n1802141559000006);
$n1802141559000005.__evh_click = restore;
$n1802141559000005.setAttribute('data-vsk-ev', '');
$n1802141559000002.appendChild($n1802141559000005);
	$root.appendChild($n1802141559000002);
const $n1802141559000007 = document.createElement("h2");
$n1802141559000007.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n1802141559000008 = document.createTextNode("Keyed for-of with empty block");
$n1802141559000007.appendChild($n1802141559000008);
	$root.appendChild($n1802141559000007);
const $n1802141559000009 = document.createElement("ul");
$n1802141559000009.setAttribute("class", "space-y-2");
const $n1802141559000010 = document.createComment('map');
$n1802141559000009.appendChild($n1802141559000010);
let $n1802141559000012 = [];
const $n1802141559000011 = document.createComment('map-end');
const $n1802141559000013 = (todo, __e, __r) => {
	__r = __r || $n1802141559000011;
	const __p = $n1802141559000010.parentNode;
	const __it = document.createDocumentFragment();
const $n1802141559000014 = document.createElement("li");
$n1802141559000014.setAttribute("class", "bg-gray-50 rounded px-3 py-2");
const $n1802141559000015 = document.createElement("b");
const $n1802141559000016 = document.createTextNode(String((todo.text) ?? ''));
$n1802141559000015.appendChild($n1802141559000016);
$n1802141559000014.appendChild($n1802141559000015);
const $n1802141559000017 = document.createElement("span");
$n1802141559000017.setAttribute("class", "text-gray-400 text-sm");
const $n1802141559000018 = document.createTextNode("#");
$n1802141559000017.appendChild($n1802141559000018);
const $n1802141559000019 = document.createTextNode(String((todo.id) ?? ''));
$n1802141559000017.appendChild($n1802141559000019);
$n1802141559000014.appendChild($n1802141559000017);
	__it.appendChild($n1802141559000014);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
const $n1802141559000020 = () => {
	const __p = $n1802141559000010.parentNode;
	const $n1802141559000021 = document.createDocumentFragment();
const $n1802141559000022 = document.createElement("li");
$n1802141559000022.setAttribute("class", "bg-gray-100 rounded px-3 py-2 text-gray-500");
const $n1802141559000023 = document.createTextNode("No todos yet — click Restore to add some.");
$n1802141559000022.appendChild($n1802141559000023);
	$n1802141559000021.appendChild($n1802141559000022);
	if ($n1802141559000021.childNodes.length > 0) __p.insertBefore($n1802141559000021, $n1802141559000011);
};
$n1802141559000009.appendChild($n1802141559000011);
const $n1802141559000024 = () => { const __l = get(todos); return __l != null && __l.length > 0; };
let $n1802141559000025 = () => {};
const $n1802141559000026 = () => { $n1802141559000025 = reconcile($n1802141559000010, $n1802141559000011, get(todos), (todo) => todo.id, (todo, __i, __e) => $n1802141559000013(todo, __e)); };
let $n1802141559000027 = !$n1802141559000024();
if (!$n1802141559000027) { $n1802141559000026(); } else { $n1802141559000020(); }
	$root.appendChild($n1802141559000009);
const $n1802141559000028 = document.createElement("h2");
$n1802141559000028.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n1802141559000029 = document.createTextNode("Statement-mode empty block");
$n1802141559000028.appendChild($n1802141559000029);
	$root.appendChild($n1802141559000028);
const $n1802141559000030 = document.createComment('map');
$root.appendChild($n1802141559000030);
let $n1802141559000032 = [];
const $n1802141559000031 = document.createComment('map-end');
const $n1802141559000033 = (todo, __e, __r) => {
	__r = __r || $n1802141559000031;
	const __p = $n1802141559000030.parentNode;
	const __it = document.createDocumentFragment();
const $n1802141559000034 = document.createElement("div");
$n1802141559000034.setAttribute("class", "bg-gray-50 rounded px-3 py-2 mb-2");
const $n1802141559000035 = document.createElement("b");
const $n1802141559000036 = document.createTextNode(String((todo.text) ?? ''));
$n1802141559000035.appendChild($n1802141559000036);
$n1802141559000034.appendChild($n1802141559000035);
const $n1802141559000037 = document.createElement("span");
$n1802141559000037.setAttribute("class", "text-gray-400 text-sm");
const $n1802141559000038 = document.createTextNode("#");
$n1802141559000037.appendChild($n1802141559000038);
const $n1802141559000039 = document.createTextNode(String((todo.id) ?? ''));
$n1802141559000037.appendChild($n1802141559000039);
$n1802141559000034.appendChild($n1802141559000037);
	__it.appendChild($n1802141559000034);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
const $n1802141559000040 = () => {
	const __p = $n1802141559000030.parentNode;
	const $n1802141559000041 = document.createDocumentFragment();
const $n1802141559000042 = document.createElement("div");
$n1802141559000042.setAttribute("class", "bg-gray-100 rounded px-3 py-2 mb-2 text-gray-500");
const $n1802141559000043 = document.createTextNode("Statement-mode: list is empty.");
$n1802141559000042.appendChild($n1802141559000043);
	$n1802141559000041.appendChild($n1802141559000042);
	if ($n1802141559000041.childNodes.length > 0) __p.insertBefore($n1802141559000041, $n1802141559000031);
};
$root.appendChild($n1802141559000031);
const $n1802141559000044 = () => { const __l = get(todos); return __l != null && __l.length > 0; };
let $n1802141559000045 = () => {};
const $n1802141559000046 = () => { $n1802141559000045 = reconcile($n1802141559000030, $n1802141559000031, get(todos), (todo) => todo.id, (todo, __i, __e) => $n1802141559000033(todo, __e)); };
let $n1802141559000047 = !$n1802141559000044();
if (!$n1802141559000047) { $n1802141559000046(); } else { $n1802141559000040(); }
const $n1802141559000048 = document.createElement("p");
$n1802141559000048.setAttribute("class", "text-gray-500 text-sm mt-6");
const $n1802141559000049 = document.createTextNode(" The ");
$n1802141559000048.appendChild($n1802141559000049);
const $n1802141559000050 = document.createElement("code");
const $n1802141559000051 = document.createTextNode("empty");
$n1802141559000050.appendChild($n1802141559000051);
$n1802141559000048.appendChild($n1802141559000050);
const $n1802141559000052 = document.createTextNode(" block renders when the list is empty. The list uses ");
$n1802141559000048.appendChild($n1802141559000052);
const $n1802141559000053 = document.createElement("code");
const $n1802141559000054 = document.createTextNode("; key todo.id");
$n1802141559000053.appendChild($n1802141559000054);
$n1802141559000048.appendChild($n1802141559000053);
const $n1802141559000055 = document.createTextNode(" for keyed reconciliation. ");
$n1802141559000048.appendChild($n1802141559000055);
	$root.appendChild($n1802141559000048);
	{
	  let __first = true;
	  effect(() => {
	    const __new = $n1802141559000024();
	    if (__first) { __first = false; __new; return; }
	    if (__new !== $n1802141559000027) {
	      if (__new) { $n1802141559000025(get(todos)); }
	      return;
	    }
	    $n1802141559000027 = !__new;
	    for (const e of $n1802141559000012) destroy_block(e);
	    $n1802141559000012.length = 0;
	    __cleanup($n1802141559000010, $n1802141559000011);
	    if (__new) { $n1802141559000026(); } else { $n1802141559000020(); }
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __new = $n1802141559000044();
	    if (__first) { __first = false; __new; return; }
	    if (__new !== $n1802141559000047) {
	      if (__new) { $n1802141559000045(get(todos)); }
	      return;
	    }
	    $n1802141559000047 = !__new;
	    for (const e of $n1802141559000032) destroy_block(e);
	    $n1802141559000032.length = 0;
	    __cleanup($n1802141559000030, $n1802141559000031);
	    if (__new) { $n1802141559000046(); } else { $n1802141559000040(); }
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
__hydrators["EmptyDemo"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const todos = track(initialTodos);
let $n1802141559000056 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Empty — keyed for-of with empty fallback";
function clear() {
	set(todos, []);
}
function restore() {
	set(todos, [...initialTodos]);
}
const $n1802141559000058 = __hydrate.nextElement("div", $n1802141559000056 + 1);
$n1802141559000056 = 0;
$n1802141559000058.setAttribute("class", "flex gap-2 mb-6");
const $n1802141559000059 = __hydrate.subWalker($n1802141559000058);
const $n1802141559000060 = $n1802141559000059.nextElement("button", 0);
$n1802141559000060.setAttribute("class", "bg-red-600 text-white text-sm px-3 py-1 rounded");
const $n1802141559000061 = document.createTextNode("Clear");
if ($n1802141559000061.parentNode !== $n1802141559000060) { const __ssr = $n1802141559000060.__vsk_ssrEls || []; if (0 < __ssr.length) $n1802141559000060.insertBefore($n1802141559000061, __ssr[0]); else $n1802141559000060.appendChild($n1802141559000061); }
$n1802141559000060.__evh_click = clear;
$n1802141559000060.setAttribute('data-vsk-ev', '');
if ($n1802141559000060.parentNode !== $n1802141559000058) { if (!$n1802141559000058 || $n1802141559000060.parentNode == null || !$n1802141559000058.contains($n1802141559000060)) $n1802141559000058.appendChild($n1802141559000060); }
const $n1802141559000062 = $n1802141559000059.nextElement("button", 0);
$n1802141559000062.setAttribute("class", "bg-blue-600 text-white text-sm px-3 py-1 rounded");
const $n1802141559000063 = document.createTextNode("Restore");
if ($n1802141559000063.parentNode !== $n1802141559000062) { const __ssr = $n1802141559000062.__vsk_ssrEls || []; if (0 < __ssr.length) $n1802141559000062.insertBefore($n1802141559000063, __ssr[0]); else $n1802141559000062.appendChild($n1802141559000063); }
$n1802141559000062.__evh_click = restore;
$n1802141559000062.setAttribute('data-vsk-ev', '');
if ($n1802141559000062.parentNode !== $n1802141559000058) { if (!$n1802141559000058 || $n1802141559000062.parentNode == null || !$n1802141559000058.contains($n1802141559000062)) $n1802141559000058.appendChild($n1802141559000062); }
	if ($mount === null) $mount = $n1802141559000058;
	if ($n1802141559000058 !== $mount && $n1802141559000058.parentNode == null) $mount.appendChild($n1802141559000058);
const $n1802141559000065 = __hydrate.nextElement("ul", 1);
$n1802141559000065.setAttribute("class", "space-y-2");
const $n1802141559000066 = __hydrate.subWalker($n1802141559000065);
const $n1802141559000067 = document.createComment('map');
let $n1802141559000069 = [];
const $n1802141559000068 = document.createComment('map-end');
const $n1802141559000070 = (todo, __e, __r, __root) => {
	__r = __r || $n1802141559000068;
	const __p = $n1802141559000067.parentNode;
	const __it = document.createDocumentFragment();
const $n1802141559000071 = __root || document.createElement("li");
$n1802141559000071.setAttribute("class", "bg-gray-50 rounded px-3 py-2");
const $n1802141559000072 = $n1802141559000066.subWalker($n1802141559000071);
const $n1802141559000073 = $n1802141559000072.nextElement("b", 0);
const $n1802141559000074 = document.createTextNode(String((todo.text) ?? ''));
if ($n1802141559000074.parentNode !== $n1802141559000073) { const __ssr = $n1802141559000073.__vsk_ssrEls || []; if (0 < __ssr.length) $n1802141559000073.insertBefore($n1802141559000074, __ssr[0]); else $n1802141559000073.appendChild($n1802141559000074); }
if ($n1802141559000073.parentNode !== $n1802141559000071) { if (!$n1802141559000071 || $n1802141559000073.parentNode == null || !$n1802141559000071.contains($n1802141559000073)) $n1802141559000071.appendChild($n1802141559000073); }
const $n1802141559000075 = $n1802141559000072.nextElement("span", 0);
$n1802141559000075.setAttribute("class", "text-gray-400 text-sm");
const $n1802141559000076 = document.createTextNode("#");
if ($n1802141559000076.parentNode !== $n1802141559000075) { const __ssr = $n1802141559000075.__vsk_ssrEls || []; if (0 < __ssr.length) $n1802141559000075.insertBefore($n1802141559000076, __ssr[0]); else $n1802141559000075.appendChild($n1802141559000076); }
const $n1802141559000077 = document.createTextNode(String((todo.id) ?? ''));
if ($n1802141559000077.parentNode !== $n1802141559000075) { const __ssr = $n1802141559000075.__vsk_ssrEls || []; if (0 < __ssr.length) $n1802141559000075.insertBefore($n1802141559000077, __ssr[0]); else $n1802141559000075.appendChild($n1802141559000077); }
if ($n1802141559000075.parentNode !== $n1802141559000071) { if (!$n1802141559000071 || $n1802141559000075.parentNode == null || !$n1802141559000071.contains($n1802141559000075)) $n1802141559000071.appendChild($n1802141559000075); }
	if (__root != null) { if ($n1802141559000071.parentNode == null) __p.insertBefore($n1802141559000071, __root.nextSibling); } else __it.appendChild($n1802141559000071);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
const $n1802141559000078 = () => {
	const __p = $n1802141559000067.parentNode;
	const $n1802141559000079 = document.createDocumentFragment();
const $n1802141559000080 = document.createElement("li");
$n1802141559000080.setAttribute("class", "bg-gray-100 rounded px-3 py-2 text-gray-500");
const $n1802141559000081 = document.createTextNode("No todos yet — click Restore to add some.");
$n1802141559000080.appendChild($n1802141559000081);
	$n1802141559000079.appendChild($n1802141559000080);
	if ($n1802141559000079.childNodes.length > 0) __p.insertBefore($n1802141559000079, $n1802141559000068);
};
const $n1802141559000082 = () => { const __l = get(todos); return __l != null && __l.length > 0; };
let $n1802141559000083 = () => {};
const $n1802141559000084 = () => { $n1802141559000083 = reconcileHydrated($n1802141559000067, $n1802141559000068, get(todos), (todo) => todo.id, (todo, __i, __e, __root) => $n1802141559000070(todo, __e, null, __root), __hydrate, $n1802141559000065, 0); };
let $n1802141559000085 = !$n1802141559000082();
if (!$n1802141559000085) { $n1802141559000084(); } else { $n1802141559000078(); }
	if ($mount === null) $mount = $n1802141559000065;
	if ($n1802141559000065 !== $mount && $n1802141559000065.parentNode == null) $mount.appendChild($n1802141559000065);
const $n1802141559000087 = document.createComment('map');
let $n1802141559000089 = [];
const $n1802141559000088 = document.createComment('map-end');
const $n1802141559000090 = (todo, __e, __r, __root) => {
	__r = __r || $n1802141559000088;
	const __p = $n1802141559000087.parentNode;
	const __it = document.createDocumentFragment();
const $n1802141559000091 = __root || document.createElement("div");
$n1802141559000091.setAttribute("class", "bg-gray-50 rounded px-3 py-2 mb-2");
const $n1802141559000092 = __hydrate.subWalker($n1802141559000091);
const $n1802141559000093 = $n1802141559000092.nextElement("b", 0);
const $n1802141559000094 = document.createTextNode(String((todo.text) ?? ''));
if ($n1802141559000094.parentNode !== $n1802141559000093) { const __ssr = $n1802141559000093.__vsk_ssrEls || []; if (0 < __ssr.length) $n1802141559000093.insertBefore($n1802141559000094, __ssr[0]); else $n1802141559000093.appendChild($n1802141559000094); }
if ($n1802141559000093.parentNode !== $n1802141559000091) { if (!$n1802141559000091 || $n1802141559000093.parentNode == null || !$n1802141559000091.contains($n1802141559000093)) $n1802141559000091.appendChild($n1802141559000093); }
const $n1802141559000095 = $n1802141559000092.nextElement("span", 0);
$n1802141559000095.setAttribute("class", "text-gray-400 text-sm");
const $n1802141559000096 = document.createTextNode("#");
if ($n1802141559000096.parentNode !== $n1802141559000095) { const __ssr = $n1802141559000095.__vsk_ssrEls || []; if (0 < __ssr.length) $n1802141559000095.insertBefore($n1802141559000096, __ssr[0]); else $n1802141559000095.appendChild($n1802141559000096); }
const $n1802141559000097 = document.createTextNode(String((todo.id) ?? ''));
if ($n1802141559000097.parentNode !== $n1802141559000095) { const __ssr = $n1802141559000095.__vsk_ssrEls || []; if (0 < __ssr.length) $n1802141559000095.insertBefore($n1802141559000097, __ssr[0]); else $n1802141559000095.appendChild($n1802141559000097); }
if ($n1802141559000095.parentNode !== $n1802141559000091) { if (!$n1802141559000091 || $n1802141559000095.parentNode == null || !$n1802141559000091.contains($n1802141559000095)) $n1802141559000091.appendChild($n1802141559000095); }
	if (__root != null) { if ($n1802141559000091.parentNode == null) __p.insertBefore($n1802141559000091, __root.nextSibling); } else __it.appendChild($n1802141559000091);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
const $n1802141559000098 = () => {
	const __p = $n1802141559000087.parentNode;
	const $n1802141559000099 = document.createDocumentFragment();
const $n1802141559000100 = document.createElement("div");
$n1802141559000100.setAttribute("class", "bg-gray-100 rounded px-3 py-2 mb-2 text-gray-500");
const $n1802141559000101 = document.createTextNode("Statement-mode: list is empty.");
$n1802141559000100.appendChild($n1802141559000101);
	$n1802141559000099.appendChild($n1802141559000100);
	if ($n1802141559000099.childNodes.length > 0) __p.insertBefore($n1802141559000099, $n1802141559000088);
};
const $n1802141559000102 = () => { const __l = get(todos); return __l != null && __l.length > 0; };
let $n1802141559000103 = () => {};
const $n1802141559000104 = () => { $n1802141559000103 = reconcileHydrated($n1802141559000087, $n1802141559000088, get(todos), (todo) => todo.id, (todo, __i, __e, __root) => $n1802141559000090(todo, __e, null, __root), __hydrate, $root, 1); };
let $n1802141559000105 = !$n1802141559000102();
if (!$n1802141559000105) { $n1802141559000104(); } else { $n1802141559000098(); }
	{
	  let __first = true;
	  effect(() => {
	    const __new = $n1802141559000082();
	    if (__first) { __first = false; __new; return; }
	    if (__new !== $n1802141559000085) {
	      if (__new) { $n1802141559000083(get(todos)); }
	      return;
	    }
	    $n1802141559000085 = !__new;
	    for (const e of $n1802141559000069) destroy_block(e);
	    $n1802141559000069.length = 0;
	    __cleanup($n1802141559000067, $n1802141559000068);
	    if (__new) { $n1802141559000084(); } else { $n1802141559000078(); }
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __new = $n1802141559000102();
	    if (__first) { __first = false; __new; return; }
	    if (__new !== $n1802141559000105) {
	      if (__new) { $n1802141559000103(get(todos)); }
	      return;
	    }
	    $n1802141559000105 = !__new;
	    for (const e of $n1802141559000089) destroy_block(e);
	    $n1802141559000089.length = 0;
	    __cleanup($n1802141559000087, $n1802141559000088);
	    if (__new) { $n1802141559000104(); } else { $n1802141559000098(); }
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

Object.defineProperty(__components, "Page_Empty", { get: () => __components["EmptyDemo"], configurable: true });

Object.defineProperty(__hydrators, "Page_Empty", { get: () => __hydrators["EmptyDemo"], configurable: true });
})();
