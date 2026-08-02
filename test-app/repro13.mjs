import { readFileSync } from 'node:fs'
import { compileClient } from '@vesk/compiler/src/client-codegen'

const src = readFileSync('/root/vesk/test-app/app/posts/page.vsk', 'utf8')
const compCode = compileClient(src, null, { forceClient: true })
const lines = compCode.split('\n').filter(l => /export/.test(l))
console.log('EXPORT LINES:')
for (const l of lines) console.log('  [' + l + ']')

const stripped = compCode
  .replace(/^import\s*\{[^}]*\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm, '')
  .replace(/const\s+__components\s*=\s*\{\};\s*\n?/g, '')
  .replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, '')
  .replace(/^export\s+default\s+__components\[.*?\];?\s*\n?/gm, '')
  .replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '')
console.log('AFTER STRIP export-default:', (stripped.match(/export default/g) || []).length)
