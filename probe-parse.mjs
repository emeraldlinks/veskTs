import { readFileSync } from 'fs'
import { parse } from '/root/vesk/packages/compiler/dist/index.js'

const file = '/root/vesk/vesk-doc/app/components/docs/DocsHeader.vsk'
const src = readFileSync(file, 'utf-8')
try {
  const ast = parse(src, { filename: file, sourceType: 'module', sourceFilename: file })
  console.log('parse OK — body statements:', ast.body.length)
  for (const s of ast.body) console.log(' -', s.type)
} catch (e) {
  console.error('PARSE ERROR:', e.message)
}