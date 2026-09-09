# API Routes

API routes provide server-side endpoints for data. They live under
`app/api/` and export HTTP method handlers.

## Route conventions

| File path | URL |
|-----------|-----|
| `app/api/posts/route.ts` | `/api/posts` |
| `app/api/hello/route.ts` | `/api/hello` |
| `app/api/users/[id]/route.ts` | `/api/users/:id` |

## Defining handlers

```ts
// app/api/posts/route.ts

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || 10;

  const posts = await db.query('SELECT * FROM posts LIMIT $1', [limit]);

  return Response.json(posts);
}

export async function POST(request: Request) {
  const body = await request.json();

  const post = await db.insert('posts', body);

  return Response.json(post, { status: 201 });
}
```

## Method exports

Export named functions for each HTTP method:

```ts
export async function GET(req: Request) { ... }
export async function POST(req: Request) { ... }
export async function PUT(req: Request) { ... }
export async function PATCH(req: Request) { ... }
export async function DELETE(req: Request) { ... }
```

## Dynamic segments

```ts
// app/api/users/[id]/route.ts

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await db.findUser(params.id);

  if (!user) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json(user);
}
```

## Returning responses

```ts
// JSON
return Response.json({ data: items });

// With status
return Response.json({ error: 'Unauthorized' }, { status: 401 });

// Redirect
return Response.redirect('/login', 302);

// Plain text
return new Response('Hello', { headers: { 'Content-Type': 'text/plain' } });

// VeskResponse (fluent API)
import { VeskResponse } from '@vesk/runtime';

return VeskResponse.json({ message: 'hello' })
  .setCookie('session', 'abc', { httpOnly: true })
  .build();
```

## Using server APIs inside routes

```ts
import { cookies, headers, locals } from '@vesk/runtime';

export async function GET() {
  const token = cookies().get('session');
  const user = locals().user;

  return Response.json({ user, token });
}
```

## Error handling

```ts
export async function GET(request: Request) {
  try {
    const data = await riskyOperation();
    return Response.json(data);
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

## Verified against

- `packages/compiler/src/api-routes.ts` — `scanApiRoutes`
- `packages/adapter/src/api-function.ts` — API function generation
- `packages/runtime/src/request.ts` — request/response APIs
