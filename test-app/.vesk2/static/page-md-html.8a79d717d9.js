(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const doc = `<a id="custom-target">d</a>
This is the paragraph you want to jump to. Deep-link to it with
[an anchor link](#custom-target) — the tag above is real HTML rendered
through the allowlist.

Inline **emphasis** stays markdown, and <em>raw emphasis</em> comes from
the allowlisted <em> tag.

Disallowed tags stay visible as text: <div>blocks are not allowed</div>
Scripts never survive: <script>alert('nope')</script>
`


__components["MdHtml"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2058381007000000 = document.createElement("div");
$n2058381007000000.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-white rounded-xl shadow-sm border border-gray-200");
const $n2058381007000001 = document.createElement("h1");
$n2058381007000001.setAttribute("class", "text-2xl font-bold mb-4");
const $n2058381007000002 = document.createTextNode("Md raw-HTML policy");
$n2058381007000001.appendChild($n2058381007000002);
$n2058381007000000.appendChild($n2058381007000001);
const $n2058381007000003 = document.createElement("p");
$n2058381007000003.setAttribute("class", "text-gray-600 mb-6");
const $n2058381007000004 = document.createTextNode(" This page renders with ");
$n2058381007000003.appendChild($n2058381007000004);
const $n2058381007000005 = document.createElement("code");
const $n2058381007000006 = document.createTextNode("md.html = \"allowlist\"");
$n2058381007000005.appendChild($n2058381007000006);
$n2058381007000003.appendChild($n2058381007000005);
const $n2058381007000007 = document.createTextNode(" from ");
$n2058381007000003.appendChild($n2058381007000007);
const $n2058381007000008 = document.createElement("code");
const $n2058381007000009 = document.createTextNode("vesk.config.ts");
$n2058381007000008.appendChild($n2058381007000009);
$n2058381007000003.appendChild($n2058381007000008);
const $n2058381007000010 = document.createTextNode(" (allowing a, em). The custom anchor target and raw tags below are real HTML — everything not allowlisted stays escaped. ");
$n2058381007000003.appendChild($n2058381007000010);
$n2058381007000000.appendChild($n2058381007000003);
const $n2058381007000011 = document.createElement("div");
$n2058381007000011.setAttribute("class", "p-4 bg-gray-50 rounded-lg border border-gray-200");
const $n2058381007000012 = toDomNode(Md({ "content": doc }));
$n2058381007000011.appendChild($n2058381007000012);
$n2058381007000000.appendChild($n2058381007000011);
const $n2058381007000013 = document.createElement("p");
$n2058381007000013.setAttribute("class", "mt-6 text-sm text-gray-500");
const $n2058381007000014 = document.createTextNode(" SPA-navigate to ");
$n2058381007000013.appendChild($n2058381007000014);
const $n2058381007000016 = (() => { const $f = document.createDocumentFragment();
const $n2058381007000017 = document.createTextNode("/async");
$f.appendChild($n2058381007000017);
return $f; })();
const $n2058381007000015 = toDomNode(Link({ "href": "/async", "class": "text-sky-600 underline", children: $n2058381007000016 }));
$n2058381007000013.appendChild($n2058381007000015);
const $n2058381007000018 = document.createTextNode(" and watch the loading bar pinned under the nav — it is driven by the router through loadingStart/loadingFinish and rendered by the LoadingIndicator in the layout. ");
$n2058381007000013.appendChild($n2058381007000018);
$n2058381007000000.appendChild($n2058381007000013);
	$root.appendChild($n2058381007000000);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["MdHtml"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2058381007000019 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2058381007000020 = __hydrate.nextElement("div", $n2058381007000019);
$n2058381007000019 = 0;
$n2058381007000020.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-white rounded-xl shadow-sm border border-gray-200");
const $n2058381007000021 = __hydrate.subWalker($n2058381007000020);
const $n2058381007000024 = $n2058381007000020.__vsk_ssrEls ? $n2058381007000020.__vsk_ssrEls[0] : (() => {
	const $n2058381007000022 = document.createElement("h1");
	$n2058381007000022.setAttribute("class", "text-2xl font-bold mb-4");
	const $n2058381007000023 = document.createTextNode("Md raw-HTML policy");
	$n2058381007000022.appendChild($n2058381007000023);
	return $n2058381007000022;
})();
if ($n2058381007000024.parentNode !== $n2058381007000020) { if (!$n2058381007000020 || $n2058381007000024.parentNode == null || !$n2058381007000020.contains($n2058381007000024)) $n2058381007000020.appendChild($n2058381007000024); }
const $n2058381007000033 = $n2058381007000020.__vsk_ssrEls ? $n2058381007000020.__vsk_ssrEls[1] : (() => {
	const $n2058381007000025 = document.createElement("p");
	$n2058381007000025.setAttribute("class", "text-gray-600 mb-6");
	const $n2058381007000026 = document.createTextNode(" This page renders with ");
	$n2058381007000025.appendChild($n2058381007000026);
	const $n2058381007000027 = document.createElement("code");
	const $n2058381007000028 = document.createTextNode("md.html = \"allowlist\"");
	$n2058381007000027.appendChild($n2058381007000028);
	$n2058381007000025.appendChild($n2058381007000027);
	const $n2058381007000029 = document.createTextNode(" from ");
	$n2058381007000025.appendChild($n2058381007000029);
	const $n2058381007000030 = document.createElement("code");
	const $n2058381007000031 = document.createTextNode("vesk.config.ts");
	$n2058381007000030.appendChild($n2058381007000031);
	$n2058381007000025.appendChild($n2058381007000030);
	const $n2058381007000032 = document.createTextNode(" (allowing a, em). The custom anchor target and raw tags below are real HTML — everything not allowlisted stays escaped. ");
	$n2058381007000025.appendChild($n2058381007000032);
	return $n2058381007000025;
})();
if ($n2058381007000033.parentNode !== $n2058381007000020) { if (!$n2058381007000020 || $n2058381007000033.parentNode == null || !$n2058381007000020.contains($n2058381007000033)) $n2058381007000020.appendChild($n2058381007000033); }
const $n2058381007000034 = $n2058381007000021.nextElement("div", 2);
$n2058381007000034.setAttribute("class", "p-4 bg-gray-50 rounded-lg border border-gray-200");
const $n2058381007000035 = $n2058381007000021.subWalker($n2058381007000034);
let $n2058381007000036 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2058381007000036 = toDomNode(Md({ "content": doc }, __registry, $n2058381007000035)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2058381007000035.retireDetached();
if ($n2058381007000036.parentNode !== $n2058381007000034) { if (!$n2058381007000034 || $n2058381007000036.parentNode == null || !$n2058381007000034.contains($n2058381007000036)) $n2058381007000034.appendChild($n2058381007000036); }
if ($n2058381007000034.parentNode !== $n2058381007000020) { if (!$n2058381007000020 || $n2058381007000034.parentNode == null || !$n2058381007000020.contains($n2058381007000034)) $n2058381007000020.appendChild($n2058381007000034); }
const $n2058381007000037 = $n2058381007000021.nextElement("p", 0);
$n2058381007000037.setAttribute("class", "mt-6 text-sm text-gray-500");
const $n2058381007000038 = $n2058381007000021.subWalker($n2058381007000037);
const $n2058381007000039 = document.createTextNode(" SPA-navigate to ");
if ($n2058381007000039.parentNode !== $n2058381007000037) { const __ssr = $n2058381007000037.__vsk_ssrEls || []; if (0 < __ssr.length) $n2058381007000037.insertBefore($n2058381007000039, __ssr[0]); else $n2058381007000037.appendChild($n2058381007000039); }
const $n2058381007000041 = (() => { const $f = document.createDocumentFragment();
const $n2058381007000042 = document.createTextNode("/async");
$f.appendChild($n2058381007000042);
return $f; })();
let $n2058381007000040 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2058381007000040 = toDomNode(Link({ "href": "/async", "class": "text-sky-600 underline", children: $n2058381007000041 }, __registry, $n2058381007000038)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n2058381007000038.retireDetached();
if ($n2058381007000040.parentNode !== $n2058381007000037) { if (!$n2058381007000037 || $n2058381007000040.parentNode == null || !$n2058381007000037.contains($n2058381007000040)) $n2058381007000037.appendChild($n2058381007000040); }
const $n2058381007000043 = document.createTextNode(" and watch the loading bar pinned under the nav — it is driven by the router through loadingStart/loadingFinish and rendered by the LoadingIndicator in the layout. ");
if ($n2058381007000043.parentNode !== $n2058381007000037) { const __ssr = $n2058381007000037.__vsk_ssrEls || []; if (1 < __ssr.length) $n2058381007000037.insertBefore($n2058381007000043, __ssr[1]); else $n2058381007000037.appendChild($n2058381007000043); }
if ($n2058381007000037.parentNode !== $n2058381007000020) { if (!$n2058381007000020 || $n2058381007000037.parentNode == null || !$n2058381007000020.contains($n2058381007000037)) $n2058381007000020.appendChild($n2058381007000037); }
	if ($mount === null) $mount = $n2058381007000020;
	if ($n2058381007000020 !== $mount && $n2058381007000020.parentNode == null) $mount.appendChild($n2058381007000020);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Md-html", { get: () => __components["MdHtml"], configurable: true });

Object.defineProperty(__hydrators, "Page_Md-html", { get: () => __hydrators["MdHtml"], configurable: true });
})();
