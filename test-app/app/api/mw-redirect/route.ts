import { VeskResponse } from '@vesk/runtime/server';

export async function GET() {
  return VeskResponse.json({ source: 'mw-redirect' })
    .setCookie('redirect_seen', '1', { path: '/', httpOnly: false, secure: false })
    .redirect('/about');
}
