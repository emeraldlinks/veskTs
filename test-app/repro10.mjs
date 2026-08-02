import { renderPage } from '@vesk/compiler/src/server-render'
import { readFileSync } from 'node:fs'
const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ([{ id: 1, title: 'Hello Vesk', slug: 'hello-vesk', excerpt: 'e1', author: 'a', tags: ['t'], date: 'd' }]),
})
const origPAS = Promise.allSettled
Promise.allSettled = (arr) => { console.log('Promise.allSettled called with', arr.length); return origPAS(arr) }
globalThis.__vsk_ssr = true
const result = await renderPage(source, 'Posts', {}, new Map(), { hydrate: true })
console.log('BODY:', result.body)
