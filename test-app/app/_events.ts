import type { ServerEventContext } from '@vesk/types';

export async function onStart(ctx: ServerEventContext) {
  await ctx.set('eventsBooted', 'events-online');
}

export async function onRequest(ctx: ServerEventContext) {
  const hits = (ctx.get('eventsHits') as number) || 0;
  ctx.set('eventsHits', hits + 1);
  const session = ctx.cookies?.get('session');
  ctx.set('eventSession', session ?? null);
  const direct = ctx.cookies?.session;
  ctx.set('eventSessionDirect', direct ?? null);
  ctx.set('eventHeaderIsMap', ctx.headers instanceof Map);
  ctx.set('eventHeader', ctx.headers?.get('x-probe') ?? null);
}