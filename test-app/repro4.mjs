import { renderPage } from '@vesk/compiler/src/server-render'
import { readFileSync } from 'node:fs'
const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
globalThis.__vsk_ssr = true
globalThis.fetch = async (url) => {
  if (String(url).includes('/api/posts')) {
    return { ok: true, status: 200, json: async () => ([
      { id: 1, title: 'Hello Vesk', slug: 'hello-vesk', excerpt: 'e1', author: 'a', tags: ['t'], date: 'd' },
    ]) }
  }
  throw new Error('no route ' + url)
}
const result = await renderPage(source, 'Posts', {}, new Map(), { hydrate: true })
console.log('LENGTH:', result.body.length)
console.log(result.body)
