import { renderPage } from '@vesk/compiler/src/server-render'
import { readFileSync } from 'node:fs'

const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')

globalThis.__vsk_ssr = true
globalThis.fetch = async (url) => {
  if (String(url).includes('/api/posts')) {
    return { ok: true, status: 200, statusText: 'OK', json: async () => ([
      { id: 1, title: 'Hello Vesk', slug: 'hello-vesk', excerpt: 'e1', author: 'a', tags: ['t'], date: 'd' },
    ]) }
  }
  throw new Error('no route ' + url)
}

try {
  const result = await renderPage(source, 'Posts', {}, new Map(), { hydrate: true })
  console.log('RENDER OK')
  console.log(result.body.slice(0, 500))
} catch (e) {
  console.log('ERROR:', e.message)
  console.log(e.stack.split('\n').slice(0, 8).join('\n'))
  const cells = globalThis.__vsk_ssr_cells
  if (cells) for (const [k, v] of cells) console.log('CELL', JSON.stringify(k), JSON.stringify(v))
}
