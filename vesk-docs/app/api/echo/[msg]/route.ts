// Dynamic API route — /api/echo/hello  →  params.msg === "hello"

export async function GET(request: Request, { params }: { params: Promise<Record<string, string>> }) {
	const { msg } = await params;
	return Response.json({ message: msg || '(empty)', method: 'GET' });
}
