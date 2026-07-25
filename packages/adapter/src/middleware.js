import { readFileSync } from 'fs';
import { resolve } from 'path';

export function compileMiddleware(mwChain, appDir) {
  if (mwChain.length === 0) return null;

  const parts = [];
  for (let i = 0; i < mwChain.length; i++) {
    const { sourcePath } = mwChain[i];
    const src = readFileSync(sourcePath, 'utf-8');
    const m = src.match(/export\s+(?:async\s+)?function\s+middleware\s*\(([\s\S]*?)\)\s*\{/);
    if (!m) continue;
    const start = m.index + m[0].length;
    const params = m[1];
    let depth = 1;
    let j = start;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(start, j - 1);
    parts.push(`async function mw_${i}(${params}) {\n${body.trim()}\n}`);
  }

  if (parts.length === 0) return null;

  const code = [
    `// Auto-generated middleware chain — do not edit`,
    ``,
    parts.join('\n\n'),
    ``,
    `const chain = [${parts.map((_, i) => `mw_${i}`).join(', ')}];`,
    ``,
    `export async function execute(ctx) {`,
    `  let rewriteUrl = null;`,
    `  async function run(index) {`,
    `    if (index >= chain.length) return null;`,
    `    const fn = chain[index];`,
    `    let nextCalled = false;`,
    `    async function next(rewrite) {`,
    `      if (nextCalled) return null;`,
    `      nextCalled = true;`,
    `      if (rewrite) rewriteUrl = rewrite;`,
    `      return run(index + 1);`,
    `    }`,
    `    const result = await fn(ctx, next);`,
    `    if (result instanceof Response) return result;`,
    `    if (!nextCalled) return run(index + 1);`,
    `    return null;`,
    `  }`,
    `  const response = await run(0);`,
    `  return { response, rewriteUrl };`,
    `}`,
    ``,
  ].join('\n');

  return code;
}
