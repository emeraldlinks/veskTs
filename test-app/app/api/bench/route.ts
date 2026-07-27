import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  const start = Date.now();
  await new Promise(r => setTimeout(r, 5));
  const elapsed = Date.now() - start;
  const info = {
    isVesk: req instanceof VeskRequest,
    ip: req.ip,
    protocol: req.protocol,
    hostname: req.hostname,
    query: req.query,
    elapsed,
    ts: Date.now(),
  };
  return VeskResponse.json(info).cache(0).noCache();
}
