import { getServerContext } from '@vesk/runtime/server';

export async function GET() {
  return Response.json({
    booted: getServerContext('eventsBooted'),
    hits: getServerContext('eventsHits'),
  });
}