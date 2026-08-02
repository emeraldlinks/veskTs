import { readFileSync } from 'node:fs'
import { renderPage } from '@vesk/compiler/src/server-render'

const src = readFileSync('/root/vesk/test-app/app/page.vsk', 'utf8')
const res = await renderPage(src, 'Home', {}, new Map(), { hydrate: true })
const body = typeof res === 'string' ? res : res.body
console.log('BODY:', body.slice(0, 800))
