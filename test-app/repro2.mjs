import { parse } from '@vesk/compiler/src/parser'
import { generateIR } from '@vesk/compiler/src/ir-generator'
import { generateFunctionBody } from '@vesk/compiler/src/server-jsgen'
import { extractRuntimeNames, extractTopLevelNames, buildParamInit } from '@vesk/compiler/src/server-utils'
import { readFileSync } from 'node:fs'

const source = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
const ast = parse(source)
const ir = generateIR(ast, source)
const runtimeNames = extractRuntimeNames(ir.imports)
const importedNames = new Set(runtimeNames)
console.log('RUNTIME NAMES:', runtimeNames)
for (const comp of ir.components) {
  const bodyCode = generateFunctionBody(comp, importedNames)
  const paramInit = buildParamInit(comp.paramNames)
  console.log('\n==== ' + comp.name + ' ====')
  console.log(bodyCode)
}
