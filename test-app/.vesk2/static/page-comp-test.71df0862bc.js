(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["Helper"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const n = track(props.base || 1);
const $n2060004445000000 = document.createElement("div");
$n2060004445000000.setAttribute("class", "helper-box");
const $n2060004445000001 = document.createElement("p");
$n2060004445000001.setAttribute("class", "helper-label");
const $n2060004445000002 = document.createTextNode("Helper says ");
$n2060004445000001.appendChild($n2060004445000002);
const $n2060004445000003 = document.createTextNode('');
$n2060004445000001.appendChild($n2060004445000003);
$n2060004445000000.appendChild($n2060004445000001);
const $n2060004445000004 = document.createElement("button");
const $n2060004445000005 = document.createTextNode(" + ");
$n2060004445000004.appendChild($n2060004445000005);
$n2060004445000004.__evh_click = () => set(n, get(n) + 1);
$n2060004445000004.setAttribute('data-vsk-ev', '');
$n2060004445000000.appendChild($n2060004445000004);
	$root.appendChild($n2060004445000000);
	effect(() => { const __v = get(n); $n2060004445000003.data = __v == null ? '' : String(__v); });
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
__hydrators["Helper"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const n = track(props.base || 1);
let $n2060004445000006 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2060004445000007 = __hydrate.nextElement("div", $n2060004445000006);
$n2060004445000006 = 0;
$n2060004445000007.setAttribute("class", "helper-box");
const $n2060004445000008 = __hydrate.subWalker($n2060004445000007);
const $n2060004445000009 = $n2060004445000008.nextElement("p", 0);
$n2060004445000009.setAttribute("class", "helper-label");
const $n2060004445000010 = document.createTextNode("Helper says ");
if ($n2060004445000010.parentNode !== $n2060004445000009) { const __ssr = $n2060004445000009.__vsk_ssrEls || []; if (0 < __ssr.length) $n2060004445000009.insertBefore($n2060004445000010, __ssr[0]); else $n2060004445000009.appendChild($n2060004445000010); }
const $n2060004445000011 = document.createTextNode('');
if ($n2060004445000011.parentNode !== $n2060004445000009) { const __ssr = $n2060004445000009.__vsk_ssrEls || []; if (0 < __ssr.length) $n2060004445000009.insertBefore($n2060004445000011, __ssr[0]); else $n2060004445000009.appendChild($n2060004445000011); }
if ($n2060004445000009.parentNode !== $n2060004445000007) { if (!$n2060004445000007 || $n2060004445000009.parentNode == null || !$n2060004445000007.contains($n2060004445000009)) $n2060004445000007.appendChild($n2060004445000009); }
const $n2060004445000012 = $n2060004445000008.nextElement("button", 0);
const $n2060004445000013 = document.createTextNode(" + ");
if ($n2060004445000013.parentNode !== $n2060004445000012) { const __ssr = $n2060004445000012.__vsk_ssrEls || []; if (0 < __ssr.length) $n2060004445000012.insertBefore($n2060004445000013, __ssr[0]); else $n2060004445000012.appendChild($n2060004445000013); }
$n2060004445000012.__evh_click = () => set(n, get(n) + 1);
$n2060004445000012.setAttribute('data-vsk-ev', '');
if ($n2060004445000012.parentNode !== $n2060004445000007) { if (!$n2060004445000007 || $n2060004445000012.parentNode == null || !$n2060004445000007.contains($n2060004445000012)) $n2060004445000007.appendChild($n2060004445000012); }
	if ($mount === null) $mount = $n2060004445000007;
	if ($n2060004445000007 !== $mount && $n2060004445000007.parentNode == null) $mount.appendChild($n2060004445000007);
	effect(() => { const __v = get(n); $n2060004445000011.data = __v == null ? '' : String(__v); });
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

{
__components["Badge"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n426729086000000 = document.createElement("span");
$n426729086000000.setAttribute("class", "shared-badge");
const $n426729086000001 = document.createTextNode("Shared Badge");
$n426729086000000.appendChild($n426729086000001);
	$root.appendChild($n426729086000000);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Badge"] = (props, __registry, __hydrate) => { return __hydrate.claimOnly(undefined, (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0)); };
}

{
const PrimBadge = primitive((props) => `<span class="prim-badge">${props.label ?? 'no-label'}</span>`)
const PrimCounter = leaf((props) => {
	const  [local] = track(0)
	return `<div class="prim-counter">
		<span class="prim-count">${local + (props.bump ?? 0)}</span>
		<span class="prim-suffix">${props.suffix ?? ''}</span>
	</div>`
})
const PrimPair = primitive((props) => {
	if (props.n % 2 === 0) { return `<i class="pair-a">a${props.n}</i><b class="pair-b">b${props.n}</b>` }
	return `<i class="pair-a">a${props.n}</i>`
})


__components["PrimBadgeUse"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const bump = track(0);
const pairN = track(0);
const zeroArg = PrimBadge();
const $n3614589817000000 = toDomNode(PrimBadge(reactiveProps({  })));
	$root.appendChild($n3614589817000000);
const $n3614589817000001 = toDomNode(PrimBadge(reactiveProps({ "label": "with-label" })));
	$root.appendChild($n3614589817000001);
const $n3614589817000002 = document.createElement("p");
$n3614589817000002.setAttribute("class", "prim-zeroarg");
const $n3614589817000003 = document.createTextNode("zero-arg:");
$n3614589817000002.appendChild($n3614589817000003);
const $n3614589817000004 = document.createComment('if');
$n3614589817000002.appendChild($n3614589817000004);
let $n3614589817000006 = [];
const $n3614589817000005 = document.createComment('if-end');
const $n3614589817000007 = () => {
	const __p = $n3614589817000004.parentNode;
	const $n3614589817000008 = document.createDocumentFragment();
const $n3614589817000009 = document.createTextNode(String(('ok') ?? ''));
	$n3614589817000008.appendChild($n3614589817000009);
	__p.insertBefore($n3614589817000008, $n3614589817000005);
};
const $n3614589817000010 = () => {
	const __p = $n3614589817000004.parentNode;
	const $n3614589817000011 = document.createDocumentFragment();
const $n3614589817000012 = document.createTextNode(String(('bad') ?? ''));
	$n3614589817000011.appendChild($n3614589817000012);
	__p.insertBefore($n3614589817000011, $n3614589817000005);
};
$n3614589817000002.appendChild($n3614589817000005);
if (zeroArg.includes('no-label')) { $n3614589817000007(); } else { $n3614589817000010(); }
	$root.appendChild($n3614589817000002);
const $n3614589817000013 = document.createElement("button");
$n3614589817000013.setAttribute("class", "prim-inc");
const $n3614589817000014 = document.createTextNode("+1");
$n3614589817000013.appendChild($n3614589817000014);
$n3614589817000013.__evh_click = () => set(bump, get(bump) + 1);
$n3614589817000013.setAttribute('data-vsk-ev', '');
	$root.appendChild($n3614589817000013);
const $n3614589817000015 = toDomNode(PrimCounter(reactiveProps({ "bump": bump, "suffix": "!" })));
const $n3614589817000016 = $n3614589817000015 && $n3614589817000015.nodeType === 11 ? Array.from($n3614589817000015.childNodes) : [$n3614589817000015];
rerenderNode($n3614589817000016, [bump], () => PrimCounter(reactiveProps({ "bump": bump, "suffix": "!" })));
	$root.appendChild($n3614589817000015);
const $n3614589817000017 = document.createElement("button");
$n3614589817000017.setAttribute("class", "pair-inc");
const $n3614589817000018 = document.createTextNode("+1");
$n3614589817000017.appendChild($n3614589817000018);
$n3614589817000017.__evh_click = () => set(pairN, get(pairN) + 1);
$n3614589817000017.setAttribute('data-vsk-ev', '');
	$root.appendChild($n3614589817000017);
const $n3614589817000019 = document.createElement("div");
$n3614589817000019.setAttribute("class", "pair-host");
const $n3614589817000020 = toDomNode(PrimPair(reactiveProps({ "n": pairN })));
const $n3614589817000021 = $n3614589817000020 && $n3614589817000020.nodeType === 11 ? Array.from($n3614589817000020.childNodes) : [$n3614589817000020];
rerenderNode($n3614589817000021, [pairN], () => PrimPair(reactiveProps({ "n": pairN })));
$n3614589817000019.appendChild($n3614589817000020);
	$root.appendChild($n3614589817000019);
	{
	    let __iv = zeroArg.includes('no-label');
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = zeroArg.includes('no-label'); return; }
	      const __nv = zeroArg.includes('no-label');
	      if (__nv !== __iv) {
	        for (const e of $n3614589817000006) destroy_block(e);
	        $n3614589817000006.length = 0;
	        __cleanup($n3614589817000004, $n3614589817000005);
	        if (__nv) { $n3614589817000007(); } else { $n3614589817000010(); }
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
__hydrators["PrimBadgeUse"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const bump = track(0);
const pairN = track(0);
let $n3614589817000022 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const zeroArg = PrimBadge();
__hydrate.injectSkipK($n3614589817000022);
let $n3614589817000023 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3614589817000023 = toDomNode(PrimBadge(reactiveProps({  }), __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n3614589817000023 && $n3614589817000023.parentNode == null) { if ($n3614589817000023.nodeType === 11) { const __cnt = $n3614589817000023.childNodes.length; let __sr = null; for (let __i = 0; __i < __cnt; __i++) { const __c = __hydrate.claimOnly(undefined, $n3614589817000022); if (__c && __c.parentNode) { if (__sr) { __c.remove(); } else { __sr = __c; } } } if (__sr) { const __p = __sr.parentNode; while ($n3614589817000023.firstChild) __p.insertBefore($n3614589817000023.firstChild, __sr); __p.removeChild(__sr); } } else { const __sr = __hydrate.claimOnly(undefined, $n3614589817000022); if (__sr && __sr.parentNode) __sr.parentNode.replaceChild($n3614589817000023, __sr); } }
$n3614589817000022 = 0;
	if ($mount === null) $mount = $n3614589817000023;
	if ($n3614589817000023 !== $mount && $n3614589817000023.parentNode == null) $mount.appendChild($n3614589817000023);
let $n3614589817000024 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3614589817000024 = toDomNode(PrimBadge(reactiveProps({ "label": "with-label" }), __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n3614589817000024 && $n3614589817000024.parentNode == null) { if ($n3614589817000024.nodeType === 11) { const __cnt = $n3614589817000024.childNodes.length; let __sr = null; for (let __i = 0; __i < __cnt; __i++) { const __c = __hydrate.claimOnly(); if (__c && __c.parentNode) { if (__sr) { __c.remove(); } else { __sr = __c; } } } if (__sr) { const __p = __sr.parentNode; while ($n3614589817000024.firstChild) __p.insertBefore($n3614589817000024.firstChild, __sr); __p.removeChild(__sr); } } else { const __sr = __hydrate.claimOnly(); if (__sr && __sr.parentNode) __sr.parentNode.replaceChild($n3614589817000024, __sr); } }
	if ($mount === null) $mount = $n3614589817000024;
	if ($n3614589817000024 !== $mount && $n3614589817000024.parentNode == null) $mount.appendChild($n3614589817000024);
const $n3614589817000025 = __hydrate.nextElement("p", 0);
$n3614589817000025.setAttribute("class", "prim-zeroarg");
const $n3614589817000026 = __hydrate.subWalker($n3614589817000025);
const $n3614589817000027 = document.createTextNode("zero-arg:");
if ($n3614589817000027.parentNode !== $n3614589817000025) { const __ssr = $n3614589817000025.__vsk_ssrEls || []; if (0 < __ssr.length) $n3614589817000025.insertBefore($n3614589817000027, __ssr[0]); else $n3614589817000025.appendChild($n3614589817000027); }
const $n3614589817000028 = document.createComment('if');
let $n3614589817000030 = [];
const $n3614589817000029 = document.createComment('if-end');
const $n3614589817000031 = () => {
	const __cl = [];
const $n3614589817000033 = document.createTextNode(String(('ok') ?? ''));
	__cl.push($n3614589817000033);
	__place($n3614589817000028, $n3614589817000029, __cl, $n3614589817000025);
};
const $n3614589817000034 = () => {
	const __cl = [];
const $n3614589817000036 = document.createTextNode(String(('bad') ?? ''));
	__cl.push($n3614589817000036);
	__place($n3614589817000028, $n3614589817000029, __cl, $n3614589817000025);
};
if (zeroArg.includes('no-label')) { $n3614589817000031(); } else { $n3614589817000034(); }
	if ($mount === null) $mount = $n3614589817000025;
	if ($n3614589817000025 !== $mount && $n3614589817000025.parentNode == null) $mount.appendChild($n3614589817000025);
const $n3614589817000037 = __hydrate.nextElement("button", 0);
$n3614589817000037.setAttribute("class", "prim-inc");
const $n3614589817000038 = document.createTextNode("+1");
if ($n3614589817000038.parentNode !== $n3614589817000037) { const __ssr = $n3614589817000037.__vsk_ssrEls || []; if (0 < __ssr.length) $n3614589817000037.insertBefore($n3614589817000038, __ssr[0]); else $n3614589817000037.appendChild($n3614589817000038); }
$n3614589817000037.__evh_click = () => set(bump, get(bump) + 1);
$n3614589817000037.setAttribute('data-vsk-ev', '');
	if ($mount === null) $mount = $n3614589817000037;
	if ($n3614589817000037 !== $mount && $n3614589817000037.parentNode == null) $mount.appendChild($n3614589817000037);
let $n3614589817000039 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3614589817000039 = toDomNode(PrimCounter(reactiveProps({ "bump": bump, "suffix": "!" }), __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
const $n3614589817000040 = $n3614589817000039 && $n3614589817000039.nodeType === 11 ? Array.from($n3614589817000039.childNodes) : [$n3614589817000039];
if ($n3614589817000039 && $n3614589817000039.parentNode == null) { if ($n3614589817000039.nodeType === 11) { const __cnt = $n3614589817000039.childNodes.length; let __sr = null; for (let __i = 0; __i < __cnt; __i++) { const __c = __hydrate.claimOnly(); if (__c && __c.parentNode) { if (__sr) { __c.remove(); } else { __sr = __c; } } } if (__sr) { const __p = __sr.parentNode; while ($n3614589817000039.firstChild) __p.insertBefore($n3614589817000039.firstChild, __sr); __p.removeChild(__sr); } } else { const __sr = __hydrate.claimOnly(); if (__sr && __sr.parentNode) __sr.parentNode.replaceChild($n3614589817000039, __sr); } }
rerenderNode($n3614589817000040, [bump], () => PrimCounter(reactiveProps({ "bump": bump, "suffix": "!" }), __registry, __hydrate));
	if ($mount === null) $mount = $n3614589817000039;
	if ($n3614589817000039 !== $mount && $n3614589817000039.parentNode == null) $mount.appendChild($n3614589817000039);
const $n3614589817000041 = __hydrate.nextElement("button", 0);
$n3614589817000041.setAttribute("class", "pair-inc");
const $n3614589817000042 = document.createTextNode("+1");
if ($n3614589817000042.parentNode !== $n3614589817000041) { const __ssr = $n3614589817000041.__vsk_ssrEls || []; if (0 < __ssr.length) $n3614589817000041.insertBefore($n3614589817000042, __ssr[0]); else $n3614589817000041.appendChild($n3614589817000042); }
$n3614589817000041.__evh_click = () => set(pairN, get(pairN) + 1);
$n3614589817000041.setAttribute('data-vsk-ev', '');
	if ($mount === null) $mount = $n3614589817000041;
	if ($n3614589817000041 !== $mount && $n3614589817000041.parentNode == null) $mount.appendChild($n3614589817000041);
const $n3614589817000043 = __hydrate.nextElement("div", 0);
$n3614589817000043.setAttribute("class", "pair-host");
const $n3614589817000044 = __hydrate.subWalker($n3614589817000043);
let $n3614589817000045 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3614589817000045 = toDomNode(PrimPair(reactiveProps({ "n": pairN }), __registry, $n3614589817000044)); } finally { if (__hydrate) __hydrate.childFrame--; }
const $n3614589817000046 = $n3614589817000045 && $n3614589817000045.nodeType === 11 ? Array.from($n3614589817000045.childNodes) : [$n3614589817000045];
if ($n3614589817000045 && $n3614589817000045.parentNode == null) { if ($n3614589817000045.nodeType === 11) { const __cnt = $n3614589817000045.childNodes.length; let __sr = null; for (let __i = 0; __i < __cnt; __i++) { const __c = $n3614589817000044.claimOnly(); if (__c && __c.parentNode) { if (__sr) { __c.remove(); } else { __sr = __c; } } } if (__sr) { const __p = __sr.parentNode; while ($n3614589817000045.firstChild) __p.insertBefore($n3614589817000045.firstChild, __sr); __p.removeChild(__sr); } } else { const __sr = $n3614589817000044.claimOnly(); if (__sr && __sr.parentNode) __sr.parentNode.replaceChild($n3614589817000045, __sr); } }
rerenderNode($n3614589817000046, [pairN], () => PrimPair(reactiveProps({ "n": pairN }), __registry, $n3614589817000044));
if ($n3614589817000045.parentNode !== $n3614589817000043) { if (!$n3614589817000043 || $n3614589817000045.parentNode == null || !$n3614589817000043.contains($n3614589817000045)) $n3614589817000043.appendChild($n3614589817000045); }
	if ($mount === null) $mount = $n3614589817000043;
	if ($n3614589817000043 !== $mount && $n3614589817000043.parentNode == null) $mount.appendChild($n3614589817000043);
	{
	    let __iv = zeroArg.includes('no-label');
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = zeroArg.includes('no-label'); return; }
	      const __nv = zeroArg.includes('no-label');
	      if (__nv !== __iv) {
	        for (const e of $n3614589817000030) destroy_block(e);
	        $n3614589817000030.length = 0;
	        __cleanup($n3614589817000028, $n3614589817000029);
	        if (__nv) { $n3614589817000031(); } else { $n3614589817000034(); }
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
}

{
__components["CompTest"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = " CompTest ";
const $n3725557370000000 = document.createElement("h1");
const $n3725557370000001 = document.createTextNode("Component import test");
$n3725557370000000.appendChild($n3725557370000001);
	$root.appendChild($n3725557370000000);
if (__components["Helper"] == null) throw new Error("Component \"Helper\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n3725557370000002 = toDomNode(__components["Helper"]({ "base": 5 }));
	$root.appendChild($n3725557370000002);
if (__components["Helper"] == null) throw new Error("Component \"Helper\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n3725557370000003 = toDomNode(__components["Helper"]({ "base": 7 }));
	$root.appendChild($n3725557370000003);
if (__components["Badge"] == null) throw new Error("Component \"Badge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n3725557370000004 = toDomNode(__components["Badge"]({  }));
	$root.appendChild($n3725557370000004);
if (__components["PrimBadgeUse"] == null) throw new Error("Component \"PrimBadgeUse\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n3725557370000005 = toDomNode(__components["PrimBadgeUse"]({  }));
	$root.appendChild($n3725557370000005);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["CompTest"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n3725557370000006 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = " CompTest ";
if (__hydrators["Helper"] == null) throw new Error("Component \"Helper\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
__hydrate.injectSkipK($n3725557370000006 + 1);
let $n3725557370000008 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3725557370000008 = toDomNode(__hydrators["Helper"]({ "base": 5 }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n3725557370000006 = 0;
	if ($mount === null) $mount = $n3725557370000008;
	if ($n3725557370000008 !== $mount && $n3725557370000008.parentNode == null) $mount.appendChild($n3725557370000008);
if (__hydrators["Helper"] == null) throw new Error("Component \"Helper\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n3725557370000009 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3725557370000009 = toDomNode(__hydrators["Helper"]({ "base": 7 }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
	if ($mount === null) $mount = $n3725557370000009;
	if ($n3725557370000009 !== $mount && $n3725557370000009.parentNode == null) $mount.appendChild($n3725557370000009);
if (__hydrators["Badge"] == null) throw new Error("Component \"Badge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n3725557370000010 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3725557370000010 = toDomNode(__hydrators["Badge"]({  }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
	if ($mount === null) $mount = $n3725557370000010;
	if ($n3725557370000010 !== $mount && $n3725557370000010.parentNode == null) $mount.appendChild($n3725557370000010);
if (__hydrators["PrimBadgeUse"] == null) throw new Error("Component \"PrimBadgeUse\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n3725557370000011 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3725557370000011 = toDomNode(__hydrators["PrimBadgeUse"]({  }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
	if ($mount === null) $mount = $n3725557370000011;
	if ($n3725557370000011 !== $mount && $n3725557370000011.parentNode == null) $mount.appendChild($n3725557370000011);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Comp-test", { get: () => __components["CompTest"], configurable: true });

Object.defineProperty(__hydrators, "Page_Comp-test", { get: () => __hydrators["CompTest"], configurable: true });
})();
