/**
 * @vesk/router — the canonical public entry point for everything
 * navigation/routing related.
 *
 * ```js
 * import { Link, NavLink, useRouter, useNavigate } from '@vesk/router';
 * ```
 *
 * The `@vesk/runtime` barrels keep thin back-compat re-exports of this surface
 * because the compiler's auto-import machinery and the client bootstrap
 * resolve through them — new application code should prefer `@vesk/router`.
 */

export {
	createRouter, createFileRouter,
	Outlet, Link, NavLink,
	useNavigate, useParams, usePathname, useSearchParams, useRouter,
	buildRouteTree, defineRoute,
	Redirect, redirect, permanentRedirect, NotFoundError, notFound,
	ensureChunk, matchRoute,
} from '@vesk/runtime/src/router';

// Navigation-driven loading state (the bar the router drives + custom UIs).
export {
	LoadingIndicator, useLoadingIndicator, configureLoadingIndicator,
	loadingStart, loadingSet, loadingFinish, loadingClear,
	getLoadingProgress, isLoadingActive, getLoadingError, getLoadingState,
	LOADING_INDICATOR_DEFAULT_COLOR, LOADING_INDICATOR_DEFAULT_ERROR_COLOR,
} from '@vesk/runtime/src/loading-indicator';
export type {
	LoadingIndicatorHandle, LoadingIndicatorOptions, LoadingIndicatorProps,
} from '@vesk/runtime/src/loading-indicator';
