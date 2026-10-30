(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["BlogPost"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n4065816788000001 = (() => { const $f = document.createDocumentFragment();
const $n4065816788000002 = document.createTextNode(" ← Back to blog ");
$f.appendChild($n4065816788000002);
return $f; })();
const $n4065816788000000 = toDomNode(Link({ "href": "/blog", "class": "inline-block mb-6 text-blue-600 no-underline hover:underline", children: $n4065816788000001 }));
	$root.appendChild($n4065816788000000);
const $n4065816788000003 = document.createElement("h1");
$n4065816788000003.setAttribute("class", "text-3xl font-bold mb-2");
const $n4065816788000004 = document.createTextNode("Post: ");
$n4065816788000003.appendChild($n4065816788000004);
const $n4065816788000005 = document.createTextNode('');
$n4065816788000003.appendChild($n4065816788000005);
	$root.appendChild($n4065816788000003);
const $n4065816788000006 = document.createElement("div");
$n4065816788000006.setAttribute("class", "text-gray-600 leading-relaxed");
const $n4065816788000007 = document.createElement("p");
const $n4065816788000008 = document.createTextNode("This is a dynamic blog post rendered at ");
$n4065816788000007.appendChild($n4065816788000008);
const $n4065816788000009 = document.createElement("code");
$n4065816788000009.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n4065816788000010 = document.createTextNode("/");
$n4065816788000009.appendChild($n4065816788000010);
const $n4065816788000011 = document.createTextNode('');
$n4065816788000009.appendChild($n4065816788000011);
$n4065816788000007.appendChild($n4065816788000009);
const $n4065816788000012 = document.createTextNode(".");
$n4065816788000007.appendChild($n4065816788000012);
$n4065816788000006.appendChild($n4065816788000007);
	$root.appendChild($n4065816788000006);
	effect(() => { const __v = props.params.slug; $n4065816788000005.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.params.slug; $n4065816788000011.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["BlogPost"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n4065816788000013 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n4065816788000015 = (() => { const $f = document.createDocumentFragment();
const $n4065816788000016 = document.createTextNode(" ← Back to blog ");
$f.appendChild($n4065816788000016);
return $f; })();
__hydrate.injectSkipK($n4065816788000013);
let $n4065816788000014 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n4065816788000014 = toDomNode(Link({ "href": "/blog", "class": "inline-block mb-6 text-blue-600 no-underline hover:underline", children: $n4065816788000015 }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n4065816788000013 = 0;
__hydrate.retireDetached();
	if ($mount === null) $mount = $n4065816788000014;
	if ($n4065816788000014 !== $mount && $n4065816788000014.parentNode == null) $mount.appendChild($n4065816788000014);
const $n4065816788000017 = __hydrate.nextElement("h1", 0);
$n4065816788000017.setAttribute("class", "text-3xl font-bold mb-2");
const $n4065816788000018 = document.createTextNode("Post: ");
if ($n4065816788000018.parentNode !== $n4065816788000017) { const __ssr = $n4065816788000017.__vsk_ssrEls || []; if (0 < __ssr.length) $n4065816788000017.insertBefore($n4065816788000018, __ssr[0]); else $n4065816788000017.appendChild($n4065816788000018); }
const $n4065816788000019 = document.createTextNode('');
if ($n4065816788000019.parentNode !== $n4065816788000017) { const __ssr = $n4065816788000017.__vsk_ssrEls || []; if (0 < __ssr.length) $n4065816788000017.insertBefore($n4065816788000019, __ssr[0]); else $n4065816788000017.appendChild($n4065816788000019); }
	if ($mount === null) $mount = $n4065816788000017;
	if ($n4065816788000017 !== $mount && $n4065816788000017.parentNode == null) $mount.appendChild($n4065816788000017);
const $n4065816788000020 = __hydrate.nextElement("div", 0);
$n4065816788000020.setAttribute("class", "text-gray-600 leading-relaxed");
const $n4065816788000021 = __hydrate.subWalker($n4065816788000020);
const $n4065816788000022 = $n4065816788000021.nextElement("p", 0);
const $n4065816788000023 = $n4065816788000021.subWalker($n4065816788000022);
const $n4065816788000024 = document.createTextNode("This is a dynamic blog post rendered at ");
if ($n4065816788000024.parentNode !== $n4065816788000022) { const __ssr = $n4065816788000022.__vsk_ssrEls || []; if (0 < __ssr.length) $n4065816788000022.insertBefore($n4065816788000024, __ssr[0]); else $n4065816788000022.appendChild($n4065816788000024); }
const $n4065816788000025 = $n4065816788000023.nextElement("code", 0);
$n4065816788000025.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n4065816788000026 = document.createTextNode("/");
if ($n4065816788000026.parentNode !== $n4065816788000025) { const __ssr = $n4065816788000025.__vsk_ssrEls || []; if (0 < __ssr.length) $n4065816788000025.insertBefore($n4065816788000026, __ssr[0]); else $n4065816788000025.appendChild($n4065816788000026); }
const $n4065816788000027 = document.createTextNode('');
if ($n4065816788000027.parentNode !== $n4065816788000025) { const __ssr = $n4065816788000025.__vsk_ssrEls || []; if (0 < __ssr.length) $n4065816788000025.insertBefore($n4065816788000027, __ssr[0]); else $n4065816788000025.appendChild($n4065816788000027); }
if ($n4065816788000025.parentNode !== $n4065816788000022) { if (!$n4065816788000022 || $n4065816788000025.parentNode == null || !$n4065816788000022.contains($n4065816788000025)) $n4065816788000022.appendChild($n4065816788000025); }
const $n4065816788000028 = document.createTextNode(".");
if ($n4065816788000028.parentNode !== $n4065816788000022) { const __ssr = $n4065816788000022.__vsk_ssrEls || []; if (1 < __ssr.length) $n4065816788000022.insertBefore($n4065816788000028, __ssr[1]); else $n4065816788000022.appendChild($n4065816788000028); }
if ($n4065816788000022.parentNode !== $n4065816788000020) { if (!$n4065816788000020 || $n4065816788000022.parentNode == null || !$n4065816788000020.contains($n4065816788000022)) $n4065816788000020.appendChild($n4065816788000022); }
	if ($mount === null) $mount = $n4065816788000020;
	if ($n4065816788000020 !== $mount && $n4065816788000020.parentNode == null) $mount.appendChild($n4065816788000020);
	effect(() => { const __v = props.params.slug; $n4065816788000019.data = __v == null ? '' : String(__v); });
	effect(() => { const __v = props.params.slug; $n4065816788000027.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Blog_slug", { get: () => __components["BlogPost"], configurable: true });

Object.defineProperty(__hydrators, "Page_Blog_slug", { get: () => __hydrators["BlogPost"], configurable: true });
})();
