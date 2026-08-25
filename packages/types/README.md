# @vesk/types

Shared type definitions for the Vesk framework. This package is the **single
source of truth** for every public framework type — config, plugins, security,
middleware context, request/response shapes, route nodes and build options.
It has zero runtime dependencies and ships compiled `.d.ts` + no-op `.js`.

```ts
import type { MiddlewareContext, VeskConfig, VeskRequest } from '@vesk/types';
```

Framework packages (`@vesk/compiler`, `@vesk/adapter`) re-export these types so
existing deep imports keep working, but new code should import from here.
