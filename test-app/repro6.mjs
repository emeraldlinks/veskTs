import { renderPage } from '@vesk/compiler/src/server-render'
import { readFileSync } from 'node:fs'
const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')

globalThis.fetch = async (url) => ({
  ok: true, status: 200,
  json: async () => ([{ id: 1, title: 'Hello Vesk', slug: 'hello-vesk', excerpt: 'e1', author: 'a', tags: ['t'], date: 'd' }]),
})

const realMapGet = Map.prototype.get
const realMapSet = Map.prototype.set
const log = (...a) => console.log(...a)
const cells = new Map()
Map.prototype.get = function (k) {
  const v = realMapGet.call(this, k)
  if (this === cells && typeof k === 'string' && k.includes('posts')) log('CELL GET', JSON.stringify(k), '->', v && JSON.stringify(v.v ?? v))
  return v
}
Map.prototype.set = function (k, v) {
  if (this === cells && typeof k === 'string' && k.includes('posts')) log('CELL SET', JSON.stringify(k), '->', v && JSON.stringify(v.v ?? v))
  return realMapSet.call(this, k, v)
}
globalThis.__vsk_ssr_cells = cells

// instrument promise tracking
let pk = null
Object.defineProperty(globalThis, '__vsk_ssr_promises', {
  get() { return pk },
  set(v) { log('PROMISES set to', v && v.length); pk = v },
})

const result = await renderPage(source, 'Posts', {}, new Map(), { hydrate: true })
console.log('BODY:', result.body)
Map.prototype.get = realMapGet
Map.prototype.set = realMapSet
