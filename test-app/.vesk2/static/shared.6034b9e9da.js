(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["SharedCounter"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const n = track(props.base || 1);
const $n2503348594000000 = document.createElement("div");
$n2503348594000000.setAttribute("class", "shared-counter-box");
const $n2503348594000001 = document.createElement("p");
$n2503348594000001.setAttribute("class", "shared-counter-label");
const $n2503348594000002 = document.createTextNode("Shared counter says ");
$n2503348594000001.appendChild($n2503348594000002);
const $n2503348594000003 = document.createTextNode('');
$n2503348594000001.appendChild($n2503348594000003);
$n2503348594000000.appendChild($n2503348594000001);
const $n2503348594000004 = document.createElement("button");
const $n2503348594000005 = document.createTextNode(" + ");
$n2503348594000004.appendChild($n2503348594000005);
$n2503348594000004.__evh_click = () => set(n, get(n) + 1);
$n2503348594000004.setAttribute('data-vsk-ev', '');
$n2503348594000000.appendChild($n2503348594000004);
	$root.appendChild($n2503348594000000);
	effect(() => { const __v = get(n); $n2503348594000003.data = __v == null ? '' : String(__v); });
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
__hydrators["SharedCounter"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const n = track(props.base || 1);
let $n2503348594000006 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2503348594000007 = __hydrate.nextElement("div", $n2503348594000006);
$n2503348594000006 = 0;
$n2503348594000007.setAttribute("class", "shared-counter-box");
const $n2503348594000008 = __hydrate.subWalker($n2503348594000007);
const $n2503348594000009 = $n2503348594000008.nextElement("p", 0);
$n2503348594000009.setAttribute("class", "shared-counter-label");
const $n2503348594000010 = document.createTextNode("Shared counter says ");
if ($n2503348594000010.parentNode !== $n2503348594000009) { const __ssr = $n2503348594000009.__vsk_ssrEls || []; if (0 < __ssr.length) $n2503348594000009.insertBefore($n2503348594000010, __ssr[0]); else $n2503348594000009.appendChild($n2503348594000010); }
const $n2503348594000011 = document.createTextNode('');
if ($n2503348594000011.parentNode !== $n2503348594000009) { const __ssr = $n2503348594000009.__vsk_ssrEls || []; if (0 < __ssr.length) $n2503348594000009.insertBefore($n2503348594000011, __ssr[0]); else $n2503348594000009.appendChild($n2503348594000011); }
if ($n2503348594000009.parentNode !== $n2503348594000007) { if (!$n2503348594000007 || $n2503348594000009.parentNode == null || !$n2503348594000007.contains($n2503348594000009)) $n2503348594000007.appendChild($n2503348594000009); }
const $n2503348594000012 = $n2503348594000008.nextElement("button", 0);
const $n2503348594000013 = document.createTextNode(" + ");
if ($n2503348594000013.parentNode !== $n2503348594000012) { const __ssr = $n2503348594000012.__vsk_ssrEls || []; if (0 < __ssr.length) $n2503348594000012.insertBefore($n2503348594000013, __ssr[0]); else $n2503348594000012.appendChild($n2503348594000013); }
$n2503348594000012.__evh_click = () => set(n, get(n) + 1);
$n2503348594000012.setAttribute('data-vsk-ev', '');
if ($n2503348594000012.parentNode !== $n2503348594000007) { if (!$n2503348594000007 || $n2503348594000012.parentNode == null || !$n2503348594000007.contains($n2503348594000012)) $n2503348594000007.appendChild($n2503348594000012); }
	if ($mount === null) $mount = $n2503348594000007;
	if ($n2503348594000007 !== $mount && $n2503348594000007.parentNode == null) $mount.appendChild($n2503348594000007);
	effect(() => { const __v = get(n); $n2503348594000011.data = __v == null ? '' : String(__v); });
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
})();
