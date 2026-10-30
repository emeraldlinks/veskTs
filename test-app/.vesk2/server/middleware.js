// Auto-generated middleware chain — do not edit

async function mw_0(ctx, next) {
ctx.set('user', { id: 1, name: 'Alice' });
	ctx.set('db', { query: () => 'db-result' });
	ctx.set('startTime', Date.now());
	console.log("user: ", ctx.get("user"));

	return next();
}

const chain = [mw_0];

export async function execute(ctx) {
  let rewriteUrl = null;
  async function run(index) {
    if (index >= chain.length) return null;
    const fn = chain[index];
    let nextCalled = false;
    let nextResult = null;
    async function next(rewrite) {
      if (nextCalled) return null;
      nextCalled = true;
      if (rewrite) rewriteUrl = rewrite;
      nextResult = await run(index + 1);
      return nextResult;
    }
    const result = await fn(ctx, next);
    if (result instanceof Response) return result;
    if (nextResult instanceof Response) return nextResult;
    if (!nextCalled) return run(index + 1);
    return null;
  }
  const response = await run(0);
  return { response, rewriteUrl };
}
