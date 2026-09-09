# Errors

Vesk provides structured error types for common failure scenarios.

## VeskError

The base compiler/framework error class with rich formatting.

```ts
import { VeskError } from '@vesk/compiler';

throw new VeskError({
  code: 'V0412',
  message: 'Reactive read outside a tracked scope',
  file: 'app/page.vsk',
  line: 15,
  column: 3,
  help: 'Move the reactive read inside an effect() or component body.',
});
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `code` | `string` | Stable V-code (e.g., `V0412`) |
| `message` | `string` | Human-readable error message |
| `file` | `string` | Source file path |
| `line` | `number` | Line number |
| `column` | `number` | Column number |
| `help` | `string` | Suggested fix |

### Methods

- `codeFrame()` — returns a formatted code frame with the error location
  highlighted and a caret pointing to the problem.

## HttpError

Thrown for non-2xx HTTP responses.

```ts
import { HttpError } from '@vesk/runtime';

throw new HttpError(404, 'Page not found');
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `statusText` | `string` | HTTP status text |
| `statusCode` | `number` | Alias for `status` |

## TimeoutError

Thrown when a request exceeds its timeout.

```ts
import { TimeoutError } from '@vesk/runtime';

throw new TimeoutError(5000); // timed out after 5000ms
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `timeout` | `number` | Timeout in milliseconds |

## NotFoundError

Thrown by `notFound()` to render the `not-found.vsk` page.

```ts
import { notFound, NotFoundError } from '@vesk/runtime';

// These are equivalent:
notFound();
throw new NotFoundError();
```

## Error handling in components

```vsk
component SafePage() {
  return (
    <ErrorBoundary fallback={(err) => <p>Error: {err.message}</p>}>
      <RiskyComponent />
    </ErrorBoundary>
  );
}
```

## Error handling in server code

```ts
export async function GET(request: Request) {
  try {
    const data = await fetchExternalData();
    return Response.json(data);
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json(
        { error: err.statusText },
        { status: err.status }
      );
    }
    if (err instanceof TimeoutError) {
      return Response.json(
        { error: `Request timed out after ${err.timeout}ms` },
        { status: 504 }
      );
    }
    throw err; // re-throw unknown errors
  }
}
```

## Verified against

- `packages/compiler/src/errors.ts` — `VeskError`
- `packages/runtime/src/resource.ts` — `HttpError`, `TimeoutError`
- `packages/runtime/src/index-server.ts` — error exports
