(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const counter = createStore({ count: 0 });
const tags = createStore(['alpha', 'beta']);


__components["StoreApiIsland"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const count = track(0);
const $n733837732000000 = document.createElement("div");
$n733837732000000.setAttribute("class", "store-api-box");
const $n733837732000001 = document.createElement("p");
$n733837732000001.setAttribute("class", "store-api-count");
const $n733837732000002 = document.createTextNode("Store count: ");
$n733837732000001.appendChild($n733837732000002);
const $n733837732000003 = document.createTextNode('');
$n733837732000001.appendChild($n733837732000003);
$n733837732000000.appendChild($n733837732000001);
const $n733837732000004 = document.createElement("p");
$n733837732000004.setAttribute("class", "store-api-tags");
const $n733837732000005 = document.createTextNode("Tags: ");
$n733837732000004.appendChild($n733837732000005);
const $n733837732000006 = document.createTextNode('');
$n733837732000004.appendChild($n733837732000006);
$n733837732000000.appendChild($n733837732000004);
const $n733837732000007 = document.createElement("button");
$n733837732000007.setAttribute("class", "store-api-bump");
const $n733837732000008 = document.createTextNode("bump");
$n733837732000007.appendChild($n733837732000008);
$n733837732000007.__evh_click = () => {
	counter.update({ count: counter.get().count + 1 });
	set(count, counter.get().count);
};
$n733837732000007.setAttribute('data-vsk-ev', '');
$n733837732000000.appendChild($n733837732000007);
	$root.appendChild($n733837732000000);
	effect(() => { const __v = get(count); $n733837732000003.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = tags.get().join(', '); $n733837732000006.data = __v == null ? '' : String(__v); });
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

__components["StoreApiPage"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = "Store API";
const $n733837732000009 = document.createElement("h1");
$n733837732000009.setAttribute("class", "text-3xl font-bold mb-4");
const $n733837732000010 = document.createTextNode("Store API");
$n733837732000009.appendChild($n733837732000010);
	$root.appendChild($n733837732000009);
const $n733837732000011 = document.createElement("p");
$n733837732000011.setAttribute("class", "store-api-ssr");
const $n733837732000012 = document.createTextNode("SSR store count: ");
$n733837732000011.appendChild($n733837732000012);
const $n733837732000013 = document.createTextNode('');
$n733837732000011.appendChild($n733837732000013);
	$root.appendChild($n733837732000011);
const $n733837732000014 = document.createElement("p");
$n733837732000014.setAttribute("class", "store-api-tags-ssr");
const $n733837732000015 = document.createTextNode("SSR tags: ");
$n733837732000014.appendChild($n733837732000015);
const $n733837732000016 = document.createTextNode('');
$n733837732000014.appendChild($n733837732000016);
	$root.appendChild($n733837732000014);
if (__components["StoreApiIsland"] == null) throw new Error("Component \"StoreApiIsland\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n733837732000017 = toDomNode(__components["StoreApiIsland"]({  }));
	$root.appendChild($n733837732000017);
	effect(() => { const __v = counter.get().count; $n733837732000013.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = tags.get().join(', '); $n733837732000016.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["StoreApiIsland"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const count = track(0);
let $n733837732000018 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n733837732000019 = __hydrate.nextElement("div", $n733837732000018);
$n733837732000018 = 0;
$n733837732000019.setAttribute("class", "store-api-box");
const $n733837732000020 = __hydrate.subWalker($n733837732000019);
const $n733837732000021 = $n733837732000020.nextElement("p", 0);
$n733837732000021.setAttribute("class", "store-api-count");
const $n733837732000022 = document.createTextNode("Store count: ");
if ($n733837732000022.parentNode !== $n733837732000021) { const __ssr = $n733837732000021.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000021.insertBefore($n733837732000022, __ssr[0]); else $n733837732000021.appendChild($n733837732000022); }
const $n733837732000023 = document.createTextNode('');
if ($n733837732000023.parentNode !== $n733837732000021) { const __ssr = $n733837732000021.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000021.insertBefore($n733837732000023, __ssr[0]); else $n733837732000021.appendChild($n733837732000023); }
if ($n733837732000021.parentNode !== $n733837732000019) { if (!$n733837732000019 || $n733837732000021.parentNode == null || !$n733837732000019.contains($n733837732000021)) $n733837732000019.appendChild($n733837732000021); }
const $n733837732000024 = $n733837732000020.nextElement("p", 0);
$n733837732000024.setAttribute("class", "store-api-tags");
const $n733837732000025 = document.createTextNode("Tags: ");
if ($n733837732000025.parentNode !== $n733837732000024) { const __ssr = $n733837732000024.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000024.insertBefore($n733837732000025, __ssr[0]); else $n733837732000024.appendChild($n733837732000025); }
const $n733837732000026 = document.createTextNode('');
if ($n733837732000026.parentNode !== $n733837732000024) { const __ssr = $n733837732000024.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000024.insertBefore($n733837732000026, __ssr[0]); else $n733837732000024.appendChild($n733837732000026); }
if ($n733837732000024.parentNode !== $n733837732000019) { if (!$n733837732000019 || $n733837732000024.parentNode == null || !$n733837732000019.contains($n733837732000024)) $n733837732000019.appendChild($n733837732000024); }
const $n733837732000027 = $n733837732000020.nextElement("button", 0);
$n733837732000027.setAttribute("class", "store-api-bump");
const $n733837732000028 = document.createTextNode("bump");
if ($n733837732000028.parentNode !== $n733837732000027) { const __ssr = $n733837732000027.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000027.insertBefore($n733837732000028, __ssr[0]); else $n733837732000027.appendChild($n733837732000028); }
$n733837732000027.__evh_click = () => {
	counter.update({ count: counter.get().count + 1 });
	set(count, counter.get().count);
};
$n733837732000027.setAttribute('data-vsk-ev', '');
if ($n733837732000027.parentNode !== $n733837732000019) { if (!$n733837732000019 || $n733837732000027.parentNode == null || !$n733837732000019.contains($n733837732000027)) $n733837732000019.appendChild($n733837732000027); }
	if ($mount === null) $mount = $n733837732000019;
	if ($n733837732000019 !== $mount && $n733837732000019.parentNode == null) $mount.appendChild($n733837732000019);
	effect(() => { const __v = get(count); $n733837732000023.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = tags.get().join(', '); $n733837732000026.data = __v == null ? '' : String(__v); });
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

__hydrators["StoreApiPage"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n733837732000029 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Store API";
const $n733837732000031 = __hydrate.nextElement("p", $n733837732000029 + 1);
$n733837732000029 = 0;
$n733837732000031.setAttribute("class", "store-api-ssr");
const $n733837732000032 = document.createTextNode("SSR store count: ");
if ($n733837732000032.parentNode !== $n733837732000031) { const __ssr = $n733837732000031.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000031.insertBefore($n733837732000032, __ssr[0]); else $n733837732000031.appendChild($n733837732000032); }
const $n733837732000033 = document.createTextNode('');
if ($n733837732000033.parentNode !== $n733837732000031) { const __ssr = $n733837732000031.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000031.insertBefore($n733837732000033, __ssr[0]); else $n733837732000031.appendChild($n733837732000033); }
	if ($mount === null) $mount = $n733837732000031;
	if ($n733837732000031 !== $mount && $n733837732000031.parentNode == null) $mount.appendChild($n733837732000031);
const $n733837732000034 = __hydrate.nextElement("p", 0);
$n733837732000034.setAttribute("class", "store-api-tags-ssr");
const $n733837732000035 = document.createTextNode("SSR tags: ");
if ($n733837732000035.parentNode !== $n733837732000034) { const __ssr = $n733837732000034.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000034.insertBefore($n733837732000035, __ssr[0]); else $n733837732000034.appendChild($n733837732000035); }
const $n733837732000036 = document.createTextNode('');
if ($n733837732000036.parentNode !== $n733837732000034) { const __ssr = $n733837732000034.__vsk_ssrEls || []; if (0 < __ssr.length) $n733837732000034.insertBefore($n733837732000036, __ssr[0]); else $n733837732000034.appendChild($n733837732000036); }
	if ($mount === null) $mount = $n733837732000034;
	if ($n733837732000034 !== $mount && $n733837732000034.parentNode == null) $mount.appendChild($n733837732000034);
if (__hydrators["StoreApiIsland"] == null) throw new Error("Component \"StoreApiIsland\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n733837732000037 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n733837732000037 = toDomNode(__hydrators["StoreApiIsland"]({  }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
	if ($mount === null) $mount = $n733837732000037;
	if ($n733837732000037 !== $mount && $n733837732000037.parentNode == null) $mount.appendChild($n733837732000037);
	effect(() => { const __v = counter.get().count; $n733837732000033.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = tags.get().join(', '); $n733837732000036.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Store-api", { get: () => __components["StoreApiPage"], configurable: true });

Object.defineProperty(__hydrators, "Page_Store-api", { get: () => __hydrators["StoreApiPage"], configurable: true });
})();
