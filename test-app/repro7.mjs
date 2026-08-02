import { parse } from '@vesk/compiler/src/parser'
import { generateIR } from '@vesk/compiler/src/ir-generator'
import { buildComponentMap } from '@vesk/compiler/src/server-jsgen'
import { readFileSync } from 'node:fs'
const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
const ast = parse(source)
const ir = generateIR(ast, source)
const componentMap = buildComponentMap(ir, true)
const fn = componentMap.get('Posts')
console.log(fn.toString())
