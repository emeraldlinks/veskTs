import type { VeskRequest } from '@vesk/types';

export function GET(req: VeskRequest) {
	return Response.json({
		previous: req.previousRoute,
		source: req.previousRouteInfo.source,
		headers: Object.fromEntries(req.previousRouteInfo.headers),
	});
}
