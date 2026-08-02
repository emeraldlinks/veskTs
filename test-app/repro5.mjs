import { parse } from '@vesk/compiler/src/parser'
import { generateIR } from '@vesk/compiler/src/ir-generator'
import { buildComponentMap } from '@vesk/compiler/src/server-jsgen'
import { loadRuntimeImports } from '@vesk/compiler/src/server-utils'
import { readFileSync } from 'node:fs'

const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
globalThis.__vsk_ssr = true
globalThis.fetch = async (url) => ({
  ok: true, status: 200,
  json: async () => ([{ id: 1, title: 'Hello Vesk', slug: 'hello-vesk', excerpt: 'e1', author: 'a', tags: ['t'], date: 'd' }]),
})

const ast = parse(source)
const ir = generateIR(ast, source)
const componentMap = buildComponentMap(ir, true)
const base = loadRuntimeImports(ir.imports)
const get = base.get
base.get = (c) => {
  const v = get(c)
  console.log('  get(' + (c && c.f !== undefined ? 'cell' : typeof c) + ') =', JSON.stringify(v))
  return v
}
const renderFn = componentMap.get('Posts')
console.log('promises key:', 'globalThis.__vsk_ssr_promises exists:', !!globalThis.__vsk_ssr_promises)
const out = await renderFn({}, componentMap, base)
console.log('after render, promises list:', (globalThis.__vsk_ssr_promises || []).length)
console.log('OUTPUT:', out.slice(0, 300))
