import { readdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const testDirs = [
  resolve(root, 'packages/compiler/src'),
  resolve(root, 'packages/runtime/src'),
  resolve(root, 'packages/adapter/src'),
]

let totalPassed = 0
let totalFailed = 0
let totalFiles = 0

for (const dir of testDirs) {
  if (!existsSync(dir)) continue
  const files = readdirSync(dir).filter(f => f.endsWith('.test.js'))
  for (const file of files.sort()) {
    const filePath = resolve(dir, file)
    totalFiles++
    process.stdout.write(`${file} ... `)
    try {
      const output = execSync(`node --experimental-vm-modules "${filePath}"`, {
        encoding: 'utf-8',
        timeout: 120000,
      })
      const match = output.match(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/)
      if (match) {
        const passed = parseInt(match[1])
        const failed = parseInt(match[2])
        totalPassed += passed
        totalFailed += failed
        if (failed > 0) {
          console.log(`FAIL (${failed} failure${failed > 1 ? 's' : ''})`)
          console.log(output.split('\n').slice(-10).join('\n'))
        } else {
          console.log(`OK (${passed} tests)`)
        }
      } else {
        console.log(`OK (no Results line, checking output)`)
        console.log(output.slice(-200))
      }
    } catch (e) {
      totalFailed++
      console.log(`ERROR`)
      console.error(e.message.slice(0, 300))
      if (e.stdout) console.log(e.stdout.slice(-500))
    }
  }
}

console.log(`\n==================================================`)
console.log(`Files: ${totalFiles} | Passed: ${totalPassed} | Failed: ${totalFailed} | Total: ${totalPassed + totalFailed}`)
console.log(`==================================================`)
process.exit(totalFailed > 0 ? 1 : 0)
