import type { VeskRequest } from '@vesk/types';
import { VeskResponse } from '@vesk/runtime/server';

type HelloBody = {
	name?: string;
};

export async function GET(req: VeskRequest) {
	return VeskResponse.json({ message: 'Hello from Vesk!' })
		.setCookie('session', 'abc123', { httpOnly: true, secure: true, path: '/', maxAge: 3600 });
}

export async function POST(req: VeskRequest) {
	const body = await req.json<HelloBody>();
	return VeskResponse.json({ received: body, ok: true }, { status: 201 });
}
