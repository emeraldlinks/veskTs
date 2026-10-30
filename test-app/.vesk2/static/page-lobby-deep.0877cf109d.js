(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
{
__components["LobbyDeep"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
	let __pendingChild = null;
const $n1970593321000000 = document.createElement("h1");
$n1970593321000000.setAttribute("class", "text-3xl font-bold mb-4");
const $n1970593321000001 = document.createTextNode("Lobby Deep");
$n1970593321000000.appendChild($n1970593321000001);
	$root.appendChild($n1970593321000000);
const $n1970593321000002 = document.createElement("p");
$n1970593321000002.setAttribute("class", "text-gray-600");
const $n1970593321000003 = document.createTextNode("Nested under the standalone lobby layout.");
$n1970593321000002.appendChild($n1970593321000003);
	$root.appendChild($n1970593321000002);
	return __pendingChild || $root;
	} finally {
		setActiveComponent(__prev);
	}
};
__hydrators["LobbyDeep"] = (props, __registry, __hydrate) => { return __hydrate.claimOnly(undefined, (typeof __hydrate.takeSkipK === 'function' ? __hydrate.takeSkipK() : 0)); };
}

Object.defineProperty(__components, "Page_Lobby_deep", { get: () => __components["LobbyDeep"], configurable: true });

Object.defineProperty(__hydrators, "Page_Lobby_deep", { get: () => __hydrators["LobbyDeep"], configurable: true });
})();
