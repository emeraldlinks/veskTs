(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["GuardTest"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const open = track(false);
document.title = "GuardTest — bare return guard clause";
const $n422304331000000 = document.createElement("h1");
$n422304331000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n422304331000001 = document.createTextNode("GuardTest");
$n422304331000000.appendChild($n422304331000001);
	$root.appendChild($n422304331000000);
const $n422304331000002 = document.createElement("p");
$n422304331000002.setAttribute("class", "g-hidden");
if (__components["GuardBadge"] == null) throw new Error("Component \"GuardBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n422304331000003 = toDomNode(__components["GuardBadge"]({ "latest": null }));
$n422304331000002.appendChild($n422304331000003);
	$root.appendChild($n422304331000002);
const $n422304331000004 = document.createElement("p");
$n422304331000004.setAttribute("class", "g-shown");
if (__components["GuardBadge"] == null) throw new Error("Component \"GuardBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n422304331000005 = toDomNode(__components["GuardBadge"]({ "latest": { version: '0.2.33' } }));
$n422304331000004.appendChild($n422304331000005);
	$root.appendChild($n422304331000004);
const $n422304331000006 = document.createElement("button");
$n422304331000006.setAttribute("type", "button");
$n422304331000006.setAttribute("id", "icon-btn");
$n422304331000006.setAttribute("class", "btn-icon");
const $n422304331000007 = document.createComment('if');
$n422304331000006.appendChild($n422304331000007);
let $n422304331000009 = [];
const $n422304331000008 = document.createComment('if-end');
const $n422304331000010 = () => {
	const __p = $n422304331000007.parentNode;
	const $n422304331000011 = document.createDocumentFragment();
const $n422304331000012 = document.createElement("span");
$n422304331000012.setAttribute("class", "icon-check");
const $n422304331000013 = document.createTextNode("✓");
$n422304331000012.appendChild($n422304331000013);
	$n422304331000011.appendChild($n422304331000012);
	__p.insertBefore($n422304331000011, $n422304331000008);
};
const $n422304331000014 = () => {
	const __p = $n422304331000007.parentNode;
	const $n422304331000015 = document.createDocumentFragment();
const $n422304331000016 = document.createElement("span");
$n422304331000016.setAttribute("class", "icon-cross");
const $n422304331000017 = document.createTextNode("✗");
$n422304331000016.appendChild($n422304331000017);
	$n422304331000015.appendChild($n422304331000016);
	__p.insertBefore($n422304331000015, $n422304331000008);
};
$n422304331000006.appendChild($n422304331000008);
if (get(open)) { $n422304331000010(); } else { $n422304331000014(); }
$n422304331000006.__evh_click = () => {
	set(open, !get(open));
};
$n422304331000006.setAttribute('data-vsk-ev', '');
	$root.appendChild($n422304331000006);
	{
	    let __iv = get(open);
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(open); return; }
	      const __nv = get(open);
	      if (__nv !== __iv) {
	        for (const e of $n422304331000009) destroy_block(e);
	        $n422304331000009.length = 0;
	        __cleanup($n422304331000007, $n422304331000008);
	        if (__nv) { $n422304331000010(); } else { $n422304331000014(); }
	        __iv = __nv;
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

__components["GuardBadge"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n422304331000018 = document.createComment('if');
$root.appendChild($n422304331000018);
let $n422304331000020 = [];
const $n422304331000019 = document.createComment('if-end');
const $n422304331000021 = () => {
	const __p = $n422304331000018.parentNode;
	const $n422304331000022 = document.createDocumentFragment();
	__p.insertBefore($n422304331000022, $n422304331000019);
};
const $n422304331000023 = () => {
	const __p = $n422304331000018.parentNode;
	const $n422304331000024 = document.createDocumentFragment();
const $n422304331000025 = document.createElement("span");
$n422304331000025.setAttribute("class", "badge-shown");
const $n422304331000026 = document.createTextNode("v");
$n422304331000025.appendChild($n422304331000026);
const $n422304331000027 = document.createTextNode('');
$n422304331000020.push(effect(() => { const __v = props.latest.version; $n422304331000027.data = __v == null ? '' : String(__v); }));
$n422304331000025.appendChild($n422304331000027);
	$n422304331000024.appendChild($n422304331000025);
	__p.insertBefore($n422304331000024, $n422304331000019);
};
$root.appendChild($n422304331000019);
if (props.latest === null) { $n422304331000021(); } else { $n422304331000023(); }
	{
	    let __iv = props.latest === null;
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.latest === null; return; }
	      const __nv = props.latest === null;
	      if (__nv !== __iv) {
	        for (const e of $n422304331000020) destroy_block(e);
	        $n422304331000020.length = 0;
	        __cleanup($n422304331000018, $n422304331000019);
	        if (__nv) { $n422304331000021(); } else { $n422304331000023(); }
	        __iv = __nv;
	      }
	    });
	  }
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["GuardTest"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const open = track(false);
let $n422304331000028 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "GuardTest — bare return guard clause";
const $n422304331000030 = __hydrate.nextElement("p", $n422304331000028 + 1);
$n422304331000028 = 0;
$n422304331000030.setAttribute("class", "g-hidden");
const $n422304331000031 = __hydrate.subWalker($n422304331000030);
if (__hydrators["GuardBadge"] == null) throw new Error("Component \"GuardBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n422304331000032 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n422304331000032 = toDomNode(__hydrators["GuardBadge"]({ "latest": null }, __registry, $n422304331000031)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n422304331000032.parentNode !== $n422304331000030) { if (!$n422304331000030 || $n422304331000032.parentNode == null || !$n422304331000030.contains($n422304331000032)) $n422304331000030.appendChild($n422304331000032); }
	if ($mount === null) $mount = $n422304331000030;
	if ($n422304331000030 !== $mount && $n422304331000030.parentNode == null) $mount.appendChild($n422304331000030);
const $n422304331000033 = __hydrate.nextElement("p", 0);
$n422304331000033.setAttribute("class", "g-shown");
const $n422304331000034 = __hydrate.subWalker($n422304331000033);
if (__hydrators["GuardBadge"] == null) throw new Error("Component \"GuardBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n422304331000035 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n422304331000035 = toDomNode(__hydrators["GuardBadge"]({ "latest": { version: '0.2.33' } }, __registry, $n422304331000034)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n422304331000035.parentNode !== $n422304331000033) { if (!$n422304331000033 || $n422304331000035.parentNode == null || !$n422304331000033.contains($n422304331000035)) $n422304331000033.appendChild($n422304331000035); }
	if ($mount === null) $mount = $n422304331000033;
	if ($n422304331000033 !== $mount && $n422304331000033.parentNode == null) $mount.appendChild($n422304331000033);
const $n422304331000036 = __hydrate.nextElement("button", 0);
$n422304331000036.setAttribute("type", "button");
$n422304331000036.setAttribute("id", "icon-btn");
$n422304331000036.setAttribute("class", "btn-icon");
const $n422304331000037 = __hydrate.subWalker($n422304331000036);
const $n422304331000038 = document.createComment('if');
let $n422304331000040 = [];
const $n422304331000039 = document.createComment('if-end');
const $n422304331000041 = () => {
	const __cl = [];
const $n422304331000043 = $n422304331000037.nextElement("span", 0);
$n422304331000043.setAttribute("class", "icon-check");
const $n422304331000044 = document.createTextNode("✓");
if ($n422304331000044.parentNode !== $n422304331000043) { const __ssr = $n422304331000043.__vsk_ssrEls || []; if (0 < __ssr.length) $n422304331000043.insertBefore($n422304331000044, __ssr[0]); else $n422304331000043.appendChild($n422304331000044); }
	__cl.push($n422304331000043);
	__place($n422304331000038, $n422304331000039, __cl, $n422304331000036);
};
const $n422304331000045 = () => {
	const __cl = [];
const $n422304331000047 = $n422304331000037.nextElement("span", 0);
$n422304331000047.setAttribute("class", "icon-cross");
const $n422304331000048 = document.createTextNode("✗");
if ($n422304331000048.parentNode !== $n422304331000047) { const __ssr = $n422304331000047.__vsk_ssrEls || []; if (0 < __ssr.length) $n422304331000047.insertBefore($n422304331000048, __ssr[0]); else $n422304331000047.appendChild($n422304331000048); }
	__cl.push($n422304331000047);
	__place($n422304331000038, $n422304331000039, __cl, $n422304331000036);
};
if (get(open)) { $n422304331000041(); } else { $n422304331000045(); }
$n422304331000036.__evh_click = () => {
	set(open, !get(open));
};
$n422304331000036.setAttribute('data-vsk-ev', '');
	if ($mount === null) $mount = $n422304331000036;
	if ($n422304331000036 !== $mount && $n422304331000036.parentNode == null) $mount.appendChild($n422304331000036);
	{
	    let __iv = get(open);
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(open); return; }
	      const __nv = get(open);
	      if (__nv !== __iv) {
	        for (const e of $n422304331000040) destroy_block(e);
	        $n422304331000040.length = 0;
	        __cleanup($n422304331000038, $n422304331000039);
	        if (__nv) { $n422304331000041(); } else { $n422304331000045(); }
	        __iv = __nv;
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

__hydrators["GuardBadge"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n422304331000049 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n422304331000050 = document.createComment('if');
let $n422304331000052 = [];
const $n422304331000051 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n422304331000050, $n422304331000049);
	__hydrate.insertBeforeNextClaim($n422304331000051, $n422304331000049);
}
const $n422304331000053 = () => {
	const __cl = [];
	__place($n422304331000050, $n422304331000051, __cl, $root);
};
const $n422304331000055 = () => {
	const __cl = [];
const $n422304331000057 = __hydrate.nextElement("span", $n422304331000049);
$n422304331000049 = 0;
$n422304331000057.setAttribute("class", "badge-shown");
const $n422304331000058 = document.createTextNode("v");
if ($n422304331000058.parentNode !== $n422304331000057) { const __ssr = $n422304331000057.__vsk_ssrEls || []; if (0 < __ssr.length) $n422304331000057.insertBefore($n422304331000058, __ssr[0]); else $n422304331000057.appendChild($n422304331000058); }
const $n422304331000059 = document.createTextNode('');
$n422304331000052.push(effect(() => { const __v = props.latest.version; $n422304331000059.data = __v == null ? '' : String(__v); }));
if ($n422304331000059.parentNode !== $n422304331000057) { const __ssr = $n422304331000057.__vsk_ssrEls || []; if (0 < __ssr.length) $n422304331000057.insertBefore($n422304331000059, __ssr[0]); else $n422304331000057.appendChild($n422304331000059); }
	__cl.push($n422304331000057);
	__place($n422304331000050, $n422304331000051, __cl, $root);
};
if (props.latest === null) { $n422304331000053(); } else { $n422304331000055(); }
	{
	    let __iv = props.latest === null;
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.latest === null; return; }
	      const __nv = props.latest === null;
	      if (__nv !== __iv) {
	        for (const e of $n422304331000052) destroy_block(e);
	        $n422304331000052.length = 0;
	        __cleanup($n422304331000050, $n422304331000051);
	        if (__nv) { $n422304331000053(); } else { $n422304331000055(); }
	        __iv = __nv;
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

Object.defineProperty(__components, "Page_Guardtest", { get: () => __components["GuardTest"], configurable: true });

Object.defineProperty(__hydrators, "Page_Guardtest", { get: () => __hydrators["GuardTest"], configurable: true });
})();
