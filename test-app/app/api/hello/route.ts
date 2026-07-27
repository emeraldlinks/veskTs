import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  return VeskResponse.json({ message: 'Hello from Vesk!' })
    .setCookie('session', 'abc123', { httpOnly: true, secure: true, path: '/', maxAge: 3600 })
    .setStatus(201)
    .cors({ origin: 'http://localhost:3002', methods: 'GET,POST' });
}

export async function POST(req: VeskRequest) {
  const body = await req.json();
  return VeskResponse.json({ received: body, ok: true }, { status: 201 })
    .setCookie('posted', 'true');
}
