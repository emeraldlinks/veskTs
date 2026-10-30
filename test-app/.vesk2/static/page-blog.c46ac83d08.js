(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const blogPosts = [
	{
		title: 'Hello World',
		href: '/blog/hello-world',
		summary: 'First post powered by Vesk'
	},

	{
		title: 'SSR in Vesk',
		href: '/blog/ssr-in-vesk',
		summary: 'How server-side rendering works'
	}
];


__components["Blog"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1566735828000000 = document.createElement("h1");
$n1566735828000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n1566735828000001 = document.createTextNode("Blog");
$n1566735828000000.appendChild($n1566735828000001);
	$root.appendChild($n1566735828000000);
const $n1566735828000002 = document.createComment('map');
$root.appendChild($n1566735828000002);
let $n1566735828000004 = [];
const $n1566735828000003 = document.createComment('map-end');
const $n1566735828000005 = (post, __e, __r) => {
	__r = __r || $n1566735828000003;
	const __p = $n1566735828000002.parentNode;
	const __it = document.createDocumentFragment();
const $n1566735828000006 = document.createElement("div");
$n1566735828000006.setAttribute("class", "bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100");
const $n1566735828000007 = document.createElement("h2");
$n1566735828000007.setAttribute("class", "text-lg font-semibold mb-1");
const $n1566735828000009 = (() => { const $f = document.createDocumentFragment();
const $n1566735828000010 = document.createTextNode(String((post.title) ?? ''));
$f.appendChild($n1566735828000010);
return $f; })();
const $n1566735828000008 = toDomNode(Link({ "href": post.href, "class": "text-gray-900 no-underline hover:text-blue-600", children: $n1566735828000009 }));
$n1566735828000007.appendChild($n1566735828000008);
$n1566735828000006.appendChild($n1566735828000007);
const $n1566735828000011 = document.createElement("p");
$n1566735828000011.setAttribute("class", "text-gray-400 text-sm");
const $n1566735828000012 = document.createTextNode(String((post.summary) ?? ''));
$n1566735828000011.appendChild($n1566735828000012);
$n1566735828000006.appendChild($n1566735828000011);
	__it.appendChild($n1566735828000006);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$root.appendChild($n1566735828000003);
const $n1566735828000013 = () => { const __l = blogPosts; return __l != null && __l.length > 0; };
for (const post of blogPosts) {
	$n1566735828000005(post, $n1566735828000004);
}
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Blog"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1566735828000014 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
let $n1566735828000019 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n1566735828000016 = document.createComment('map');
let $n1566735828000018 = [];
const $n1566735828000017 = document.createComment('map-end');
const $n1566735828000020 = (post, __e, __r, __cl) => {
	__r = __r || $n1566735828000017;
	const __p = $n1566735828000016.parentNode;
const $n1566735828000021 = __hydrate.nextElement("div", $n1566735828000019);
$n1566735828000019 = 0;
$n1566735828000021.setAttribute("class", "bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100");
const $n1566735828000022 = __hydrate.subWalker($n1566735828000021);
const $n1566735828000023 = $n1566735828000022.nextElement("h2", 0);
$n1566735828000023.setAttribute("class", "text-lg font-semibold mb-1");
const $n1566735828000024 = $n1566735828000022.subWalker($n1566735828000023);
const $n1566735828000026 = (() => { const $f = document.createDocumentFragment();
const $n1566735828000027 = document.createTextNode(String((post.title) ?? ''));
$f.appendChild($n1566735828000027);
return $f; })();
let $n1566735828000025 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n1566735828000025 = toDomNode(Link({ "href": post.href, "class": "text-gray-900 no-underline hover:text-blue-600", children: $n1566735828000026 }, __registry, $n1566735828000024)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n1566735828000024.retireDetached();
if ($n1566735828000025.parentNode !== $n1566735828000023) { if (!$n1566735828000023 || $n1566735828000025.parentNode == null || !$n1566735828000023.contains($n1566735828000025)) $n1566735828000023.appendChild($n1566735828000025); }
if ($n1566735828000023.parentNode !== $n1566735828000021) { if (!$n1566735828000021 || $n1566735828000023.parentNode == null || !$n1566735828000021.contains($n1566735828000023)) $n1566735828000021.appendChild($n1566735828000023); }
const $n1566735828000028 = $n1566735828000022.nextElement("p", 0);
$n1566735828000028.setAttribute("class", "text-gray-400 text-sm");
const $n1566735828000029 = document.createTextNode(String((post.summary) ?? ''));
if ($n1566735828000029.parentNode !== $n1566735828000028) { const __ssr = $n1566735828000028.__vsk_ssrEls || []; if (0 < __ssr.length) $n1566735828000028.insertBefore($n1566735828000029, __ssr[0]); else $n1566735828000028.appendChild($n1566735828000029); }
if ($n1566735828000028.parentNode !== $n1566735828000021) { if (!$n1566735828000021 || $n1566735828000028.parentNode == null || !$n1566735828000021.contains($n1566735828000028)) $n1566735828000021.appendChild($n1566735828000028); }
	if (__cl) __cl.push($n1566735828000021); else __p.insertBefore($n1566735828000021, __r);
};
const $n1566735828000030 = () => { const __l = blogPosts; return __l != null && __l.length > 0; };
const $n1566735828000031 = [];
for (const post of blogPosts) {
	$n1566735828000020(post, $n1566735828000018, null, $n1566735828000031);
}
__place($n1566735828000016, $n1566735828000017, $n1566735828000031, $root);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Blog", { get: () => __components["Blog"], configurable: true });

Object.defineProperty(__hydrators, "Page_Blog", { get: () => __hydrators["Blog"], configurable: true });
})();
