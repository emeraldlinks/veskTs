(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["AsyncPage"] = async (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = "Async — async components";
const posts = await useFetch('/api/posts');
const $n963356972000000 = document.createElement("h1");
$n963356972000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n963356972000001 = document.createTextNode("Async Demo");
$n963356972000000.appendChild($n963356972000001);
	$root.appendChild($n963356972000000);
const $n963356972000002 = document.createElement("p");
$n963356972000002.setAttribute("class", "text-gray-500 mb-6");
const $n963356972000003 = document.createTextNode(" This page is an ");
$n963356972000002.appendChild($n963356972000003);
const $n963356972000004 = document.createElement("code");
const $n963356972000005 = document.createTextNode("async component");
$n963356972000004.appendChild($n963356972000005);
$n963356972000002.appendChild($n963356972000004);
const $n963356972000006 = document.createTextNode(". ");
$n963356972000002.appendChild($n963356972000006);
const $n963356972000007 = document.createElement("code");
const $n963356972000008 = document.createTextNode("await useFetch('/api/posts')");
$n963356972000007.appendChild($n963356972000008);
$n963356972000002.appendChild($n963356972000007);
const $n963356972000009 = document.createTextNode(" suspends during SSR, the multi-pass renderer awaits it, and the page hydrates with the serialized data — no client-side refetch. ");
$n963356972000002.appendChild($n963356972000009);
	$root.appendChild($n963356972000002);
const $n963356972000010 = document.createElement("h2");
$n963356972000010.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n963356972000011 = document.createTextNode("Posts fetched during SSR");
$n963356972000010.appendChild($n963356972000011);
	$root.appendChild($n963356972000010);
const $n963356972000012 = document.createComment('map');
$root.appendChild($n963356972000012);
let $n963356972000014 = [];
const $n963356972000013 = document.createComment('map-end');
const $n963356972000015 = async (post, __e, __r) => {
	__r = __r || $n963356972000013;
	const __p = $n963356972000012.parentNode;
	const __it = document.createDocumentFragment();
const $n963356972000016 = document.createElement("div");
$n963356972000016.setAttribute("class", "bg-white rounded-lg p-4 mb-3 shadow-sm border border-gray-100");
const $n963356972000017 = document.createElement("h3");
$n963356972000017.setAttribute("class", "font-semibold");
const $n963356972000018 = document.createTextNode(String((post.title) ?? ''));
$n963356972000017.appendChild($n963356972000018);
$n963356972000016.appendChild($n963356972000017);
const $n963356972000019 = document.createElement("p");
$n963356972000019.setAttribute("class", "text-gray-500 text-sm");
const $n963356972000020 = document.createTextNode(String((post.excerpt) ?? ''));
$n963356972000019.appendChild($n963356972000020);
$n963356972000016.appendChild($n963356972000019);
	__it.appendChild($n963356972000016);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$root.appendChild($n963356972000013);
const $n963356972000021 = () => { const __l = posts; return __l != null && __l.length > 0; };
for (const post of posts) {
	await $n963356972000015(post, $n963356972000014);
}
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["AsyncPage"] = async (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n963356972000022 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Async — async components";
const posts = await useFetch('/api/posts');
let $n963356972000029 = 3; // first-claim budget: region SSR sits 3 slot(s) past the walker cursor
const $n963356972000026 = document.createComment('map');
let $n963356972000028 = [];
const $n963356972000027 = document.createComment('map-end');
const $n963356972000030 = async (post, __e, __r, __cl) => {
	__r = __r || $n963356972000027;
	const __p = $n963356972000026.parentNode;
const $n963356972000031 = __hydrate.nextElement("div", $n963356972000029);
$n963356972000029 = 0;
$n963356972000031.setAttribute("class", "bg-white rounded-lg p-4 mb-3 shadow-sm border border-gray-100");
const $n963356972000032 = __hydrate.subWalker($n963356972000031);
const $n963356972000033 = $n963356972000032.nextElement("h3", 0);
$n963356972000033.setAttribute("class", "font-semibold");
const $n963356972000034 = document.createTextNode(String((post.title) ?? ''));
if ($n963356972000034.parentNode !== $n963356972000033) { const __ssr = $n963356972000033.__vsk_ssrEls || []; if (0 < __ssr.length) $n963356972000033.insertBefore($n963356972000034, __ssr[0]); else $n963356972000033.appendChild($n963356972000034); }
if ($n963356972000033.parentNode !== $n963356972000031) { if (!$n963356972000031 || $n963356972000033.parentNode == null || !$n963356972000031.contains($n963356972000033)) $n963356972000031.appendChild($n963356972000033); }
const $n963356972000035 = $n963356972000032.nextElement("p", 0);
$n963356972000035.setAttribute("class", "text-gray-500 text-sm");
const $n963356972000036 = document.createTextNode(String((post.excerpt) ?? ''));
if ($n963356972000036.parentNode !== $n963356972000035) { const __ssr = $n963356972000035.__vsk_ssrEls || []; if (0 < __ssr.length) $n963356972000035.insertBefore($n963356972000036, __ssr[0]); else $n963356972000035.appendChild($n963356972000036); }
if ($n963356972000035.parentNode !== $n963356972000031) { if (!$n963356972000031 || $n963356972000035.parentNode == null || !$n963356972000031.contains($n963356972000035)) $n963356972000031.appendChild($n963356972000035); }
	if (__cl) __cl.push($n963356972000031); else __p.insertBefore($n963356972000031, __r);
};
const $n963356972000037 = () => { const __l = posts; return __l != null && __l.length > 0; };
const $n963356972000038 = [];
for (const post of posts) {
	await $n963356972000030(post, $n963356972000028, null, $n963356972000038);
}
__place($n963356972000026, $n963356972000027, $n963356972000038, $root);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Async", { get: () => __components["AsyncPage"], configurable: true });

Object.defineProperty(__hydrators, "Page_Async", { get: () => __hydrators["AsyncPage"], configurable: true });
})();
