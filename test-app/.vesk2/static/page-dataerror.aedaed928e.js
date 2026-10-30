(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["DataError"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n975381522000000 = document.createComment('if');
$root.appendChild($n975381522000000);
let $n975381522000002 = [];
const $n975381522000001 = document.createComment('if-end');
const $n975381522000003 = () => {
	const __p = $n975381522000000.parentNode;
	const $n975381522000004 = document.createDocumentFragment();
throw new Error('Data layer unavailable during SSR');
	__p.insertBefore($n975381522000004, $n975381522000001);
};
$root.appendChild($n975381522000001);
if (typeof window === 'undefined') { $n975381522000003(); }
const $n975381522000005 = document.createElement("h1");
$n975381522000005.setAttribute("class", "text-3xl font-bold mb-4");
const $n975381522000006 = document.createTextNode("Data Error Demo");
$n975381522000005.appendChild($n975381522000006);
	$root.appendChild($n975381522000005);
const $n975381522000007 = document.createElement("p");
$n975381522000007.setAttribute("class", "text-gray-600");
const $n975381522000008 = document.createTextNode("This page throws only during the server data phase (SSR).");
$n975381522000007.appendChild($n975381522000008);
	$root.appendChild($n975381522000007);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["DataError"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n975381522000009 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
const $n975381522000010 = document.createComment('if');
let $n975381522000012 = [];
const $n975381522000011 = document.createComment('if-end');
// Anchor region fences to the SSR slot so no-content regions do not fall back to $root's end.
if (__hydrate && __hydrate.insertBeforeNextClaim) {
	__hydrate.insertBeforeNextClaim($n975381522000010, $n975381522000009);
	__hydrate.insertBeforeNextClaim($n975381522000011, $n975381522000009);
}
const $n975381522000013 = () => {
	const __cl = [];
throw new Error('Data layer unavailable during SSR');
	__place($n975381522000010, $n975381522000011, __cl, $root);
};
if (typeof window === 'undefined') { $n975381522000013(); }
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Dataerror", { get: () => __components["DataError"], configurable: true });

Object.defineProperty(__hydrators, "Page_Dataerror", { get: () => __hydrators["DataError"], configurable: true });
})();
