import { getServerContext } from '@vesk/runtime/server';

export async function GET() {
  return Response.json({
    booted: getServerContext('eventsBooted'),
    hits: getServerContext('eventsHits'),
    session: getServerContext('eventSession') ?? null,
    sessionDirect: getServerContext('eventSessionDirect') ?? null,
  });
}