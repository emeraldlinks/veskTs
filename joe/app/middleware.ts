export async function middleware(ctx, next) {
	ctx.locals.timing = Date.now();
	const response = await next();
	response.headers.set('X-Timing', String(Date.now() - ctx.locals.timing));
	return response;
}
