(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["StoreItem"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1443817061000000 = document.createComment('if');
$root.appendChild($n1443817061000000);
let $n1443817061000002 = [];
const $n1443817061000001 = document.createComment('if-end');
const $n1443817061000003 = () => {
	const __p = $n1443817061000000.parentNode;
	const $n1443817061000004 = document.createDocumentFragment();
throw new NotFoundError();
	__p.insertBefore($n1443817061000004, $n1443817061000001);
};
$root.appendChild($n1443817061000001);
if (props.params.item === 'missing') { $n1443817061000003(); }
const $n1443817061000005 = document.createComment('if');
$root.appendChild($n1443817061000005);
let $n1443817061000007 = [];
const $n1443817061000006 = document.createComment('if-end');
const $n1443817061000008 = () => {
	const __p = $n1443817061000005.parentNode;
	const $n1443817061000009 = document.createDocumentFragment();
throw new Error('Store exploded: stock API unavailable');
	__p.insertBefore($n1443817061000009, $n1443817061000006);
};
$root.appendChild($n1443817061000006);
if (props.params.item === 'boom') { $n1443817061000008(); }
const $n1443817061000010 = document.createElement("h1");
$n1443817061000010.setAttribute("class", "text-3xl font-bold mb-2");
const $n1443817061000011 = document.createTextNode("Item: ");
$n1443817061000010.appendChild($n1443817061000011);
const $n1443817061000012 = document.createTextNode('');
$n1443817061000010.appendChild($n1443817061000012);
	$root.appendChild($n1443817061000010);
const $n1443817061000013 = document.createElement("p");
$n1443817061000013.setAttribute("class", "text-gray-600");
const $n1443817061000014 = document.createTextNode("Rendered normally at the store item route.");
$n1443817061000013.appendChild($n1443817061000014);
	$root.appendChild($n1443817061000013);
	{
	    let __iv = props.params.item === 'missing';
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.params.item === 'missing'; return; }
	      const __nv = props.params.item === 'missing';
	      if (__nv !== __iv) {
	        for (const e of $n1443817061000002) destroy_block(e);
	        $n1443817061000002.length = 0;
	        __cleanup($n1443817061000000, $n1443817061000001);
	        if (__nv) { $n1443817061000003(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	    let __iv = props.params.item === 'boom';
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.params.item === 'boom'; return; }
	      const __nv = props.params.item === 'boom';
	      if (__nv !== __iv) {
	        for (const e of $n1443817061000007) destroy_block(e);
	        $n1443817061000007.length = 0;
	        __cleanup($n1443817061000005, $n1443817061000006);
	        if (__nv) { $n1443817061000008(); }
	        __iv = __nv;
	      }
	    });
	  }
	effect(() => { const __v = props.params.item; $n1443817061000012.data = __v == null ? '' : String(__v); });
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["StoreItem"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n1443817061000015 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n1443817061000016 = document.createComment('if');
let $n1443817061000018 = [];
const $n1443817061000017 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n1443817061000016, $n1443817061000015);
	__hydrate.insertBeforeNextClaim($n1443817061000017, $n1443817061000015);
}
const $n1443817061000019 = () => {
	const __cl = [];
throw new NotFoundError();
	__place($n1443817061000016, $n1443817061000017, __cl, $root);
};
if (props.params.item === 'missing') { $n1443817061000019(); }
const $n1443817061000021 = document.createComment('if');
let $n1443817061000023 = [];
const $n1443817061000022 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n1443817061000021, $n1443817061000015);
	__hydrate.insertBeforeNextClaim($n1443817061000022, $n1443817061000015);
}
const $n1443817061000024 = () => {
	const __cl = [];
throw new Error('Store exploded: stock API unavailable');
	__place($n1443817061000021, $n1443817061000022, __cl, $root);
};
if (props.params.item === 'boom') { $n1443817061000024(); }
const $n1443817061000026 = __hydrate.nextElement("h1", $n1443817061000015);
$n1443817061000015 = 0;
$n1443817061000026.setAttribute("class", "text-3xl font-bold mb-2");
const $n1443817061000027 = document.createTextNode("Item: ");
if ($n1443817061000027.parentNode !== $n1443817061000026) { const __ssr = $n1443817061000026.__vsk_ssrEls || []; if (0 < __ssr.length) $n1443817061000026.insertBefore($n1443817061000027, __ssr[0]); else $n1443817061000026.appendChild($n1443817061000027); }
const $n1443817061000028 = document.createTextNode('');
if ($n1443817061000028.parentNode !== $n1443817061000026) { const __ssr = $n1443817061000026.__vsk_ssrEls || []; if (0 < __ssr.length) $n1443817061000026.insertBefore($n1443817061000028, __ssr[0]); else $n1443817061000026.appendChild($n1443817061000028); }
	if ($mount === null) $mount = $n1443817061000026;
	if ($n1443817061000026 !== $mount && $n1443817061000026.parentNode == null) $mount.appendChild($n1443817061000026);
	{
	    let __iv = props.params.item === 'missing';
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.params.item === 'missing'; return; }
	      const __nv = props.params.item === 'missing';
	      if (__nv !== __iv) {
	        for (const e of $n1443817061000018) destroy_block(e);
	        $n1443817061000018.length = 0;
	        __cleanup($n1443817061000016, $n1443817061000017);
	        if (__nv) { $n1443817061000019(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	    let __iv = props.params.item === 'boom';
	    let __first = true;
	    effect(() => {
	      if (__first) { __first = false; __iv = props.params.item === 'boom'; return; }
	      const __nv = props.params.item === 'boom';
	      if (__nv !== __iv) {
	        for (const e of $n1443817061000023) destroy_block(e);
	        $n1443817061000023.length = 0;
	        __cleanup($n1443817061000021, $n1443817061000022);
	        if (__nv) { $n1443817061000024(); }
	        __iv = __nv;
	      }
	    });
	  }
	effect(() => { const __v = props.params.item; $n1443817061000028.data = __v == null ? '' : String(__v); });
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Store_item", { get: () => __components["StoreItem"], configurable: true });

Object.defineProperty(__hydrators, "Page_Store_item", { get: () => __hydrators["StoreItem"], configurable: true });
})();
