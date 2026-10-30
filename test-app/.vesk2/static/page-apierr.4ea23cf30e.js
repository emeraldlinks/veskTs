(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["ApiErr"] = async (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = "ApiErr — awaited failing fetch";
const data = await useFetch('/api/fail');
const $n979939225000000 = document.createElement("h1");
$n979939225000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n979939225000001 = document.createTextNode("ApiErr Demo");
$n979939225000000.appendChild($n979939225000001);
	$root.appendChild($n979939225000000);
const $n979939225000002 = document.createElement("p");
const $n979939225000003 = document.createTextNode("Should never reach here: ");
$n979939225000002.appendChild($n979939225000003);
const $n979939225000004 = document.createTextNode(String((data.error) ?? ''));
$n979939225000002.appendChild($n979939225000004);
	$root.appendChild($n979939225000002);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["ApiErr"] = async (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n979939225000005 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "ApiErr — awaited failing fetch";
const data = await useFetch('/api/fail');
const $n979939225000007 = __hydrate.nextElement("p", $n979939225000005 + 1);
$n979939225000005 = 0;
const $n979939225000008 = document.createTextNode("Should never reach here: ");
if ($n979939225000008.parentNode !== $n979939225000007) { const __ssr = $n979939225000007.__vsk_ssrEls || []; if (0 < __ssr.length) $n979939225000007.insertBefore($n979939225000008, __ssr[0]); else $n979939225000007.appendChild($n979939225000008); }
const $n979939225000009 = document.createTextNode(String((data.error) ?? ''));
if ($n979939225000009.parentNode !== $n979939225000007) { const __ssr = $n979939225000007.__vsk_ssrEls || []; if (0 < __ssr.length) $n979939225000007.insertBefore($n979939225000009, __ssr[0]); else $n979939225000007.appendChild($n979939225000009); }
	if ($mount === null) $mount = $n979939225000007;
	if ($n979939225000007 !== $mount && $n979939225000007.parentNode == null) $mount.appendChild($n979939225000007);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Apierr", { get: () => __components["ApiErr"], configurable: true });

Object.defineProperty(__hydrators, "Page_Apierr", { get: () => __hydrators["ApiErr"], configurable: true });
})();
