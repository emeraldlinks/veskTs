// Auto-generated middleware chain — do not edit

async function mw_0(ctx, next) {
ctx.locals.timing = Date.now();
	const response = await next();
	response.headers.set('X-Timing', String(Date.now() - ctx.locals.timing));
	return response;
}

const chain = [mw_0];

export async function execute(ctx) {
  let rewriteUrl = null;
  async function run(index) {
    if (index >= chain.length) return null;
    const fn = chain[index];
    async function next(rewrite) {
      if (rewrite) rewriteUrl = rewrite;
      return run(index + 1);
    }
    const result = await fn(ctx, next);
    if (result instanceof Response) return result;
    return run(index + 1);
  }
  const response = await run(0);
  return { response, rewriteUrl };
}
