export async function GET(request) {
	const headers = Object.fromEntries(request.headers);
	return Response.json({
		message: 'Hello from Vesk API!',
		method: 'GET',
		url: request.url,
		headers,
	});
}

export async function POST(request) {
	const body = await request.json();
	return Response.json({ received: body, ok: true }, { status: 201 });
}
