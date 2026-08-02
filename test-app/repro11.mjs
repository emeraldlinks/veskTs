import { parse } from '@vesk/compiler/src/parser'
import { generateIR } from '@vesk/compiler/src/ir-generator'
import { buildComponentMap } from '@vesk/compiler/src/server-jsgen'
import { readFileSync } from 'node:fs'
const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
const ir = generateIR(parse(source), source)
for (const c of ir.components) console.log(c.name, 'isAsync:', c.isAsync, 'ssrAwait:', c.ssrAwait)
const componentMap = buildComponentMap(ir, true)
const fn = componentMap.get('Posts')
const lines = fn.toString().split('\n')
lines.forEach((l, i) => console.log(String(i + 1).padStart(3), l))
