(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const features = [
	{
		title: 'Compiler-first',
		body: 'Vesk compiles .vsk components to standard ESM with SSR, hydration, and fine-grained reactivity.'
	},

	{
		title: 'Islands architecture',
		body: 'Zero-JS pages with client islands, AOT event delegation, and streaming SSR.'
	}
];


__components["About"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n3430844763000000 = document.createElement("h1");
$n3430844763000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n3430844763000001 = document.createTextNode("About Vesk");
$n3430844763000000.appendChild($n3430844763000001);
	$root.appendChild($n3430844763000000);
const $n3430844763000002 = document.createElement("p");
$n3430844763000002.setAttribute("class", "text-gray-600 mb-3");
const $n3430844763000003 = document.createTextNode(" Vesk is a compiler-first reactive UI framework. It compiles .vsk components to standard ESM with SSR, hydration, and fine-grained reactivity. ");
$n3430844763000002.appendChild($n3430844763000003);
	$root.appendChild($n3430844763000002);
const $n3430844763000004 = document.createComment('map');
$root.appendChild($n3430844763000004);
let $n3430844763000006 = [];
const $n3430844763000005 = document.createComment('map-end');
const $n3430844763000007 = (feature, __e, __r) => {
	__r = __r || $n3430844763000005;
	const __p = $n3430844763000004.parentNode;
	const __it = document.createDocumentFragment();
const $n3430844763000008 = document.createElement("div");
$n3430844763000008.setAttribute("class", "mb-3");
const $n3430844763000009 = document.createElement("h2");
$n3430844763000009.setAttribute("class", "text-lg font-semibold");
const $n3430844763000010 = document.createTextNode(String((feature.title) ?? ''));
$n3430844763000009.appendChild($n3430844763000010);
$n3430844763000008.appendChild($n3430844763000009);
const $n3430844763000011 = document.createElement("p");
$n3430844763000011.setAttribute("class", "text-gray-600");
const $n3430844763000012 = document.createTextNode(String((feature.body) ?? ''));
$n3430844763000011.appendChild($n3430844763000012);
$n3430844763000008.appendChild($n3430844763000011);
	__it.appendChild($n3430844763000008);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$root.appendChild($n3430844763000005);
const $n3430844763000013 = () => { const __l = features; return __l != null && __l.length > 0; };
for (const feature of features) {
	$n3430844763000007(feature, $n3430844763000006);
}
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["About"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n3430844763000014 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
let $n3430844763000020 = 2; // first-claim budget: region SSR sits 2 slot(s) past the walker cursor
const $n3430844763000017 = document.createComment('map');
let $n3430844763000019 = [];
const $n3430844763000018 = document.createComment('map-end');
const $n3430844763000021 = (feature, __e, __r, __cl) => {
	__r = __r || $n3430844763000018;
	const __p = $n3430844763000017.parentNode;
const $n3430844763000022 = __hydrate.nextElement("div", $n3430844763000020);
$n3430844763000020 = 0;
$n3430844763000022.setAttribute("class", "mb-3");
const $n3430844763000023 = __hydrate.subWalker($n3430844763000022);
const $n3430844763000024 = $n3430844763000023.nextElement("h2", 0);
$n3430844763000024.setAttribute("class", "text-lg font-semibold");
const $n3430844763000025 = document.createTextNode(String((feature.title) ?? ''));
if ($n3430844763000025.parentNode !== $n3430844763000024) { const __ssr = $n3430844763000024.__vsk_ssrEls || []; if (0 < __ssr.length) $n3430844763000024.insertBefore($n3430844763000025, __ssr[0]); else $n3430844763000024.appendChild($n3430844763000025); }
if ($n3430844763000024.parentNode !== $n3430844763000022) { if (!$n3430844763000022 || $n3430844763000024.parentNode == null || !$n3430844763000022.contains($n3430844763000024)) $n3430844763000022.appendChild($n3430844763000024); }
const $n3430844763000026 = $n3430844763000023.nextElement("p", 0);
$n3430844763000026.setAttribute("class", "text-gray-600");
const $n3430844763000027 = document.createTextNode(String((feature.body) ?? ''));
if ($n3430844763000027.parentNode !== $n3430844763000026) { const __ssr = $n3430844763000026.__vsk_ssrEls || []; if (0 < __ssr.length) $n3430844763000026.insertBefore($n3430844763000027, __ssr[0]); else $n3430844763000026.appendChild($n3430844763000027); }
if ($n3430844763000026.parentNode !== $n3430844763000022) { if (!$n3430844763000022 || $n3430844763000026.parentNode == null || !$n3430844763000022.contains($n3430844763000026)) $n3430844763000022.appendChild($n3430844763000026); }
	if (__cl) __cl.push($n3430844763000022); else __p.insertBefore($n3430844763000022, __r);
};
const $n3430844763000028 = () => { const __l = features; return __l != null && __l.length > 0; };
const $n3430844763000029 = [];
for (const feature of features) {
	$n3430844763000021(feature, $n3430844763000019, null, $n3430844763000029);
}
__place($n3430844763000017, $n3430844763000018, $n3430844763000029, $root);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_About", { get: () => __components["About"], configurable: true });

Object.defineProperty(__hydrators, "Page_About", { get: () => __hydrators["About"], configurable: true });
})();
