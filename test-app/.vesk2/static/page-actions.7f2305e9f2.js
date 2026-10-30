(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
const signup = {
	__veskAction: true,
	id: '-sickcy',
	url: '/_vesk/action/-sickcy'
};


__components["Actions"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
document.title = "Actions demo";
const $n3835615093000000 = document.createElement("h1");
$n3835615093000000.setAttribute("class", "text-2xl font-bold mb-4");
const $n3835615093000001 = document.createTextNode("Server actions");
$n3835615093000000.appendChild($n3835615093000001);
	$root.appendChild($n3835615093000000);
const $n3835615093000003 = (() => { const $f = document.createDocumentFragment();
const $n3835615093000005 = (() => { const $f = document.createDocumentFragment();
const $n3835615093000006 = document.createElement("input");
$n3835615093000006.setAttribute("name", "name");
$n3835615093000006.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n3835615093000006);
return $f; })();
const $n3835615093000004 = toDomNode(Field({ "name": "name", "label": "Name", children: $n3835615093000005 }));
$f.appendChild($n3835615093000004);
const $n3835615093000008 = (() => { const $f = document.createDocumentFragment();
const $n3835615093000009 = document.createElement("input");
$n3835615093000009.setAttribute("name", "email");
$n3835615093000009.setAttribute("type", "email");
$n3835615093000009.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n3835615093000009);
return $f; })();
const $n3835615093000007 = toDomNode(Field({ "name": "email", "label": "Email", children: $n3835615093000008 }));
$f.appendChild($n3835615093000007);
const $n3835615093000011 = (() => { const $f = document.createDocumentFragment();
const $n3835615093000012 = document.createElement("input");
$n3835615093000012.setAttribute("name", "password");
$n3835615093000012.setAttribute("type", "password");
$n3835615093000012.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n3835615093000012);
return $f; })();
const $n3835615093000010 = toDomNode(Field({ "name": "password", "label": "Password", children: $n3835615093000011 }));
$f.appendChild($n3835615093000010);
const $n3835615093000013 = document.createElement("button");
$n3835615093000013.setAttribute("type", "submit");
$n3835615093000013.setAttribute("class", "bg-blue-600 text-white px-4 py-2 rounded");
const $n3835615093000014 = document.createTextNode("Submit");
$n3835615093000013.appendChild($n3835615093000014);
$f.appendChild($n3835615093000013);
return $f; })();
const $n3835615093000002 = toDomNode(Form({ "action": signup, "onSuccess": () => console.log('done'), children: $n3835615093000003 }));
	$root.appendChild($n3835615093000002);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["Actions"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	let $mount = null;
	let __pendingChild = null;
let $n3835615093000015 = (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0); // first-claim budget: inherited from the caller's walker residue
document.title = "Actions demo";
const $n3835615093000018 = (() => { const $f = document.createDocumentFragment();
const $n3835615093000020 = (() => { const $f = document.createDocumentFragment();
const $n3835615093000021 = document.createElement("input");
$n3835615093000021.setAttribute("name", "name");
$n3835615093000021.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n3835615093000021);
return $f; })();
const $n3835615093000019 = toDomNode(Field({ "name": "name", "label": "Name", children: $n3835615093000020 }));
$f.appendChild($n3835615093000019);
const $n3835615093000023 = (() => { const $f = document.createDocumentFragment();
const $n3835615093000024 = document.createElement("input");
$n3835615093000024.setAttribute("name", "email");
$n3835615093000024.setAttribute("type", "email");
$n3835615093000024.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n3835615093000024);
return $f; })();
const $n3835615093000022 = toDomNode(Field({ "name": "email", "label": "Email", children: $n3835615093000023 }));
$f.appendChild($n3835615093000022);
const $n3835615093000026 = (() => { const $f = document.createDocumentFragment();
const $n3835615093000027 = document.createElement("input");
$n3835615093000027.setAttribute("name", "password");
$n3835615093000027.setAttribute("type", "password");
$n3835615093000027.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n3835615093000027);
return $f; })();
const $n3835615093000025 = toDomNode(Field({ "name": "password", "label": "Password", children: $n3835615093000026 }));
$f.appendChild($n3835615093000025);
const $n3835615093000028 = document.createElement("button");
$n3835615093000028.setAttribute("type", "submit");
$n3835615093000028.setAttribute("class", "bg-blue-600 text-white px-4 py-2 rounded");
const $n3835615093000029 = document.createTextNode("Submit");
$n3835615093000028.appendChild($n3835615093000029);
$f.appendChild($n3835615093000028);
return $f; })();
__hydrate.injectSkipK($n3835615093000015 + 1);
let $n3835615093000017 = undefined;
if (__hydrate) __hydrate.childFrame = (__hydrate.childFrame || 0) + 1;
try { $n3835615093000017 = toDomNode(Form({ "action": signup, "onSuccess": () => console.log('done'), children: $n3835615093000018 }, __registry, __hydrate)); } finally { if (__hydrate) __hydrate.childFrame--; }
$n3835615093000015 = 0;
__hydrate.retireDetached();
	if ($mount === null) $mount = $n3835615093000017;
	if ($n3835615093000017 !== $mount && $n3835615093000017.parentNode == null) $mount.appendChild($n3835615093000017);
	if ($mount === null) $mount = document.createDocumentFragment();
	return __pendingChild || $mount;
	} finally {
		setActiveComponent(__prev);
	}
};
}

Object.defineProperty(__components, "Page_Actions", { get: () => __components["Actions"], configurable: true });

Object.defineProperty(__hydrators, "Page_Actions", { get: () => __hydrators["Actions"], configurable: true });
})();
