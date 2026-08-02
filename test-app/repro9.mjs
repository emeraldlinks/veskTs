import { renderPage } from '@vesk/compiler/src/server-render'
import { readFileSync } from 'node:fs'
const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ([{ id: 1, title: 'Hello Vesk', slug: 'hello-vesk', excerpt: 'e1', author: 'a', tags: ['t'], date: 'd' }]),
})
// log promise-array activity via getters
const keyAccess = {}
for (const k of ['__vsk_ssr_promises', '__vsk_ssr_promises_']) {
  Object.defineProperty(globalThis, k, { get() { return keyAccess[k] }, set(v) { console.log('SET', k, 'len', v && v.length); keyAccess[k] = v } })
}
const cells = new Map()
globalThis.__vsk_ssr_cells = cells
// wrap array methods to log
const wrapArr = (name) => (arr) => new Proxy(arr, {
  get(t, p) {
    if (p === 'push') return (...a) => { console.log('PUSH', name, a.length); return t.push(...a) }
    if (p === 'slice') return (...a) => { const r = t.slice(...a); console.log('SLICE', name, r.length); return r }
    return t[p]
  },
  set(t, p, v) { if (p === 'length') console.log('SETLEN', name, v); t[p] = v; return true },
})
const result = await renderPage(source, 'Posts', {}, new Map(), { hydrate: true })
console.log('BODY:', result.body)
