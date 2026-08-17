# @vesk/adapter

Vesk adapter — builds deployable output for Deno and Node serverless platforms. Handles SSR functions, API routes, client bundling, static assets, and HMR dev server.

## Install

```sh
npm install @vesk/adapter
```

## Usage

```js
import { build, startDevServer } from '@vesk/adapter';

await build(appDir, { platform: 'node', target: 'node' });
```

## License

MIT
