import { VeskResponse, notFound, withValidation, signCookie, cors, useParams } from '@vesk/runtime/server';

export const config = { csrf: false, maxDuration: 5 };

export async function beforeRequest(req: Request) {
  if (new URL(req.url).searchParams.get('short') === '1') {
    return VeskResponse.json({ shortCircuited: true });
  }
  return undefined as unknown as Response;
}

export async function afterRequest(_req: Request, res: Response) {
  // Redirect/plain-object responses are not mutable Responses — only stamp
  // when we actually got one.
  if (res instanceof Response) {
    try { res.headers.set('x-after-hook', 'ran'); } catch { /* immutable */ }
  }
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('gone') === '1') notFound();
  if (url.searchParams.get('away') === '1') return Response.redirect('https://example.com/', 302);
  return { plain: 'object', notAResponse: true };
}

export async function POST(req: Request) {
  const body = await req.json();
  if ((body as { big?: boolean }).big) {
    return { tooLarge: true };
  }
  return VeskResponse.json({ echoed: body, signed: await signCookie('sid', 'abc') }).setStatus(201);
}

export async function PUT() {
  const params = await useParams();
  return VeskResponse.json({ put: true, params });
}
