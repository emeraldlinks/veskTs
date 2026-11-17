import { headers, VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  const h = headers();
  return VeskResponse.json({
    get: req.cookies?.get?.('session') ?? null,
    direct: req.cookies?.session ?? null,
    header: req.headers.get('x-probe') ?? null,
    headerMap: h instanceof Map,
    headerSize: h.size,
    headerAmbient: h.get('x-probe') ?? null,
  });
}
