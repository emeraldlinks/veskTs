(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const typedPosts = [
	{
		title: 'Vesk goes typed',
		tags: ['ts', 'compiler'],
		likes: 42
	},
	{ title: 'Islands in the stream', likes: 17 }
];
function pick(arr, i) {
	return arr[i];
}


__components["Typed"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const liked = track(false);
const totalLikes = typedPosts.reduce((sum, p) => sum + p.likes, 0);
const first = typedPosts[0];
const firstTitle = first.title;
const maybeTag = first?.tags?.[0];
const label = props.label;
const sorted = typedPosts.filter((p) => p.likes > 0).sort((a, b) => b.likes - a.likes);
const chosen = pick(['a', 'b', 'c'], 1);
const id = 7;
const config = { mode: 'ssr' };
const coords = [1, 2];
document.title = "Typed — full TS in .vsk";
const $n756213580000000 = document.createElement("h1");
$n756213580000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n756213580000001 = document.createTextNode(String((label) ?? ''));
$n756213580000000.appendChild($n756213580000001);
	$root.appendChild($n756213580000000);
const $n756213580000002 = document.createElement("p");
$n756213580000002.setAttribute("class", "mb-2");
const $n756213580000003 = document.createTextNode(" Total likes: ");
$n756213580000002.appendChild($n756213580000003);
const $n756213580000004 = document.createElement("strong");
const $n756213580000005 = document.createTextNode(String((totalLikes) ?? ''));
$n756213580000004.appendChild($n756213580000005);
$n756213580000002.appendChild($n756213580000004);
const $n756213580000006 = document.createTextNode(" · first post: ");
$n756213580000002.appendChild($n756213580000006);
const $n756213580000007 = document.createElement("em");
const $n756213580000008 = document.createTextNode(String((firstTitle) ?? ''));
$n756213580000007.appendChild($n756213580000008);
$n756213580000002.appendChild($n756213580000007);
const $n756213580000009 = document.createTextNode(" · tags[0]: ");
$n756213580000002.appendChild($n756213580000009);
const $n756213580000010 = document.createTextNode(String((maybeTag ?? 'none') ?? ''));
$n756213580000002.appendChild($n756213580000010);
	$root.appendChild($n756213580000002);
const $n756213580000011 = document.createElement("p");
$n756213580000011.setAttribute("class", "mb-2");
const $n756213580000012 = document.createTextNode("Type guard filter → ");
$n756213580000011.appendChild($n756213580000012);
const $n756213580000013 = document.createTextNode(String((sorted.length) ?? ''));
$n756213580000011.appendChild($n756213580000013);
const $n756213580000014 = document.createTextNode(" posts · pick → ");
$n756213580000011.appendChild($n756213580000014);
const $n756213580000015 = document.createTextNode(String((chosen) ?? ''));
$n756213580000011.appendChild($n756213580000015);
const $n756213580000016 = document.createTextNode(" · id → ");
$n756213580000011.appendChild($n756213580000016);
const $n756213580000017 = document.createTextNode(String((id) ?? ''));
$n756213580000011.appendChild($n756213580000017);
	$root.appendChild($n756213580000011);
const $n756213580000018 = document.createElement("p");
$n756213580000018.setAttribute("class", "mb-2");
const $n756213580000019 = document.createTextNode("satisfies → ");
$n756213580000018.appendChild($n756213580000019);
const $n756213580000020 = document.createTextNode(String((config.mode) ?? ''));
$n756213580000018.appendChild($n756213580000020);
const $n756213580000021 = document.createTextNode(" · as const → (");
$n756213580000018.appendChild($n756213580000021);
const $n756213580000022 = document.createTextNode(String((coords[0]) ?? ''));
$n756213580000018.appendChild($n756213580000022);
const $n756213580000023 = document.createTextNode(",");
$n756213580000018.appendChild($n756213580000023);
const $n756213580000024 = document.createTextNode(String((coords[1]) ?? ''));
$n756213580000018.appendChild($n756213580000024);
const $n756213580000025 = document.createTextNode(")");
$n756213580000018.appendChild($n756213580000025);
	$root.appendChild($n756213580000018);
const $n756213580000026 = document.createElement("ul");
$n756213580000026.setAttribute("class", "mb-4 space-y-1");
const $n756213580000027 = document.createComment('map');
$n756213580000026.appendChild($n756213580000027);
let $n756213580000029 = [];
const $n756213580000028 = document.createComment('map-end');
const $n756213580000030 = (post, __e, __r) => {
	__r = __r || $n756213580000028;
	const __p = $n756213580000027.parentNode;
	const __it = document.createDocumentFragment();
const $n756213580000031 = document.createElement("li");
$n756213580000031.setAttribute("class", "flex items-center gap-2");
const $n756213580000032 = document.createElement("span");
const $n756213580000033 = document.createTextNode(String((post.title) ?? ''));
$n756213580000032.appendChild($n756213580000033);
$n756213580000031.appendChild($n756213580000032);
const $n756213580000034 = document.createElement("span");
$n756213580000034.setAttribute("class", "text-xs text-zinc-500");
const $n756213580000035 = document.createTextNode('');
__e.push(effect(() => { const __v = post.tags?.join(', ') ?? 'no tags'; $n756213580000035.data = __v == null ? '' : String(__v); }));
$n756213580000034.appendChild($n756213580000035);
$n756213580000031.appendChild($n756213580000034);
const $n756213580000036 = document.createElement("span");
$n756213580000036.setAttribute("class", "text-amber-600");
const $n756213580000037 = document.createTextNode(String((post.likes) ?? ''));
$n756213580000036.appendChild($n756213580000037);
const $n756213580000038 = document.createTextNode(" ♥");
$n756213580000036.appendChild($n756213580000038);
$n756213580000031.appendChild($n756213580000036);
	__it.appendChild($n756213580000031);
	if (__it.childNodes.length > 0) __p.insertBefore(__it, __r);
};
$n756213580000026.appendChild($n756213580000028);
const $n756213580000039 = () => { const __l = typedPosts; return __l != null && __l.length > 0; };
for (const post of typedPosts) {
	$n756213580000030(post, $n756213580000029);
}
	$root.appendChild($n756213580000026);
const $n756213580000040 = document.createElement("button");
$n756213580000040.setAttribute("class", "rounded bg-blue-600 text-white px-3 py-1");
const $n756213580000041 = document.createComment('if');
$n756213580000040.appendChild($n756213580000041);
let $n756213580000043 = [];
const $n756213580000042 = document.createComment('if-end');
const $n756213580000044 = () => {
	const __p = $n756213580000041.parentNode;
	const $n756213580000045 = document.createDocumentFragment();
const $n756213580000046 = document.createTextNode(String(('Liked ♥') ?? ''));
	$n756213580000045.appendChild($n756213580000046);
	__p.insertBefore($n756213580000045, $n756213580000042);
};
const $n756213580000047 = () => {
	const __p = $n756213580000041.parentNode;
	const $n756213580000048 = document.createDocumentFragment();
const $n756213580000049 = document.createTextNode(String(('Like') ?? ''));
	$n756213580000048.appendChild($n756213580000049);
	__p.insertBefore($n756213580000048, $n756213580000042);
};
$n756213580000040.appendChild($n756213580000042);
if (get(liked)) { $n756213580000044(); } else { $n756213580000047(); }
$n756213580000040.__evh_click = () => set(liked, !get(liked));
$n756213580000040.setAttribute('data-vsk-ev', '');
	$root.appendChild($n756213580000040);
	{
	    let __iv = get(liked);
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(liked); return; }
	      const __nv = get(liked);
	      if (__nv !== __iv) {
	        for (const e of $n756213580000043) destroy_block(e);
	        $n756213580000043.length = 0;
	        __cleanup($n756213580000041, $n756213580000042);
	        if (__nv) { $n756213580000044(); } else { $n756213580000047(); }
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
__hydrators["Typed"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
const liked = track(false);
let $n756213580000050 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const totalLikes = typedPosts.reduce((sum, p) => sum + p.likes, 0);
const first = typedPosts[0];
const firstTitle = first.title;
const maybeTag = first?.tags?.[0];
const label = props.label;
const sorted = typedPosts.filter((p) => p.likes > 0).sort((a, b) => b.likes - a.likes);
const chosen = pick(['a', 'b', 'c'], 1);
const id = 7;
const config = { mode: 'ssr' };
const coords = [1, 2];
document.title = "Typed — full TS in .vsk";
const $n756213580000051 = __hydrate.nextElement("h1", $n756213580000050);
$n756213580000050 = 0;
$n756213580000051.setAttribute("class", "text-3xl font-bold mb-4");
const $n756213580000052 = document.createTextNode(String((label) ?? ''));
if ($n756213580000052.parentNode !== $n756213580000051) { const __ssr = $n756213580000051.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000051.insertBefore($n756213580000052, __ssr[0]); else $n756213580000051.appendChild($n756213580000052); }
	if ($mount === null) $mount = $n756213580000051;
	if ($n756213580000051 !== $mount && $n756213580000051.parentNode == null) $mount.appendChild($n756213580000051);
const $n756213580000053 = __hydrate.nextElement("p", 0);
$n756213580000053.setAttribute("class", "mb-2");
const $n756213580000054 = __hydrate.subWalker($n756213580000053);
const $n756213580000055 = document.createTextNode(" Total likes: ");
if ($n756213580000055.parentNode !== $n756213580000053) { const __ssr = $n756213580000053.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000053.insertBefore($n756213580000055, __ssr[0]); else $n756213580000053.appendChild($n756213580000055); }
const $n756213580000056 = $n756213580000054.nextElement("strong", 0);
const $n756213580000057 = document.createTextNode(String((totalLikes) ?? ''));
if ($n756213580000057.parentNode !== $n756213580000056) { const __ssr = $n756213580000056.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000056.insertBefore($n756213580000057, __ssr[0]); else $n756213580000056.appendChild($n756213580000057); }
if ($n756213580000056.parentNode !== $n756213580000053) { if (!$n756213580000053 || $n756213580000056.parentNode == null || !$n756213580000053.contains($n756213580000056)) $n756213580000053.appendChild($n756213580000056); }
const $n756213580000058 = document.createTextNode(" · first post: ");
if ($n756213580000058.parentNode !== $n756213580000053) { const __ssr = $n756213580000053.__vsk_ssrEls || []; if (1 < __ssr.length) $n756213580000053.insertBefore($n756213580000058, __ssr[1]); else $n756213580000053.appendChild($n756213580000058); }
const $n756213580000059 = $n756213580000054.nextElement("em", 0);
const $n756213580000060 = document.createTextNode(String((firstTitle) ?? ''));
if ($n756213580000060.parentNode !== $n756213580000059) { const __ssr = $n756213580000059.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000059.insertBefore($n756213580000060, __ssr[0]); else $n756213580000059.appendChild($n756213580000060); }
if ($n756213580000059.parentNode !== $n756213580000053) { if (!$n756213580000053 || $n756213580000059.parentNode == null || !$n756213580000053.contains($n756213580000059)) $n756213580000053.appendChild($n756213580000059); }
const $n756213580000061 = document.createTextNode(" · tags[0]: ");
if ($n756213580000061.parentNode !== $n756213580000053) { const __ssr = $n756213580000053.__vsk_ssrEls || []; if (2 < __ssr.length) $n756213580000053.insertBefore($n756213580000061, __ssr[2]); else $n756213580000053.appendChild($n756213580000061); }
const $n756213580000062 = document.createTextNode(String((maybeTag ?? 'none') ?? ''));
if ($n756213580000062.parentNode !== $n756213580000053) { const __ssr = $n756213580000053.__vsk_ssrEls || []; if (2 < __ssr.length) $n756213580000053.insertBefore($n756213580000062, __ssr[2]); else $n756213580000053.appendChild($n756213580000062); }
	if ($mount === null) $mount = $n756213580000053;
	if ($n756213580000053 !== $mount && $n756213580000053.parentNode == null) $mount.appendChild($n756213580000053);
const $n756213580000063 = __hydrate.nextElement("p", 0);
$n756213580000063.setAttribute("class", "mb-2");
const $n756213580000064 = document.createTextNode("Type guard filter → ");
if ($n756213580000064.parentNode !== $n756213580000063) { const __ssr = $n756213580000063.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000063.insertBefore($n756213580000064, __ssr[0]); else $n756213580000063.appendChild($n756213580000064); }
const $n756213580000065 = document.createTextNode(String((sorted.length) ?? ''));
if ($n756213580000065.parentNode !== $n756213580000063) { const __ssr = $n756213580000063.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000063.insertBefore($n756213580000065, __ssr[0]); else $n756213580000063.appendChild($n756213580000065); }
const $n756213580000066 = document.createTextNode(" posts · pick → ");
if ($n756213580000066.parentNode !== $n756213580000063) { const __ssr = $n756213580000063.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000063.insertBefore($n756213580000066, __ssr[0]); else $n756213580000063.appendChild($n756213580000066); }
const $n756213580000067 = document.createTextNode(String((chosen) ?? ''));
if ($n756213580000067.parentNode !== $n756213580000063) { const __ssr = $n756213580000063.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000063.insertBefore($n756213580000067, __ssr[0]); else $n756213580000063.appendChild($n756213580000067); }
const $n756213580000068 = document.createTextNode(" · id → ");
if ($n756213580000068.parentNode !== $n756213580000063) { const __ssr = $n756213580000063.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000063.insertBefore($n756213580000068, __ssr[0]); else $n756213580000063.appendChild($n756213580000068); }
const $n756213580000069 = document.createTextNode(String((id) ?? ''));
if ($n756213580000069.parentNode !== $n756213580000063) { const __ssr = $n756213580000063.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000063.insertBefore($n756213580000069, __ssr[0]); else $n756213580000063.appendChild($n756213580000069); }
	if ($mount === null) $mount = $n756213580000063;
	if ($n756213580000063 !== $mount && $n756213580000063.parentNode == null) $mount.appendChild($n756213580000063);
const $n756213580000070 = __hydrate.nextElement("p", 0);
$n756213580000070.setAttribute("class", "mb-2");
const $n756213580000071 = document.createTextNode("satisfies → ");
if ($n756213580000071.parentNode !== $n756213580000070) { const __ssr = $n756213580000070.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000070.insertBefore($n756213580000071, __ssr[0]); else $n756213580000070.appendChild($n756213580000071); }
const $n756213580000072 = document.createTextNode(String((config.mode) ?? ''));
if ($n756213580000072.parentNode !== $n756213580000070) { const __ssr = $n756213580000070.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000070.insertBefore($n756213580000072, __ssr[0]); else $n756213580000070.appendChild($n756213580000072); }
const $n756213580000073 = document.createTextNode(" · as const → (");
if ($n756213580000073.parentNode !== $n756213580000070) { const __ssr = $n756213580000070.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000070.insertBefore($n756213580000073, __ssr[0]); else $n756213580000070.appendChild($n756213580000073); }
const $n756213580000074 = document.createTextNode(String((coords[0]) ?? ''));
if ($n756213580000074.parentNode !== $n756213580000070) { const __ssr = $n756213580000070.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000070.insertBefore($n756213580000074, __ssr[0]); else $n756213580000070.appendChild($n756213580000074); }
const $n756213580000075 = document.createTextNode(",");
if ($n756213580000075.parentNode !== $n756213580000070) { const __ssr = $n756213580000070.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000070.insertBefore($n756213580000075, __ssr[0]); else $n756213580000070.appendChild($n756213580000075); }
const $n756213580000076 = document.createTextNode(String((coords[1]) ?? ''));
if ($n756213580000076.parentNode !== $n756213580000070) { const __ssr = $n756213580000070.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000070.insertBefore($n756213580000076, __ssr[0]); else $n756213580000070.appendChild($n756213580000076); }
const $n756213580000077 = document.createTextNode(")");
if ($n756213580000077.parentNode !== $n756213580000070) { const __ssr = $n756213580000070.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000070.insertBefore($n756213580000077, __ssr[0]); else $n756213580000070.appendChild($n756213580000077); }
	if ($mount === null) $mount = $n756213580000070;
	if ($n756213580000070 !== $mount && $n756213580000070.parentNode == null) $mount.appendChild($n756213580000070);
const $n756213580000078 = __hydrate.nextElement("ul", 0);
$n756213580000078.setAttribute("class", "mb-4 space-y-1");
const $n756213580000079 = __hydrate.subWalker($n756213580000078);
const $n756213580000080 = document.createComment('map');
let $n756213580000082 = [];
const $n756213580000081 = document.createComment('map-end');
const $n756213580000083 = (post, __e, __r, __cl) => {
	__r = __r || $n756213580000081;
	const __p = $n756213580000080.parentNode;
const $n756213580000084 = $n756213580000079.nextElement("li", 0);
$n756213580000084.setAttribute("class", "flex items-center gap-2");
const $n756213580000085 = $n756213580000079.subWalker($n756213580000084);
const $n756213580000086 = $n756213580000085.nextElement("span", 0);
const $n756213580000087 = document.createTextNode(String((post.title) ?? ''));
if ($n756213580000087.parentNode !== $n756213580000086) { const __ssr = $n756213580000086.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000086.insertBefore($n756213580000087, __ssr[0]); else $n756213580000086.appendChild($n756213580000087); }
if ($n756213580000086.parentNode !== $n756213580000084) { if (!$n756213580000084 || $n756213580000086.parentNode == null || !$n756213580000084.contains($n756213580000086)) $n756213580000084.appendChild($n756213580000086); }
const $n756213580000088 = $n756213580000085.nextElement("span", 0);
$n756213580000088.setAttribute("class", "text-xs text-zinc-500");
const $n756213580000089 = document.createTextNode(String($n756213580000088.__vsk_ssrText ?? ''));
__e.push(effect(() => { const __v = post.tags?.join(', ') ?? 'no tags'; $n756213580000089.data = __v == null ? '' : String(__v); }));
if ($n756213580000089.parentNode !== $n756213580000088) { const __ssr = $n756213580000088.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000088.insertBefore($n756213580000089, __ssr[0]); else $n756213580000088.appendChild($n756213580000089); }
if ($n756213580000088.parentNode !== $n756213580000084) { if (!$n756213580000084 || $n756213580000088.parentNode == null || !$n756213580000084.contains($n756213580000088)) $n756213580000084.appendChild($n756213580000088); }
const $n756213580000090 = $n756213580000085.nextElement("span", 0);
$n756213580000090.setAttribute("class", "text-amber-600");
const $n756213580000091 = document.createTextNode(String((post.likes) ?? ''));
if ($n756213580000091.parentNode !== $n756213580000090) { const __ssr = $n756213580000090.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000090.insertBefore($n756213580000091, __ssr[0]); else $n756213580000090.appendChild($n756213580000091); }
const $n756213580000092 = document.createTextNode(" ♥");
if ($n756213580000092.parentNode !== $n756213580000090) { const __ssr = $n756213580000090.__vsk_ssrEls || []; if (0 < __ssr.length) $n756213580000090.insertBefore($n756213580000092, __ssr[0]); else $n756213580000090.appendChild($n756213580000092); }
if ($n756213580000090.parentNode !== $n756213580000084) { if (!$n756213580000084 || $n756213580000090.parentNode == null || !$n756213580000084.contains($n756213580000090)) $n756213580000084.appendChild($n756213580000090); }
	if (__cl) __cl.push($n756213580000084); else __p.insertBefore($n756213580000084, __r);
};
const $n756213580000093 = () => { const __l = typedPosts; return __l != null && __l.length > 0; };
const $n756213580000094 = [];
for (const post of typedPosts) {
	$n756213580000083(post, $n756213580000082, null, $n756213580000094);
}
__place($n756213580000080, $n756213580000081, $n756213580000094, $n756213580000078);
	if ($mount === null) $mount = $n756213580000078;
	if ($n756213580000078 !== $mount && $n756213580000078.parentNode == null) $mount.appendChild($n756213580000078);
const $n756213580000095 = __hydrate.nextElement("button", 0);
$n756213580000095.setAttribute("class", "rounded bg-blue-600 text-white px-3 py-1");
const $n756213580000096 = __hydrate.subWalker($n756213580000095);
const $n756213580000097 = document.createComment('if');
let $n756213580000099 = [];
const $n756213580000098 = document.createComment('if-end');
const $n756213580000100 = () => {
	const __cl = [];
const $n756213580000102 = document.createTextNode(String(('Liked ♥') ?? ''));
	__cl.push($n756213580000102);
	__place($n756213580000097, $n756213580000098, __cl, $n756213580000095);
};
const $n756213580000103 = () => {
	const __cl = [];
const $n756213580000105 = document.createTextNode(String(('Like') ?? ''));
	__cl.push($n756213580000105);
	__place($n756213580000097, $n756213580000098, __cl, $n756213580000095);
};
if (get(liked)) { $n756213580000100(); } else { $n756213580000103(); }
$n756213580000095.__evh_click = () => set(liked, !get(liked));
$n756213580000095.setAttribute('data-vsk-ev', '');
	if ($mount === null) $mount = $n756213580000095;
	if ($n756213580000095 !== $mount && $n756213580000095.parentNode == null) $mount.appendChild($n756213580000095);
	{
	    let __iv = get(liked);
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = get(liked); return; }
	      const __nv = get(liked);
	      if (__nv !== __iv) {
	        for (const e of $n756213580000099) destroy_block(e);
	        $n756213580000099.length = 0;
	        __cleanup($n756213580000097, $n756213580000098);
	        if (__nv) { $n756213580000100(); } else { $n756213580000103(); }
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

Object.defineProperty(__components, "Page_Typed", { get: () => __components["Typed"], configurable: true });

Object.defineProperty(__hydrators, "Page_Typed", { get: () => __hydrators["Typed"], configurable: true });
})();
