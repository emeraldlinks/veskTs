(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["Statements"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = "Statements — every JS construct";
const items = ['alpha', 'beta', 'gamma'];
const obj = { name: 'Vesk', year: 2026, tags: ['fast', 'reactive'] };
const score = 7;
let n = 0;
const $n2039447598000000 = document.createElement("h1");
$n2039447598000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n2039447598000001 = document.createTextNode("JS Statement Demo");
$n2039447598000000.appendChild($n2039447598000001);
	$root.appendChild($n2039447598000000);
const $n2039447598000002 = document.createElement("h2");
$n2039447598000002.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000003 = document.createTextNode("if / else");
$n2039447598000002.appendChild($n2039447598000003);
	$root.appendChild($n2039447598000002);
const $n2039447598000004 = document.createComment('if');
$root.appendChild($n2039447598000004);
let $n2039447598000006 = [];
const $n2039447598000005 = document.createComment('if-end');
const $n2039447598000007 = () => {
	const __p = $n2039447598000004.parentNode;
	const $n2039447598000008 = document.createDocumentFragment();
const $n2039447598000009 = document.createElement("p");
$n2039447598000009.setAttribute("class", "text-green-600");
const $n2039447598000010 = document.createTextNode("Score ");
$n2039447598000009.appendChild($n2039447598000010);
const $n2039447598000011 = document.createTextNode(String((score) ?? ''));
$n2039447598000009.appendChild($n2039447598000011);
const $n2039447598000012 = document.createTextNode(" is above the threshold");
$n2039447598000009.appendChild($n2039447598000012);
	$n2039447598000008.appendChild($n2039447598000009);
	__p.insertBefore($n2039447598000008, $n2039447598000005);
};
const $n2039447598000013 = () => {
	const __p = $n2039447598000004.parentNode;
	const $n2039447598000014 = document.createDocumentFragment();
const $n2039447598000015 = document.createElement("p");
$n2039447598000015.setAttribute("class", "text-red-600");
const $n2039447598000016 = document.createTextNode("Score ");
$n2039447598000015.appendChild($n2039447598000016);
const $n2039447598000017 = document.createTextNode(String((score) ?? ''));
$n2039447598000015.appendChild($n2039447598000017);
const $n2039447598000018 = document.createTextNode(" is low");
$n2039447598000015.appendChild($n2039447598000018);
	$n2039447598000014.appendChild($n2039447598000015);
	__p.insertBefore($n2039447598000014, $n2039447598000005);
};
$root.appendChild($n2039447598000005);
if (score > 5) { $n2039447598000007(); } else { $n2039447598000013(); }
const $n2039447598000019 = document.createElement("h2");
$n2039447598000019.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000020 = document.createTextNode("ternary");
$n2039447598000019.appendChild($n2039447598000020);
	$root.appendChild($n2039447598000019);
const $n2039447598000021 = document.createElement("p");
const $n2039447598000022 = document.createComment('if');
$n2039447598000021.appendChild($n2039447598000022);
let $n2039447598000024 = [];
const $n2039447598000023 = document.createComment('if-end');
const $n2039447598000025 = () => {
	const __p = $n2039447598000022.parentNode;
	const $n2039447598000026 = document.createDocumentFragment();
const $n2039447598000027 = document.createTextNode(String(('even') ?? ''));
	$n2039447598000026.appendChild($n2039447598000027);
	__p.insertBefore($n2039447598000026, $n2039447598000023);
};
const $n2039447598000028 = () => {
	const __p = $n2039447598000022.parentNode;
	const $n2039447598000029 = document.createDocumentFragment();
const $n2039447598000030 = document.createTextNode(String(('odd') ?? ''));
	$n2039447598000029.appendChild($n2039447598000030);
	__p.insertBefore($n2039447598000029, $n2039447598000023);
};
$n2039447598000021.appendChild($n2039447598000023);
if (score % 2 === 0) { $n2039447598000025(); } else { $n2039447598000028(); }
	$root.appendChild($n2039447598000021);
const $n2039447598000031 = document.createElement("h2");
$n2039447598000031.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000032 = document.createTextNode("switch");
$n2039447598000031.appendChild($n2039447598000032);
	$root.appendChild($n2039447598000031);
const $n2039447598000033 = document.createComment('switch');
$root.appendChild($n2039447598000033);
let $n2039447598000035 = [];
const $n2039447598000034 = document.createComment('switch-end');
const $n2039447598000036 = () => {
	const __p = $n2039447598000033.parentNode;
	const __c = document.createDocumentFragment();
	switch (score) {
	case 1:
const $n2039447598000037 = document.createElement("p");
const $n2039447598000038 = document.createTextNode("One");
$n2039447598000037.appendChild($n2039447598000038);
	__c.appendChild($n2039447598000037);
	break;
	case 7:
const $n2039447598000039 = document.createElement("p");
const $n2039447598000040 = document.createTextNode("Seven");
$n2039447598000039.appendChild($n2039447598000040);
	__c.appendChild($n2039447598000039);
	break;
	default:
const $n2039447598000041 = document.createElement("p");
const $n2039447598000042 = document.createTextNode("Something else");
$n2039447598000041.appendChild($n2039447598000042);
	__c.appendChild($n2039447598000041);
	break;
	}
	__p.insertBefore(__c, $n2039447598000034);
};
$root.appendChild($n2039447598000034);
$n2039447598000036();
const $n2039447598000043 = document.createElement("h2");
$n2039447598000043.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000044 = document.createTextNode("for loop");
$n2039447598000043.appendChild($n2039447598000044);
	$root.appendChild($n2039447598000043);
const $n2039447598000045 = document.createComment('for');
$root.appendChild($n2039447598000045);
let $n2039447598000047 = [];
const $n2039447598000046 = document.createComment('for-end');
const $n2039447598000048 = () => {
	const __p = $n2039447598000045.parentNode;
	const __b = document.createDocumentFragment();
	for (let i = 0; i < 3; i++) {
const $n2039447598000049 = document.createElement("span");
$n2039447598000049.setAttribute("class", "mr-2");
const $n2039447598000050 = document.createTextNode("i=");
$n2039447598000049.appendChild($n2039447598000050);
const $n2039447598000051 = document.createTextNode(String((i) ?? ''));
$n2039447598000049.appendChild($n2039447598000051);
	__b.appendChild($n2039447598000049);
	}
	__p.insertBefore(__b, $n2039447598000046);
};
$root.appendChild($n2039447598000046);
$n2039447598000048();
const $n2039447598000052 = document.createElement("h2");
$n2039447598000052.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000053 = document.createTextNode("for-of (array values)");
$n2039447598000052.appendChild($n2039447598000053);
	$root.appendChild($n2039447598000052);
const $n2039447598000054 = document.createComment('map');
$root.appendChild($n2039447598000054);
let $n2039447598000056 = [];
const $n2039447598000055 = document.createComment('map-end');
const $n2039447598000057 = (item, __e, __r) => {
	__r = __r || $n2039447598000055;
	const __p = $n2039447598000054.parentNode;
	const __it = document.createDocumentFragment();
const $n2039447598000058 = document.createElement("span");
$n2039447598000058.setAttribute("class", "mr-2");
const $n2039447598000059 = document.createTextNode(String((item) ?? ''));
$n2039447598000058.appendChild($n2039447598000059);
	__it.appendChild($n2039447598000058);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$root.appendChild($n2039447598000055);
const $n2039447598000060 = () => { const __l = items; return __l != null && __l.length > 0; };
for (const item of items) {
	$n2039447598000057(item, $n2039447598000056);
}
const $n2039447598000061 = document.createElement("h2");
$n2039447598000061.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000062 = document.createTextNode("for-in (object keys)");
$n2039447598000061.appendChild($n2039447598000062);
	$root.appendChild($n2039447598000061);
const $n2039447598000063 = document.createComment('for');
$root.appendChild($n2039447598000063);
let $n2039447598000065 = [];
const $n2039447598000064 = document.createComment('for-end');
const $n2039447598000066 = () => {
	const __p = $n2039447598000063.parentNode;
	const __b = document.createDocumentFragment();
	for (const key of (Array.isArray(obj) ? obj : (obj == null ? [] : Object.keys(obj)))) {
const $n2039447598000067 = document.createElement("span");
$n2039447598000067.setAttribute("class", "mr-2");
const $n2039447598000068 = document.createTextNode(String((key) ?? ''));
$n2039447598000067.appendChild($n2039447598000068);
const $n2039447598000069 = document.createTextNode(":");
$n2039447598000067.appendChild($n2039447598000069);
const $n2039447598000070 = document.createTextNode(String((obj[key]) ?? ''));
$n2039447598000067.appendChild($n2039447598000070);
	__b.appendChild($n2039447598000067);
	}
	__p.insertBefore(__b, $n2039447598000064);
};
$root.appendChild($n2039447598000064);
$n2039447598000066();
const $n2039447598000071 = document.createElement("h2");
$n2039447598000071.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000072 = document.createTextNode("while");
$n2039447598000071.appendChild($n2039447598000072);
	$root.appendChild($n2039447598000071);
const $n2039447598000073 = document.createComment('while');
$root.appendChild($n2039447598000073);
let $n2039447598000075 = [];
const $n2039447598000074 = document.createComment('while-end');
const $n2039447598000076 = () => {
	const __p = $n2039447598000073.parentNode;
	const __b = document.createDocumentFragment();
	while (n < 3) {
const $n2039447598000077 = document.createElement("span");
$n2039447598000077.setAttribute("class", "mr-2");
const $n2039447598000078 = document.createTextNode(String((n) ?? ''));
$n2039447598000077.appendChild($n2039447598000078);
	__b.appendChild($n2039447598000077);
n = n + 1;
	}
	__p.insertBefore(__b, $n2039447598000074);
};
$root.appendChild($n2039447598000074);
$n2039447598000076();
const $n2039447598000079 = document.createElement("h2");
$n2039447598000079.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000080 = document.createTextNode("do-while");
$n2039447598000079.appendChild($n2039447598000080);
	$root.appendChild($n2039447598000079);
const $n2039447598000081 = document.createComment('while');
$root.appendChild($n2039447598000081);
let $n2039447598000083 = [];
const $n2039447598000082 = document.createComment('while-end');
const $n2039447598000084 = () => {
	const __p = $n2039447598000081.parentNode;
	const __b = document.createDocumentFragment();
	do {
const $n2039447598000085 = document.createElement("span");
$n2039447598000085.setAttribute("class", "mr-2");
const $n2039447598000086 = document.createTextNode(String((n) ?? ''));
$n2039447598000085.appendChild($n2039447598000086);
	__b.appendChild($n2039447598000085);
n = n + 1;
	} while (n < 5);
	__p.insertBefore(__b, $n2039447598000082);
};
$root.appendChild($n2039447598000082);
$n2039447598000084();
const $n2039447598000087 = document.createElement("h2");
$n2039447598000087.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000088 = document.createTextNode("try / catch / throw");
$n2039447598000087.appendChild($n2039447598000088);
	$root.appendChild($n2039447598000087);
const $n2039447598000089 = document.createComment('try');
$root.appendChild($n2039447598000089);
let $n2039447598000091 = [];
const $n2039447598000090 = document.createComment('try-end');
const $n2039447598000092 = () => {
	const __p = $n2039447598000089.parentNode;
throw new Error('Boom!');
};
const $n2039447598000093 = (e) => {
	const __p = $n2039447598000089.parentNode;
const $n2039447598000094 = document.createElement("p");
$n2039447598000094.setAttribute("class", "text-red-600");
const $n2039447598000095 = document.createTextNode("Caught: ");
$n2039447598000094.appendChild($n2039447598000095);
const $n2039447598000096 = document.createTextNode(String((e.message) ?? ''));
$n2039447598000094.appendChild($n2039447598000096);
	__p.insertBefore($n2039447598000094, $n2039447598000090);
};
$root.appendChild($n2039447598000090);
try { $n2039447598000092(); } catch(e) { $n2039447598000093(e); }
const $n2039447598000097 = () => {
	const __p = $n2039447598000089.parentNode;
throw new Error('Boom!');
};
const $n2039447598000098 = (e) => {
	const __p = $n2039447598000089.parentNode;
const $n2039447598000099 = document.createElement("p");
$n2039447598000099.setAttribute("class", "text-red-600");
const $n2039447598000100 = document.createTextNode("Caught: ");
$n2039447598000099.appendChild($n2039447598000100);
const $n2039447598000101 = document.createTextNode(String((e.message) ?? ''));
$n2039447598000099.appendChild($n2039447598000101);
	__p.insertBefore($n2039447598000099, $n2039447598000090);
};
const $n2039447598000102 = document.createElement("h2");
$n2039447598000102.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000103 = document.createTextNode("labeled block");
$n2039447598000102.appendChild($n2039447598000103);
	$root.appendChild($n2039447598000102);
const $n2039447598000104 = document.createElement("p");
$n2039447598000104.setAttribute("class", "text-gray-500");
const $n2039447598000105 = document.createTextNode("This whole paragraph lives inside a labeled block.");
$n2039447598000104.appendChild($n2039447598000105);
	$root.appendChild($n2039447598000104);
const $n2039447598000106 = document.createElement("h2");
$n2039447598000106.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000107 = document.createTextNode("guard clause (bare return)");
$n2039447598000106.appendChild($n2039447598000107);
	$root.appendChild($n2039447598000106);
const $n2039447598000108 = document.createElement("p");
$n2039447598000108.setAttribute("class", "guarded-hidden");
if (__components["StatementGuardBadge"] == null) throw new Error("Component \"StatementGuardBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2039447598000109 = toDomNode(__components["StatementGuardBadge"]({ "latest": null }));
$n2039447598000108.appendChild($n2039447598000109);
	$root.appendChild($n2039447598000108);
const $n2039447598000110 = document.createElement("p");
$n2039447598000110.setAttribute("class", "guarded-shown");
if (__components["StatementGuardBadge"] == null) throw new Error("Component \"StatementGuardBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
const $n2039447598000111 = toDomNode(__components["StatementGuardBadge"]({ "latest": { version: '0.2.33' } }));
$n2039447598000110.appendChild($n2039447598000111);
	$root.appendChild($n2039447598000110);
const $n2039447598000112 = document.createElement("h2");
$n2039447598000112.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n2039447598000113 = document.createTextNode("runtime statements");
$n2039447598000112.appendChild($n2039447598000113);
	$root.appendChild($n2039447598000112);
const total = items.length * 2;
const $n2039447598000114 = document.createElement("p");
const $n2039447598000115 = document.createTextNode("items.length * 2 = ");
$n2039447598000114.appendChild($n2039447598000115);
const $n2039447598000116 = document.createTextNode(String((total) ?? ''));
$n2039447598000114.appendChild($n2039447598000116);
	$root.appendChild($n2039447598000114);
	{
	  let __busy = false;
	  let __iv = (score);
	  let __first = true;
	  effect(() => {
	    if (__first) { __first = false; __iv = (score); return; }
	    if (__busy) return;
	    const __nv = (score);
	    if (__nv !== __iv) {
	      for (const e of $n2039447598000035) destroy_block(e);
	      $n2039447598000035.length = 0;
	      __cleanup($n2039447598000033, $n2039447598000034);
	      __busy = true;
	      $n2039447598000036();
	      __busy = false;
	      __iv = (score);
	    }
	  });
	}
	{
	  let __busy = false;
	  let __iv = (n < 3);
	  let __first = true;
	  effect(() => {
	    if (__first) { __first = false; __iv = (n < 3); return; }
	    if (__busy) return;
	    const __nv = (n < 3);
	    if (__nv !== __iv) {
	      for (const e of $n2039447598000075) destroy_block(e);
	      $n2039447598000075.length = 0;
	      __cleanup($n2039447598000073, $n2039447598000074);
	      __busy = true;
	      $n2039447598000076();
	      __busy = false;
	      __iv = (n < 3);
	    }
	  });
	}
	{
	  let __busy = false;
	  let __iv = (n < 5);
	  let __first = true;
	  effect(() => {
	    if (__first) { __first = false; __iv = (n < 5); return; }
	    if (__busy) return;
	    const __nv = (n < 5);
	    if (__nv !== __iv) {
	      for (const e of $n2039447598000083) destroy_block(e);
	      $n2039447598000083.length = 0;
	      __cleanup($n2039447598000081, $n2039447598000082);
	      __busy = true;
	      $n2039447598000084();
	      __busy = false;
	      __iv = (n < 5);
	    }
	  });
	}
	{
	    effect(() => {
	      for (const e of $n2039447598000091) destroy_block(e);
	      $n2039447598000091.length = 0;
	      __cleanup($n2039447598000089, $n2039447598000090);
	      try { $n2039447598000097(); } catch(e) { $n2039447598000098(e); }
	    });
	  }
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["StatementGuardBadge"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n2039447598000117 = document.createComment('if');
$root.appendChild($n2039447598000117);
let $n2039447598000119 = [];
const $n2039447598000118 = document.createComment('if-end');
const $n2039447598000120 = () => {
	const __p = $n2039447598000117.parentNode;
	const $n2039447598000121 = document.createDocumentFragment();
	__p.insertBefore($n2039447598000121, $n2039447598000118);
};
const $n2039447598000122 = () => {
	const __p = $n2039447598000117.parentNode;
	const $n2039447598000123 = document.createDocumentFragment();
const $n2039447598000124 = document.createElement("span");
$n2039447598000124.setAttribute("class", "badge-shown");
const $n2039447598000125 = document.createTextNode("v");
$n2039447598000124.appendChild($n2039447598000125);
const $n2039447598000126 = document.createTextNode('');
$n2039447598000119.push(effect(() => { const __v = props.latest.version; $n2039447598000126.data = __v == null ? '' : String(__v); }));
$n2039447598000124.appendChild($n2039447598000126);
	$n2039447598000123.appendChild($n2039447598000124);
	__p.insertBefore($n2039447598000123, $n2039447598000118);
};
$root.appendChild($n2039447598000118);
if (props.latest === null) { $n2039447598000120(); } else { $n2039447598000122(); }
	{
	    let __iv = props.latest === null;
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.latest === null; return; }
	      const __nv = props.latest === null;
	      if (__nv !== __iv) {
	        for (const e of $n2039447598000119) destroy_block(e);
	        $n2039447598000119.length = 0;
	        __cleanup($n2039447598000117, $n2039447598000118);
	        if (__nv) { $n2039447598000120(); } else { $n2039447598000122(); }
	        __iv = __nv;
	      }
	    });
	  }
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Statements"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2039447598000127 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Statements — every JS construct";
const items = ['alpha', 'beta', 'gamma'];
const obj = { name: 'Vesk', year: 2026, tags: ['fast', 'reactive'] };
const score = 7;
let n = 0;
let $n2039447598000130 = 2; // first-claim budget: region SSR sits 2 slot(s) past the walker cursor
const $n2039447598000131 = document.createComment('if');
let $n2039447598000133 = [];
const $n2039447598000132 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2039447598000131, $n2039447598000130);
	__hydrate.insertBeforeNextClaim($n2039447598000132, $n2039447598000130);
}
const $n2039447598000134 = () => {
	const __cl = [];
const $n2039447598000136 = __hydrate.nextElement("p", $n2039447598000130);
$n2039447598000130 = 0;
$n2039447598000136.setAttribute("class", "text-green-600");
const $n2039447598000137 = document.createTextNode("Score ");
if ($n2039447598000137.parentNode !== $n2039447598000136) { const __ssr = $n2039447598000136.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000136.insertBefore($n2039447598000137, __ssr[0]); else $n2039447598000136.appendChild($n2039447598000137); }
const $n2039447598000138 = document.createTextNode(String((score) ?? ''));
if ($n2039447598000138.parentNode !== $n2039447598000136) { const __ssr = $n2039447598000136.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000136.insertBefore($n2039447598000138, __ssr[0]); else $n2039447598000136.appendChild($n2039447598000138); }
const $n2039447598000139 = document.createTextNode(" is above the threshold");
if ($n2039447598000139.parentNode !== $n2039447598000136) { const __ssr = $n2039447598000136.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000136.insertBefore($n2039447598000139, __ssr[0]); else $n2039447598000136.appendChild($n2039447598000139); }
	__cl.push($n2039447598000136);
	__place($n2039447598000131, $n2039447598000132, __cl, $root);
};
const $n2039447598000140 = () => {
	const __cl = [];
const $n2039447598000142 = __hydrate.nextElement("p", $n2039447598000130);
$n2039447598000130 = 0;
$n2039447598000142.setAttribute("class", "text-red-600");
const $n2039447598000143 = document.createTextNode("Score ");
if ($n2039447598000143.parentNode !== $n2039447598000142) { const __ssr = $n2039447598000142.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000142.insertBefore($n2039447598000143, __ssr[0]); else $n2039447598000142.appendChild($n2039447598000143); }
const $n2039447598000144 = document.createTextNode(String((score) ?? ''));
if ($n2039447598000144.parentNode !== $n2039447598000142) { const __ssr = $n2039447598000142.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000142.insertBefore($n2039447598000144, __ssr[0]); else $n2039447598000142.appendChild($n2039447598000144); }
const $n2039447598000145 = document.createTextNode(" is low");
if ($n2039447598000145.parentNode !== $n2039447598000142) { const __ssr = $n2039447598000142.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000142.insertBefore($n2039447598000145, __ssr[0]); else $n2039447598000142.appendChild($n2039447598000145); }
	__cl.push($n2039447598000142);
	__place($n2039447598000131, $n2039447598000132, __cl, $root);
};
if (score > 5) { $n2039447598000134(); } else { $n2039447598000140(); }
const $n2039447598000147 = __hydrate.nextElement("p", 1);
const $n2039447598000148 = __hydrate.subWalker($n2039447598000147);
const $n2039447598000149 = document.createComment('if');
let $n2039447598000151 = [];
const $n2039447598000150 = document.createComment('if-end');
const $n2039447598000152 = () => {
	const __cl = [];
const $n2039447598000154 = document.createTextNode(String(('even') ?? ''));
	__cl.push($n2039447598000154);
	__place($n2039447598000149, $n2039447598000150, __cl, $n2039447598000147);
};
const $n2039447598000155 = () => {
	const __cl = [];
const $n2039447598000157 = document.createTextNode(String(('odd') ?? ''));
	__cl.push($n2039447598000157);
	__place($n2039447598000149, $n2039447598000150, __cl, $n2039447598000147);
};
if (score % 2 === 0) { $n2039447598000152(); } else { $n2039447598000155(); }
	if ($mount === null) $mount = $n2039447598000147;
	if ($n2039447598000147 !== $mount && $n2039447598000147.parentNode == null) $mount.appendChild($n2039447598000147);
let $n2039447598000162 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n2039447598000159 = document.createComment('switch');
let $n2039447598000161 = [];
const $n2039447598000160 = document.createComment('switch-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2039447598000159, $n2039447598000162);
	__hydrate.insertBeforeNextClaim($n2039447598000160, $n2039447598000162);
}
const $n2039447598000163 = () => {
	const __cl = [];
	switch (score) {
	case 1:
	break;
	case 7:
	break;
	default:
	break;
	}
	__place($n2039447598000159, $n2039447598000160, __cl, $root);
};
$n2039447598000163();
let $n2039447598000171 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n2039447598000168 = document.createComment('for');
let $n2039447598000170 = [];
const $n2039447598000169 = document.createComment('for-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2039447598000168, $n2039447598000171);
	__hydrate.insertBeforeNextClaim($n2039447598000169, $n2039447598000171);
}
const $n2039447598000172 = () => {
	const __cl = [];
	for (let i = 0; i < 3; i++) {
const $n2039447598000173 = __hydrate.nextElement("span", $n2039447598000171);
$n2039447598000171 = 0;
$n2039447598000173.setAttribute("class", "mr-2");
const $n2039447598000174 = document.createTextNode("i=");
if ($n2039447598000174.parentNode !== $n2039447598000173) { const __ssr = $n2039447598000173.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000173.insertBefore($n2039447598000174, __ssr[0]); else $n2039447598000173.appendChild($n2039447598000174); }
const $n2039447598000175 = document.createTextNode(String((i) ?? ''));
if ($n2039447598000175.parentNode !== $n2039447598000173) { const __ssr = $n2039447598000173.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000173.insertBefore($n2039447598000175, __ssr[0]); else $n2039447598000173.appendChild($n2039447598000175); }
	__cl.push($n2039447598000173);
	}
	__place($n2039447598000168, $n2039447598000169, __cl, $root);
};
$n2039447598000172();
let $n2039447598000180 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n2039447598000177 = document.createComment('map');
let $n2039447598000179 = [];
const $n2039447598000178 = document.createComment('map-end');
const $n2039447598000181 = (item, __e, __r, __cl) => {
	__r = __r || $n2039447598000178;
	const __p = $n2039447598000177.parentNode;
const $n2039447598000182 = __hydrate.nextElement("span", $n2039447598000180);
$n2039447598000180 = 0;
$n2039447598000182.setAttribute("class", "mr-2");
const $n2039447598000183 = document.createTextNode(String((item) ?? ''));
if ($n2039447598000183.parentNode !== $n2039447598000182) { const __ssr = $n2039447598000182.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000182.insertBefore($n2039447598000183, __ssr[0]); else $n2039447598000182.appendChild($n2039447598000183); }
	if (__cl) __cl.push($n2039447598000182); else __p.insertBefore($n2039447598000182, __r);
};
const $n2039447598000184 = () => { const __l = items; return __l != null && __l.length > 0; };
const $n2039447598000185 = [];
for (const item of items) {
	$n2039447598000181(item, $n2039447598000179, null, $n2039447598000185);
}
__place($n2039447598000177, $n2039447598000178, $n2039447598000185, $root);
let $n2039447598000190 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n2039447598000187 = document.createComment('for');
let $n2039447598000189 = [];
const $n2039447598000188 = document.createComment('for-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2039447598000187, $n2039447598000190);
	__hydrate.insertBeforeNextClaim($n2039447598000188, $n2039447598000190);
}
const $n2039447598000191 = () => {
	const __cl = [];
	for (const key of (Array.isArray(obj) ? obj : (obj == null ? [] : Object.keys(obj)))) {
const $n2039447598000192 = __hydrate.nextElement("span", $n2039447598000190);
$n2039447598000190 = 0;
$n2039447598000192.setAttribute("class", "mr-2");
const $n2039447598000193 = document.createTextNode(String((key) ?? ''));
if ($n2039447598000193.parentNode !== $n2039447598000192) { const __ssr = $n2039447598000192.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000192.insertBefore($n2039447598000193, __ssr[0]); else $n2039447598000192.appendChild($n2039447598000193); }
const $n2039447598000194 = document.createTextNode(":");
if ($n2039447598000194.parentNode !== $n2039447598000192) { const __ssr = $n2039447598000192.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000192.insertBefore($n2039447598000194, __ssr[0]); else $n2039447598000192.appendChild($n2039447598000194); }
const $n2039447598000195 = document.createTextNode(String((obj[key]) ?? ''));
if ($n2039447598000195.parentNode !== $n2039447598000192) { const __ssr = $n2039447598000192.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000192.insertBefore($n2039447598000195, __ssr[0]); else $n2039447598000192.appendChild($n2039447598000195); }
	__cl.push($n2039447598000192);
	}
	__place($n2039447598000187, $n2039447598000188, __cl, $root);
};
$n2039447598000191();
let $n2039447598000200 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n2039447598000197 = document.createComment('while');
let $n2039447598000199 = [];
const $n2039447598000198 = document.createComment('while-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2039447598000197, $n2039447598000200);
	__hydrate.insertBeforeNextClaim($n2039447598000198, $n2039447598000200);
}
const $n2039447598000201 = () => {
	const __cl = [];
	while (n < 3) {
const $n2039447598000202 = __hydrate.nextElement("span", $n2039447598000200);
$n2039447598000200 = 0;
$n2039447598000202.setAttribute("class", "mr-2");
const $n2039447598000203 = document.createTextNode(String((n) ?? ''));
if ($n2039447598000203.parentNode !== $n2039447598000202) { const __ssr = $n2039447598000202.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000202.insertBefore($n2039447598000203, __ssr[0]); else $n2039447598000202.appendChild($n2039447598000203); }
	__cl.push($n2039447598000202);
n = n + 1;
	}
	__place($n2039447598000197, $n2039447598000198, __cl, $root);
};
$n2039447598000201();
let $n2039447598000208 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n2039447598000205 = document.createComment('while');
let $n2039447598000207 = [];
const $n2039447598000206 = document.createComment('while-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2039447598000205, $n2039447598000208);
	__hydrate.insertBeforeNextClaim($n2039447598000206, $n2039447598000208);
}
const $n2039447598000209 = () => {
	const __cl = [];
	do {
const $n2039447598000210 = __hydrate.nextElement("span", $n2039447598000208);
$n2039447598000208 = 0;
$n2039447598000210.setAttribute("class", "mr-2");
const $n2039447598000211 = document.createTextNode(String((n) ?? ''));
if ($n2039447598000211.parentNode !== $n2039447598000210) { const __ssr = $n2039447598000210.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000210.insertBefore($n2039447598000211, __ssr[0]); else $n2039447598000210.appendChild($n2039447598000211); }
	__cl.push($n2039447598000210);
n = n + 1;
	} while (n < 5);
	__place($n2039447598000205, $n2039447598000206, __cl, $root);
};
$n2039447598000209();
let $n2039447598000216 = 1; // first-claim budget: region SSR sits 1 slot(s) past the walker cursor
const $n2039447598000213 = document.createComment('try');
let $n2039447598000215 = [];
const $n2039447598000214 = document.createComment('try-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2039447598000213, $n2039447598000216);
	__hydrate.insertBeforeNextClaim($n2039447598000214, $n2039447598000216);
}
const $n2039447598000217 = () => {
	const __p = $n2039447598000213.parentNode;
	const __cl = [];
throw new Error('Boom!');
	__place($n2039447598000213, $n2039447598000214, __cl, $root);
};
const $n2039447598000218 = (e) => {
	const __p = $n2039447598000213.parentNode;
	const __cl = [];
const $n2039447598000219 = __hydrate.nextElement("p", $n2039447598000216);
$n2039447598000216 = 0;
$n2039447598000219.setAttribute("class", "text-red-600");
const $n2039447598000220 = document.createTextNode("Caught: ");
if ($n2039447598000220.parentNode !== $n2039447598000219) { const __ssr = $n2039447598000219.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000219.insertBefore($n2039447598000220, __ssr[0]); else $n2039447598000219.appendChild($n2039447598000220); }
const $n2039447598000221 = document.createTextNode(String((e.message) ?? ''));
if ($n2039447598000221.parentNode !== $n2039447598000219) { const __ssr = $n2039447598000219.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000219.insertBefore($n2039447598000221, __ssr[0]); else $n2039447598000219.appendChild($n2039447598000221); }
	__cl.push($n2039447598000219);
	__place($n2039447598000213, $n2039447598000214, __cl, $root);
};
try { $n2039447598000217(); } catch(e) { $n2039447598000218(e); }
const $n2039447598000222 = () => {
	const __p = $n2039447598000213.parentNode;
throw new Error('Boom!');
};
const $n2039447598000223 = (e) => {
	const __p = $n2039447598000213.parentNode;
const $n2039447598000224 = document.createElement("p");
$n2039447598000224.setAttribute("class", "text-red-600");
const $n2039447598000225 = document.createTextNode("Caught: ");
$n2039447598000224.appendChild($n2039447598000225);
const $n2039447598000226 = document.createTextNode(String((e.message) ?? ''));
$n2039447598000224.appendChild($n2039447598000226);
	__p.insertBefore($n2039447598000224, $n2039447598000214);
};
const $n2039447598000230 = __hydrate.nextElement("p", 3);
$n2039447598000230.setAttribute("class", "guarded-hidden");
const $n2039447598000231 = __hydrate.subWalker($n2039447598000230);
if (__hydrators["StatementGuardBadge"] == null) throw new Error("Component \"StatementGuardBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n2039447598000232 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2039447598000232 = toDomNode(__hydrators["StatementGuardBadge"]({ "latest": null }, __registry, $n2039447598000231)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n2039447598000232.parentNode !== $n2039447598000230) { if (!$n2039447598000230 || $n2039447598000232.parentNode == null || !$n2039447598000230.contains($n2039447598000232)) $n2039447598000230.appendChild($n2039447598000232); }
	if ($mount === null) $mount = $n2039447598000230;
	if ($n2039447598000230 !== $mount && $n2039447598000230.parentNode == null) $mount.appendChild($n2039447598000230);
const $n2039447598000233 = __hydrate.nextElement("p", 0);
$n2039447598000233.setAttribute("class", "guarded-shown");
const $n2039447598000234 = __hydrate.subWalker($n2039447598000233);
if (__hydrators["StatementGuardBadge"] == null) throw new Error("Component \"StatementGuardBadge\" was not found while rendering. Declare it with the `component` keyword, import it, or register it in the component registry.");
let $n2039447598000235 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n2039447598000235 = toDomNode(__hydrators["StatementGuardBadge"]({ "latest": { version: '0.2.33' } }, __registry, $n2039447598000234)); } finally { if (__hydrate) __hydrate.childFrame--; }
if ($n2039447598000235.parentNode !== $n2039447598000233) { if (!$n2039447598000233 || $n2039447598000235.parentNode == null || !$n2039447598000233.contains($n2039447598000235)) $n2039447598000233.appendChild($n2039447598000235); }
	if ($mount === null) $mount = $n2039447598000233;
	if ($n2039447598000233 !== $mount && $n2039447598000233.parentNode == null) $mount.appendChild($n2039447598000233);
const total = items.length * 2;
const $n2039447598000237 = __hydrate.nextElement("p", 1);
const $n2039447598000238 = document.createTextNode("items.length * 2 = ");
if ($n2039447598000238.parentNode !== $n2039447598000237) { const __ssr = $n2039447598000237.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000237.insertBefore($n2039447598000238, __ssr[0]); else $n2039447598000237.appendChild($n2039447598000238); }
const $n2039447598000239 = document.createTextNode(String((total) ?? ''));
if ($n2039447598000239.parentNode !== $n2039447598000237) { const __ssr = $n2039447598000237.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000237.insertBefore($n2039447598000239, __ssr[0]); else $n2039447598000237.appendChild($n2039447598000239); }
	if ($mount === null) $mount = $n2039447598000237;
	if ($n2039447598000237 !== $mount && $n2039447598000237.parentNode == null) $mount.appendChild($n2039447598000237);
	{
	  let __busy = false;
	  let __iv = (score);
	  let __first = true;
	  effect(() => {
	    if (__first) { __first = false; __iv = (score); return; }
	    if (__busy) return;
	    const __nv = (score);
	    if (__nv !== __iv) {
	      for (const e of $n2039447598000161) destroy_block(e);
	      $n2039447598000161.length = 0;
	      __cleanup($n2039447598000159, $n2039447598000160);
	      __busy = true;
	      $n2039447598000163();
	      __busy = false;
	      __iv = (score);
	    }
	  });
	}
	{
	  let __busy = false;
	  let __iv = (n < 3);
	  let __first = true;
	  effect(() => {
	    if (__first) { __first = false; __iv = (n < 3); return; }
	    if (__busy) return;
	    const __nv = (n < 3);
	    if (__nv !== __iv) {
	      for (const e of $n2039447598000199) destroy_block(e);
	      $n2039447598000199.length = 0;
	      __cleanup($n2039447598000197, $n2039447598000198);
	      __busy = true;
	      $n2039447598000201();
	      __busy = false;
	      __iv = (n < 3);
	    }
	  });
	}
	{
	  let __busy = false;
	  let __iv = (n < 5);
	  let __first = true;
	  effect(() => {
	    if (__first) { __first = false; __iv = (n < 5); return; }
	    if (__busy) return;
	    const __nv = (n < 5);
	    if (__nv !== __iv) {
	      for (const e of $n2039447598000207) destroy_block(e);
	      $n2039447598000207.length = 0;
	      __cleanup($n2039447598000205, $n2039447598000206);
	      __busy = true;
	      $n2039447598000209();
	      __busy = false;
	      __iv = (n < 5);
	    }
	  });
	}
	{
	    effect(() => {
	      for (const e of $n2039447598000215) destroy_block(e);
	      $n2039447598000215.length = 0;
	      __cleanup($n2039447598000213, $n2039447598000214);
	      try { $n2039447598000222(); } catch(e) { $n2039447598000223(e); }
	    });
	  }
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["StatementGuardBadge"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n2039447598000240 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n2039447598000241 = document.createComment('if');
let $n2039447598000243 = [];
const $n2039447598000242 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n2039447598000241, $n2039447598000240);
	__hydrate.insertBeforeNextClaim($n2039447598000242, $n2039447598000240);
}
const $n2039447598000244 = () => {
	const __cl = [];
	__place($n2039447598000241, $n2039447598000242, __cl, $root);
};
const $n2039447598000246 = () => {
	const __cl = [];
const $n2039447598000248 = __hydrate.nextElement("span", $n2039447598000240);
$n2039447598000240 = 0;
$n2039447598000248.setAttribute("class", "badge-shown");
const $n2039447598000249 = document.createTextNode("v");
if ($n2039447598000249.parentNode !== $n2039447598000248) { const __ssr = $n2039447598000248.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000248.insertBefore($n2039447598000249, __ssr[0]); else $n2039447598000248.appendChild($n2039447598000249); }
const $n2039447598000250 = document.createTextNode('');
$n2039447598000243.push(effect(() => { const __v = props.latest.version; $n2039447598000250.data = __v == null ? '' : String(__v); }));
if ($n2039447598000250.parentNode !== $n2039447598000248) { const __ssr = $n2039447598000248.__vsk_ssrEls || []; if (0 < __ssr.length) $n2039447598000248.insertBefore($n2039447598000250, __ssr[0]); else $n2039447598000248.appendChild($n2039447598000250); }
	__cl.push($n2039447598000248);
	__place($n2039447598000241, $n2039447598000242, __cl, $root);
};
if (props.latest === null) { $n2039447598000244(); } else { $n2039447598000246(); }
	{
	    let __iv = props.latest === null;
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.latest === null; return; }
	      const __nv = props.latest === null;
	      if (__nv !== __iv) {
	        for (const e of $n2039447598000243) destroy_block(e);
	        $n2039447598000243.length = 0;
	        __cleanup($n2039447598000241, $n2039447598000242);
	        if (__nv) { $n2039447598000244(); } else { $n2039447598000246(); }
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

Object.defineProperty(__components, "Page_Statements", { get: () => __components["Statements"], configurable: true });

Object.defineProperty(__hydrators, "Page_Statements", { get: () => __hydrators["Statements"], configurable: true });
})();
