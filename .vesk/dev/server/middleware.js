// Auto-generated middleware chain — do not edit

async function mw_0(ctx, next) {
ctx.set('user', { id: 1, name: 'Alice' });
  ctx.set('db', { query: () => 'db-result' });
  ctx.set('startTime', Date.now());
  return next();
}

const chain = [mw_0];

export async function execute(ctx) {
  let rewriteUrl = null;
  async function run(index) {
    if (index >= chain.length) return null;
    const fn = chain[index];
    let nextCalled = false;
    async function next(rewrite) {
      if (nextCalled) return null;
      nextCalled = true;
      if (rewrite) rewriteUrl = rewrite;
      return run(index + 1);
    }
    const result = await fn(ctx, next);
    if (result instanceof Response) return result;
    if (!nextCalled) return run(index + 1);
    return null;
  }
  const response = await run(0);
  return { response, rewriteUrl };
}
