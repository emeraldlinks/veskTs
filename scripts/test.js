import { readdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawn } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Build packages (incremental — no-op when dist is fresh) before running tests.
execSync('npx tsx packages/cli/src/build-packages.ts', { cwd: root, stdio: 'inherit' })

const testDirs = [
  resolve(root, 'packages/compiler/src'),
  resolve(root, 'packages/runtime/src'),
  resolve(root, 'packages/adapter/src'),
  resolve(root, 'packages/plugin-tailwind/src'),
]

const e2eFiles = new Set([
  'code-split.test.ts',
  'hmr.test.ts',
  'hydration.test.ts',
  'panel-e2e.test.ts',
])

function runTestFile(filePath, env) {
  const output = execSync(`npx tsx "${filePath}"`, {
    encoding: 'utf-8',
    timeout: 240000,
    env: { ...process.env, ...env },
  })
  return output
}

let totalPassed = 0
let totalFailed = 0
let totalFiles = 0

// Phase 1: Unit tests (non-E2E)
for (const dir of testDirs) {
  if (!existsSync(dir)) continue
  const files = readdirSync(dir).filter(f => f.endsWith('.test.ts'))
  for (const file of files.sort()) {
    if (e2eFiles.has(file)) continue
    const filePath = resolve(dir, file)
    totalFiles++
    process.stdout.write(`${file} ... `)
    try {
      const output = runTestFile(filePath)
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
      console.log('ERROR')
      console.error(e.message.slice(0, 300))
      if (e.stdout) console.log(e.stdout.slice(-500))
    }
  }
}

// Phase 2: E2E tests (shared server)
console.log('\n── Starting E2E servers ──')
const e2eProcess = spawn('npx', ['tsx', 'scripts/e2e-setup.js'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '0' },
  detached: true, // own process group so shutdown can kill the whole tree
})

let e2eOutput = ''
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timeout waiting for E2E servers')), 60000)
  e2eProcess.stdout.on('data', (data) => {
    e2eOutput += data.toString()
    if (e2eOutput.includes('E2E_SERVERS_READY')) {
      clearTimeout(timeout)
      resolve()
    }
  })
  e2eProcess.stderr.on('data', (data) => {
    process.stderr.write(data)
  })
  e2eProcess.on('error', (err) => { clearTimeout(timeout); reject(err) })
})

try {
  await ready
  console.log('E2E servers ready\n')
} catch (e) {
  console.error('Failed to start E2E servers:', e.message)
  e2eProcess.kill()
  process.exit(1)
}

const e2eEnv = { VESK_E2E: '1', VESK_E2E_PROD_PORT: '3099', VESK_E2E_DEV_PORT: '3002' }

// Run adapter E2E tests
for (const dir of testDirs) {
  if (!existsSync(dir)) continue
  const files = readdirSync(dir).filter(f => f.endsWith('.test.ts'))
  for (const file of files.sort()) {
    if (!e2eFiles.has(file)) continue
    const filePath = resolve(dir, file)
    totalFiles++
    process.stdout.write(`${file} ... `)
    try {
      const output = runTestFile(filePath, e2eEnv)
      const match = output.match(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/)
      if (match) {
        const passed = parseInt(match[1])
        const failed = parseInt(match[2])
        totalPassed += passed
        totalFailed += failed
        if (failed > 0) {
          console.log(`FAIL (${failed} failure${failed > 1 ? 's' : ''})`)
          console.log(output)
        } else {
          console.log(`OK (${passed} tests)`)
        }
      } else {
        console.log('OK')
      }
    } catch (e) {
      totalFailed++
      console.log('ERROR')
      console.error(e.message.slice(0, 300))
      if (e.stdout) console.log(e.stdout.slice(-500))
    }
  }
}

// Run standalone tests/production-hydration-test.mjs (now in tests/)
const prodHydrationPath = resolve(root, 'tests', 'tests/production-hydration-test.mjs')
if (existsSync(prodHydrationPath)) {
  totalFiles++
  process.stdout.write('tests/production-hydration-test.mjs ... ')
  try {
    const output = runTestFile(prodHydrationPath, e2eEnv)
    const match = output.match(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/)
    if (match) {
      const passed = parseInt(match[1])
      const failed = parseInt(match[2])
      totalPassed += passed
      totalFailed += failed
      if (failed > 0) {
        console.log(`FAIL (${failed} failure${failed > 1 ? 's' : ''})`)
        console.log(output)
      } else {
        console.log(`OK (${passed} tests)`)
      }
    } else {
      console.log('OK')
    }
  } catch (e) {
    totalFailed++
    console.log('ERROR')
    console.error(e.message.slice(0, 300))
    if (e.stdout) console.log(e.stdout.slice(-500))
  }
}

// Run standalone tests/edge-test.mjs (now in tests/; after prod hydration — edge build overwrites .vesk)
const edgeTestPath = resolve(root, 'tests', 'tests/edge-test.mjs')
if (existsSync(edgeTestPath)) {
  totalFiles++
  process.stdout.write('tests/edge-test.mjs ... ')
  try {
    const output = runTestFile(edgeTestPath)
    const match = output.match(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/)
    if (match) {
      const passed = parseInt(match[1])
      const failed = parseInt(match[2])
      totalPassed += passed
      totalFailed += failed
      if (failed > 0) {
        console.log(`FAIL (${failed} failure${failed > 1 ? 's' : ''})`)
        console.log(output)
      } else {
        console.log(`OK (${passed} tests)`)
      }
    } else {
      console.log('OK')
    }
  } catch (e) {
    totalFailed++
    console.log('ERROR')
    console.error(e.message.slice(0, 300))
    if (e.stdout) console.log(e.stdout.slice(-500))
  }
}

console.error('\nShutting down E2E servers...')
// Kill the whole detached process group (npx → node → tsx chain), then wait
// until the dev port actually frees — downstream suites bind :3002.
try { process.kill(-e2eProcess.pid, 'SIGTERM') } catch { e2eProcess.kill('SIGTERM') }
const e2eDeadline = Date.now() + 15000
while (Date.now() < e2eDeadline) {
  let freed = false
  try { await fetch('http://localhost:3002/') } catch { freed = true }
  if (freed) break
  await new Promise(r => setTimeout(r, 250))
}

console.log(`\n==================================================`)
console.log(`Files: ${totalFiles} | Passed: ${totalPassed} | Failed: ${totalFailed} | Total: ${totalPassed + totalFailed}`)
console.log(`==================================================`)
process.exit(totalFailed > 0 ? 1 : 0)
