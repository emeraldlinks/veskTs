// Vesk API Route — app/api/hello/route.ts
// Signature (Next.js App Router):
//   export async function GET(request, { params }) {
//     const { id } = await params;
//     return Response.json({ id });
//   }

import type { NextRequest } from '@vesk/runtime';

export async function GET(request: NextRequest) {
	const token = request.cookies?.token || '(none)';
	return Response.json({
		message: 'Hello from Vesk API!',
		timestamp: Date.now(),
		url: request.url,
		token,
	});
}

export async function POST(request: NextRequest) {
	const body = await request.json();
	return Response.json({ received: body, ok: true }, { status: 201 });
}
