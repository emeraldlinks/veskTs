# @vesk/compiler

Vesk compiler — lexer, parser, semantic analysis, IR generation, and codegen for `.vsk` files.

## Install

```sh
npm install @vesk/compiler
```

## Usage

```js
import { parse, compileClient, compileServer } from '@vesk/compiler';

const ast = parse(source, { filename: 'app/page.vsk' });
const client = compileClient(ast, { filename: 'app/page.vsk' });
const server = compileServer(ast, { filename: 'app/page.vsk' });
```

## License

MIT
