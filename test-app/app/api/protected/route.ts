import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  return VeskResponse.json({
    secure: true,
    user: req.locals?.user || null,
    service: req.locals?.serviceName || null,
    pluginValue: req.locals?.pluginValue || null,
  })
    .setCsp("default-src 'none'")
    .setSecurityHeader('X-Custom', 'custom-val')
    .cache(60);
}
