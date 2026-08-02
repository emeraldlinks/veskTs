import { parse } from '@vesk/compiler/src/parser'
import { generateIR } from '@vesk/compiler/src/ir-generator'
import { buildComponentMap } from '@vesk/compiler/src/server-jsgen'
import { readFileSync } from 'node:fs'

const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
const ast = parse(source)
const ir = generateIR(ast, source)
console.log('IMPORTS:', ir.imports)
console.log('TOPLEVEL:', JSON.stringify(ir.topLevelCode, null, 1))
try {
  buildComponentMap(ir, true)
  console.log('OK')
} catch (e) {
  console.error('ERROR:', e.message)
}
