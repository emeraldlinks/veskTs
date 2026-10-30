import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MiddlewareChainItem, MiddlewareExtractResult } from '@vesk/adapter/src/types';
import { extractMiddlewareParts } from '@vesk/compiler/src/router';

function extractMiddlewareBody(src: string): MiddlewareExtractResult | null {
  const parts = extractMiddlewareParts(src);
  if (!parts) return null;
  return { params: parts.params, body: parts.body };
}

export function compileMiddleware(mwChain: MiddlewareChainItem[], _appDir: string): string | null {
  if (mwChain.length === 0) return null;

  const parts: string[] = [];
  for (let i = 0; i < mwChain.length; i++) {
    const { sourcePath } = mwChain[i];
    const src = readFileSync(sourcePath, 'utf-8');
    const extracted = extractMiddlewareBody(src);
    if (!extracted) continue;
    parts.push(`async function mw_${i}(${extracted.params}) {\n${extracted.body}\n}`);
  }

  if (parts.length === 0) return null;

  const code = [
    '// Auto-generated middleware chain — do not edit',
    '',
    parts.join('\n\n'),
    '',
    `const chain = [${parts.map((_, i) => `mw_${i}`).join(', ')}];`,
    '',
    'export async function execute(ctx) {',
    '  let rewriteUrl = null;',
    '  async function run(index) {',
    '    if (index >= chain.length) return null;',
    '    const fn = chain[index];',
    '    let nextCalled = false;',
    '    let nextResult = null;',
    '    async function next(rewrite) {',
    '      if (nextCalled) return null;',
    '      nextCalled = true;',
    '      if (rewrite) rewriteUrl = rewrite;',
    '      nextResult = await run(index + 1);',
    '      return nextResult;',
    '    }',
    '    try {',
    '      const result = await fn(ctx, next);',
    '      if (result instanceof Response) return result;',
    '      if (nextResult instanceof Response) return nextResult;',
    '      if (!nextCalled) return run(index + 1);',
    '      return null;',
    '    } catch (e) {',
    '      if (e && typeof e === \'object\' && e.name === \'Redirect\') {',
    '        return new Response(null, {',
    '          status: Number(e.status) || 302,',
    '          headers: { Location: String(e.url || \'\') },',
    '        });',
    '      }',
    '      if (e instanceof TypeError && /Failed to parse URL from/.test(String(e.message))) {',
    '        const msg = String(e.message);',
    '        const prefix = \'Failed to parse URL from \';',
    '        const start = msg.indexOf(prefix);',
    '        const target = start === -1 ? \'\' : msg.slice(start + prefix.length).trim().split(\' \')[0];',
    '        return new Response(null, { status: 302, headers: { Location: target } });',
    '      }',
    '      // Any other TypeError from the middleware (e.g. reading a property of',
    '      // `undefined` like `ctx.cookies[SESSION_COOKIE]` when `ctx.cookies` is',
    '      // missing) must not crash the server. On serverless platforms (Vercel,',
    '      // Netlify, Cloudflare) an uncaught throw surfaces as',
    '      // FUNCTION_INVOCATION_FAILED — Next.js avoids this by wrapping entry',
    '      // points the same way. Return a 500 instead.',
    '      if (e instanceof TypeError) {',
    '        return new Response(null, { status: 500 });',
    '      }',
    '      throw e;',
    '    }',
    '  }',
    '  let response = null;',
    '  try {',
    '    response = await run(0);',
    '  } catch (e) {',
    '    // Unexpected middleware errors must not crash the server. On serverless',
    '    // platforms (Vercel, Netlify, Cloudflare) an uncaught throw surfaces as',
    '    // FUNCTION_INVOCATION_FAILED — Next.js avoids this by wrapping entry',
    '    // points the same way. Convert it into a 500 response.',
    '    response = new Response(null, { status: 500 });',
    '  }',
    '  return { response, rewriteUrl };',
    '}',
    '',
  ].join('\n');

  return code;
}

export function compileMiddlewareCode(mwSourceTexts: string[]): string | null {
  if (!mwSourceTexts || mwSourceTexts.length === 0) return null;

  const parts: string[] = [];
  for (let i = 0; i < mwSourceTexts.length; i++) {
    const extracted = extractMiddlewareBody(mwSourceTexts[i]);
    if (!extracted) continue;
    parts.push(`async function mw_${i}(${extracted.params}) {\n${extracted.body}\n}`);
  }

  if (parts.length === 0) return null;

  const code = [
    '// ── Middleware chain (inline) ──',
    '',
    parts.join('\n\n'),
    '',
    `const __mwChain = [${parts.map((_, i) => `mw_${i}`).join(', ')}];`,
    '',
    'async function __executeMw(ctx) {',
    '  let rewriteUrl = null;',
    '  async function run(index) {',
    '    if (index >= __mwChain.length) return null;',
    '    const fn = __mwChain[index];',
    '    let nc = false;',
    '    let ncResult = null;',
    '    async function next(rewrite) {',
    '      if (nc) return null;',
    '      nc = true;',
    '      if (rewrite) rewriteUrl = rewrite;',
    '      ncResult = await run(index + 1);',
    '      return ncResult;',
    '    }',
    '    try {',
    '      const result = await fn(ctx, next);',
    '      if (result instanceof Response) return result;',
    '      if (ncResult instanceof Response) return ncResult;',
    '      if (!nc) return run(index + 1);',
    '      return null;',
    '    } catch (e) {',
    '      if (e && typeof e === \'object\' && e.name === \'Redirect\') {',
    '        return new Response(null, {',
    '          status: Number(e.status) || 302,',
    '          headers: { Location: String(e.url || \'\') },',
    '        });',
    '      }',
    '      if (e instanceof TypeError && /Failed to parse URL from/.test(String(e.message))) {',
    '        const msg = String(e.message);',
    '        const prefix = \'Failed to parse URL from \';',
    '        const start = msg.indexOf(prefix);',
    '        const target = start === -1 ? \'\' : msg.slice(start + prefix.length).trim().split(\' \')[0];',
    '        return new Response(null, { status: 302, headers: { Location: target } });',
    '      }',
    '      // Any other TypeError from the middleware (e.g. reading a property of',
    '      // `undefined` like `ctx.cookies[SESSION_COOKIE]` when `ctx.cookies` is',
    '      // missing) must not crash the server. On serverless platforms (Vercel,',
    '      // Netlify, Cloudflare) an uncaught throw surfaces as',
    '      // FUNCTION_INVOCATION_FAILED — Next.js avoids this by wrapping entry',
    '      // points the same way. Return a 500 instead.',
    '      if (e instanceof TypeError) {',
    '        return new Response(null, { status: 500 });',
    '      }',
    '      throw e;',
    '    }',
    '  }',
    '  let response = null;',
    '  try {',
    '    response = await run(0);',
    '  } catch (e) {',
    '    // Unexpected middleware errors must not crash the server. On serverless',
    '    // platforms (Vercel, Netlify, Cloudflare) an uncaught throw surfaces as',
    '    // FUNCTION_INVOCATION_FAILED — Next.js avoids this by wrapping entry',
    '    // points the same way. Convert it into a 500 response.',
    '    response = new Response(null, { status: 500 });',
    '  }',
    '  return { response, rewriteUrl };',
    '}',
    '',
  ].join('\n');

  return code;
}
