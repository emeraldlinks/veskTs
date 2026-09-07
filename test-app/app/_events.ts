import type { ServerEventContext } from '@vesk/types';

export async function onStart(ctx: ServerEventContext) {
  await ctx.set('eventsBooted', 'events-online');
}

export async function onRequest(ctx: ServerEventContext) {
  const hits = (ctx.get('eventsHits') as number) || 0;
  ctx.set('eventsHits', hits + 1);
}