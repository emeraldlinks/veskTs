(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["Page"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const target = track("ssr");
const $n4015436022000000 = document.createElement("section");
$n4015436022000000.setAttribute("class", "elif-chain");
$n4015436022000000.setAttribute("data-test", "elif");
const $n4015436022000001 = document.createElement("h1");
const $n4015436022000002 = document.createTextNode("Else-if chain hydration");
$n4015436022000001.appendChild($n4015436022000002);
$n4015436022000000.appendChild($n4015436022000001);
const $n4015436022000003 = document.createElement("button");
$n4015436022000003.setAttribute("type", "button");
$n4015436022000003.setAttribute("id", "elif-ssr");
const $n4015436022000004 = document.createTextNode("ssr");
$n4015436022000003.appendChild($n4015436022000004);
$n4015436022000003.__evh_click = () => {
	set(target, "ssr");
};
$n4015436022000003.setAttribute('data-vsk-ev', '');
$n4015436022000000.appendChild($n4015436022000003);
const $n4015436022000005 = document.createElement("button");
$n4015436022000005.setAttribute("type", "button");
$n4015436022000005.setAttribute("id", "elif-web");
const $n4015436022000006 = document.createTextNode("web");
$n4015436022000005.appendChild($n4015436022000006);
$n4015436022000005.__evh_click = () => {
	set(target, "web");
};
$n4015436022000005.setAttribute('data-vsk-ev', '');
$n4015436022000000.appendChild($n4015436022000005);
const $n4015436022000007 = document.createElement("button");
$n4015436022000007.setAttribute("type", "button");
$n4015436022000007.setAttribute("id", "elif-native");
const $n4015436022000008 = document.createTextNode("native");
$n4015436022000007.appendChild($n4015436022000008);
$n4015436022000007.__evh_click = () => {
	set(target, "native");
};
$n4015436022000007.setAttribute('data-vsk-ev', '');
$n4015436022000000.appendChild($n4015436022000007);
const $n4015436022000009 = document.createComment('if');
$n4015436022000000.appendChild($n4015436022000009);
let $n4015436022000011 = [];
const $n4015436022000010 = document.createComment('if-end');
const $n4015436022000012 = () => {
	const __p = $n4015436022000009.parentNode;
	const $n4015436022000013 = document.createDocumentFragment();
const $n4015436022000014 = document.createElement("pre");
$n4015436022000014.setAttribute("id", "elif-out");
const $n4015436022000015 = document.createTextNode("SSR");
$n4015436022000014.appendChild($n4015436022000015);
	$n4015436022000013.appendChild($n4015436022000014);
	__p.insertBefore($n4015436022000013, $n4015436022000010);
};
const $n4015436022000016 = () => {
	const __p = $n4015436022000009.parentNode;
	const $n4015436022000017 = document.createDocumentFragment();
const $n4015436022000018 = document.createComment('if');
$n4015436022000017.appendChild($n4015436022000018);
let $n4015436022000020 = [];
const $n4015436022000019 = document.createComment('if-end');
const $n4015436022000021 = () => {
	const __p = $n4015436022000018.parentNode;
	const $n4015436022000022 = document.createDocumentFragment();
const $n4015436022000023 = document.createElement("pre");
$n4015436022000023.setAttribute("id", "elif-out");
const $n4015436022000024 = document.createTextNode("WEB");
$n4015436022000023.appendChild($n4015436022000024);
	$n4015436022000022.appendChild($n4015436022000023);
	__p.insertBefore($n4015436022000022, $n4015436022000019);
};
const $n4015436022000025 = () => {
	const __p = $n4015436022000018.parentNode;
	const $n4015436022000026 = document.createDocumentFragment();
const $n4015436022000027 = document.createComment('if');
$n4015436022000026.appendChild($n4015436022000027);
let $n4015436022000029 = [];
const $n4015436022000028 = document.createComment('if-end');
const $n4015436022000030 = () => {
	const __p = $n4015436022000027.parentNode;
	const $n4015436022000031 = document.createDocumentFragment();
const $n4015436022000032 = document.createElement("pre");
$n4015436022000032.setAttribute("id", "elif-out");
const $n4015436022000033 = document.createTextNode("NATIVE");
$n4015436022000032.appendChild($n4015436022000033);
	$n4015436022000031.appendChild($n4015436022000032);
	__p.insertBefore($n4015436022000031, $n4015436022000028);
};
$n4015436022000026.appendChild($n4015436022000028);
if (get(target) === "native") { $n4015436022000030(); }
$n4015436022000020.push((() => {
    let __iv = get(target) === "native";
    let __first = true;
    return effect(() => {
      if (__first) { __first = false; __iv = get(target) === "native"; return; }
      const __nv = get(target) === "native";
      if (__nv !== __iv) {
        for (const e of $n4015436022000029) destroy_block(e);
        $n4015436022000029.length = 0;
        __cleanup($n4015436022000027, $n4015436022000028);
        if (__nv) { $n4015436022000030(); }
        __iv = __nv;
      }
    });
  })());
	__p.insertBefore($n4015436022000026, $n4015436022000019);
};
$n4015436022000017.appendChild($n4015436022000019);
if (get(target) === "web") { $n4015436022000021(); } else { $n4015436022000025(); }
$n4015436022000011.push((() => {
    let __iv = get(target) === "web";
    let __first = true;
    return effect(() => {
      if (__first) { __first = false; __iv = get(target) === "web"; return; }
      const __nv = get(target) === "web";
      if (__nv !== __iv) {
        for (const e of $n4015436022000020) destroy_block(e);
        $n4015436022000020.length = 0;
        __cleanup($n4015436022000018, $n4015436022000019);
        if (__nv) { $n4015436022000021(); } else { $n4015436022000025(); }
        __iv = __nv;
      }
    });
  })());
	__p.insertBefore($n4015436022000017, $n4015436022000010);
};
$n4015436022000000.appendChild($n4015436022000010);
if (get(target) === "ssr") { $n4015436022000012(); } else { $n4015436022000016(); }
	$root.appendChild($n4015436022000000);
	{
	    let __iv = get(target) === "ssr";
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(target) === "ssr"; return; }
	      const __nv = get(target) === "ssr";
	      if (__nv !== __iv) {
	        for (const e of $n4015436022000011) destroy_block(e);
	        $n4015436022000011.length = 0;
	        __cleanup($n4015436022000009, $n4015436022000010);
	        if (__nv) { $n4015436022000012(); } else { $n4015436022000016(); }
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
__hydrators["Page"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const target = track("ssr");
let $n4015436022000034 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n4015436022000035 = __hydrate.nextElement("section", $n4015436022000034);
$n4015436022000034 = 0;
$n4015436022000035.setAttribute("class", "elif-chain");
$n4015436022000035.setAttribute("data-test", "elif");
const $n4015436022000036 = __hydrate.subWalker($n4015436022000035);
const $n4015436022000039 = $n4015436022000035.__vsk_ssrEls ? $n4015436022000035.__vsk_ssrEls[0] : (() => {
	const $n4015436022000037 = document.createElement("h1");
	const $n4015436022000038 = document.createTextNode("Else-if chain hydration");
	$n4015436022000037.appendChild($n4015436022000038);
	return $n4015436022000037;
})();
if ($n4015436022000039.parentNode !== $n4015436022000035) { if (!$n4015436022000035 || $n4015436022000039.parentNode == null || !$n4015436022000035.contains($n4015436022000039)) $n4015436022000035.appendChild($n4015436022000039); }
const $n4015436022000040 = $n4015436022000036.nextElement("button", 1);
$n4015436022000040.setAttribute("type", "button");
$n4015436022000040.setAttribute("id", "elif-ssr");
const $n4015436022000041 = document.createTextNode("ssr");
if ($n4015436022000041.parentNode !== $n4015436022000040) { const __ssr = $n4015436022000040.__vsk_ssrEls || []; if (0 < __ssr.length) $n4015436022000040.insertBefore($n4015436022000041, __ssr[0]); else $n4015436022000040.appendChild($n4015436022000041); }
$n4015436022000040.__evh_click = () => {
	set(target, "ssr");
};
$n4015436022000040.setAttribute('data-vsk-ev', '');
if ($n4015436022000040.parentNode !== $n4015436022000035) { if (!$n4015436022000035 || $n4015436022000040.parentNode == null || !$n4015436022000035.contains($n4015436022000040)) $n4015436022000035.appendChild($n4015436022000040); }
const $n4015436022000042 = $n4015436022000036.nextElement("button", 0);
$n4015436022000042.setAttribute("type", "button");
$n4015436022000042.setAttribute("id", "elif-web");
const $n4015436022000043 = document.createTextNode("web");
if ($n4015436022000043.parentNode !== $n4015436022000042) { const __ssr = $n4015436022000042.__vsk_ssrEls || []; if (0 < __ssr.length) $n4015436022000042.insertBefore($n4015436022000043, __ssr[0]); else $n4015436022000042.appendChild($n4015436022000043); }
$n4015436022000042.__evh_click = () => {
	set(target, "web");
};
$n4015436022000042.setAttribute('data-vsk-ev', '');
if ($n4015436022000042.parentNode !== $n4015436022000035) { if (!$n4015436022000035 || $n4015436022000042.parentNode == null || !$n4015436022000035.contains($n4015436022000042)) $n4015436022000035.appendChild($n4015436022000042); }
const $n4015436022000044 = $n4015436022000036.nextElement("button", 0);
$n4015436022000044.setAttribute("type", "button");
$n4015436022000044.setAttribute("id", "elif-native");
const $n4015436022000045 = document.createTextNode("native");
if ($n4015436022000045.parentNode !== $n4015436022000044) { const __ssr = $n4015436022000044.__vsk_ssrEls || []; if (0 < __ssr.length) $n4015436022000044.insertBefore($n4015436022000045, __ssr[0]); else $n4015436022000044.appendChild($n4015436022000045); }
$n4015436022000044.__evh_click = () => {
	set(target, "native");
};
$n4015436022000044.setAttribute('data-vsk-ev', '');
if ($n4015436022000044.parentNode !== $n4015436022000035) { if (!$n4015436022000035 || $n4015436022000044.parentNode == null || !$n4015436022000035.contains($n4015436022000044)) $n4015436022000035.appendChild($n4015436022000044); }
const $n4015436022000046 = document.createComment('if');
let $n4015436022000048 = [];
const $n4015436022000047 = document.createComment('if-end');
const $n4015436022000049 = () => {
	const $n4015436022000050 = [];
const $n4015436022000051 = $n4015436022000036.nextElement("pre", 0);
$n4015436022000051.setAttribute("id", "elif-out");
const $n4015436022000052 = document.createTextNode("SSR");
if ($n4015436022000052.parentNode !== $n4015436022000051) { const __ssr = $n4015436022000051.__vsk_ssrEls || []; if (0 < __ssr.length) $n4015436022000051.insertBefore($n4015436022000052, __ssr[0]); else $n4015436022000051.appendChild($n4015436022000052); }
	$n4015436022000050.push($n4015436022000051);
	__place($n4015436022000046, $n4015436022000047, $n4015436022000050, $n4015436022000035);
};
const $n4015436022000053 = () => {
	const $n4015436022000054 = [];
const $n4015436022000055 = $n4015436022000036.nextElement("pre", 0);
$n4015436022000055.setAttribute("id", "elif-out");
const $n4015436022000056 = document.createTextNode("WEB");
if ($n4015436022000056.parentNode !== $n4015436022000055) { const __ssr = $n4015436022000055.__vsk_ssrEls || []; if (0 < __ssr.length) $n4015436022000055.insertBefore($n4015436022000056, __ssr[0]); else $n4015436022000055.appendChild($n4015436022000056); }
	$n4015436022000054.push($n4015436022000055);
	__place($n4015436022000046, $n4015436022000047, $n4015436022000054, $n4015436022000035);
};
const $n4015436022000057 = () => {
	const $n4015436022000058 = [];
const $n4015436022000059 = $n4015436022000036.nextElement("pre", 0);
$n4015436022000059.setAttribute("id", "elif-out");
const $n4015436022000060 = document.createTextNode("NATIVE");
if ($n4015436022000060.parentNode !== $n4015436022000059) { const __ssr = $n4015436022000059.__vsk_ssrEls || []; if (0 < __ssr.length) $n4015436022000059.insertBefore($n4015436022000060, __ssr[0]); else $n4015436022000059.appendChild($n4015436022000060); }
	$n4015436022000058.push($n4015436022000059);
	__place($n4015436022000046, $n4015436022000047, $n4015436022000058, $n4015436022000035);
};
if (get(target) === "ssr") { $n4015436022000049(); } else if (get(target) === "web") { $n4015436022000053(); } else if (get(target) === "native") { $n4015436022000057(); }
	if ($mount === null) $mount = $n4015436022000035;
	if ($n4015436022000035 !== $mount && $n4015436022000035.parentNode == null) $mount.appendChild($n4015436022000035);
	{
	      let __iv = ((get(target) === "ssr" ? 0 : (get(target) === "web" ? 1 : (get(target) === "native" ? 2 : -1))));
	      let __first = true;
	      effect(() => {
	        if (__first) { __first = false; __iv = ((get(target) === "ssr" ? 0 : (get(target) === "web" ? 1 : (get(target) === "native" ? 2 : -1)))); return; }
	        const __new = ((get(target) === "ssr" ? 0 : (get(target) === "web" ? 1 : (get(target) === "native" ? 2 : -1))));
	        if (__new !== __iv) {
	          for (const e of $n4015436022000048) destroy_block(e);
	          $n4015436022000048.length = 0;
	          __cleanup($n4015436022000046, $n4015436022000047);
	          if (__new === 0) { $n4015436022000049(); } else if (__new === 1) { $n4015436022000053(); } else if (__new === 2) { $n4015436022000057(); }
	          __iv = __new;
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

Object.defineProperty(__components, "Page_Elif", { get: () => __components["Page"], configurable: true });

Object.defineProperty(__hydrators, "Page_Elif", { get: () => __hydrators["Page"], configurable: true });
})();
