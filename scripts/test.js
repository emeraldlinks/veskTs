import { readdirSync, existsSync, statSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawn, spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Build packages (incremental — no-op when dist is fresh) before running tests.
execSync('npx tsx packages/cli/src/build-packages.ts', { cwd: root, stdio: 'inherit' })

const testDirs = [
  resolve(root, 'packages/compiler/src'),
  resolve(root, 'packages/runtime/src'),
  resolve(root, 'packages/adapter/src'),
  resolve(root, 'packages/plugin-pwa/src'),
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

// Test files report in three shapes, and the harness has to read all of them
// or it silently drops a file's assertions from the totals:
//   `Results: 12 passed, 0 failed, 12 total`
//   `module-imports: 41 passed, 0 failed`
//   `59 passing, 0 failing`
// A file that prints no counts at all (some suites print per-case PASS lines)
// still counts as passing when it exits 0 — execSync throws otherwise — so
// this returns null and the caller reports the file without a count.
function parseCounts(output) {
  const m =
    output.match(/Results:\s*(\d+)\s*pass(?:ed|ing),\s*(\d+)\s*fail(?:ed|ing)/) ||
    output.match(/(\d+)\s*pass(?:ed|ing),\s*(\d+)\s*fail(?:ed|ing)/)
  if (!m) return null
  return { passed: parseInt(m[1], 10), failed: parseInt(m[2], 10) }
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
      const counts = parseCounts(output)
      if (counts) {
        const passed = counts.passed
        const failed = counts.failed
        totalPassed += passed
        totalFailed += failed
        if (failed > 0) {
          console.log(`FAIL (${failed} failure${failed > 1 ? 's' : ''})`)
          console.log(output.split('\n').slice(-10).join('\n'))
        } else {
          console.log(`OK (${passed} tests)`)
        }
      } else {
        // No counts, but the file exited 0: some suites report per-case PASS
        // lines only (plugin-pwa). The count is simply unavailable.
        console.log('OK (no count line)')
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
  // 60s was measured against one fast machine and left no headroom: the setup
  // builds the app twice (production ~25s, dev ~25s) before the first request
  // can be served, so a slower box timed out here and killed the whole suite
  // before a single assertion ran.
  const timeout = setTimeout(() => reject(new Error('Timeout waiting for E2E servers')), 300000)
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

// Resolve a chromium binary for the puppeteer E2E tests. Only falls back to
// the legacy Termux path (the port of the original dev box) when nothing else
// is present; on CI/desktop the puppeteer cache or PATH binaries are used.
function resolveChromium(explicit) {
  if (explicit) return explicit // hand back the explicit path (bad or good)
  const home = process.env.HOME || '/root'
  const dirs = [
    resolve(root, 'node_modules', 'puppeteer', '.local-chromium'),
    resolve(home, '.cache', 'puppeteer', 'chrome'),
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const rev of readdirSync(dir)) {
      const cand = resolve(dir, rev)
      if (!existsSync(cand) || !isDirSync(cand)) {
        // puppeteer cache feeds revision dirs directly; .local-chromium feeds rev/chrome-*
        continue
      }
      for (const sub of readdirSync(cand)) {
        const bin = resolve(cand, sub, 'chrome')
        if (existsSync(bin)) return bin
      }
    }
  }
  return '/data/data/com.termux/files/usr/bin/chromium-browser'
}

function isDirSync(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

// The E2E phase can be pointed at an external server and browser by setting
// VESK_E2E_BASE, VESK_E2E_PROD_PORT, VESK_E2E_DEV_PORT, or CHROMIUM_PATH.
// When a base is given, the e2e-setup server is still started on the default
// ports so VESK_E2E=1 tests that build their own server keep working; the
// latent base is passed through for tests that honor it (e.g. hydration-test).
console.log(`E2E chromium: ${process.env.CHROMIUM_PATH || resolveChromium(process.env.CHROMIUM_PATH)}`)
const e2eEnv = Object.assign(
  {
    VESK_E2E: '1',
    VESK_E2E_PROD_PORT: process.env.VESK_E2E_PROD_PORT || '3099',
    VESK_E2E_DEV_PORT: process.env.VESK_E2E_DEV_PORT || '3002',
  },
  process.env.CHROMIUM_PATH
    ? { CHROMIUM_PATH: process.env.CHROMIUM_PATH }
    : { CHROMIUM_PATH: resolveChromium(process.env.CHROMIUM_PATH) },
  process.env.BASE ? { BASE: process.env.BASE } : {}
)

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
      const counts = parseCounts(output)
      if (counts) {
        const passed = counts.passed
        const failed = counts.failed
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

// Client-bundle budget: a ratchet on the emitted JS. Nothing else in the suite
// notices a dependency that quietly adds 200 KB, and the build has already been
// caught quietly getting 8x slower.
{
  const budgetScript = resolve(root, 'scripts/asset-budget.mjs')
  const buildDir = resolve(root, 'test-app', '.vesk', 'e2e')
  totalFiles++
  process.stdout.write('scripts/asset-budget.mjs ... ')
  if (!existsSync(buildDir)) {
    console.log('SKIP (no e2e build)')
  } else {
    const res = spawnSync('node', [budgetScript, buildDir], { cwd: root, encoding: 'utf-8' })
    process.stdout.write(res.status === 0 ? 'OK' : `FAIL\n${res.stdout || ''}${res.stderr || ''}`)
    if (res.status !== 0) totalFailed++
  }
}

// Run tests/ssr-handoff-concurrency-test.mjs: the SSR data handoff under 48
// concurrent requests, on both servers. Runs before the browser suites because
// it is fast and it catches the request-scope regressions those suites can only
// see as a client-side refetch.
const handoffPath = resolve(root, 'tests', 'ssr-handoff-concurrency-test.mjs')
if (existsSync(handoffPath)) {
  totalFiles++
  process.stdout.write('tests/ssr-handoff-concurrency-test.mjs ... ')
  try {
    const output = runTestFile(handoffPath, e2eEnv)
    const counts = parseCounts(output)
    if (counts) {
      const passed = counts.passed
      const failed = counts.failed
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

// Run standalone tests/production-hydration-test.mjs (now in tests/)
const prodHydrationPath = resolve(root, 'tests', 'production-hydration-test.mjs')
if (existsSync(prodHydrationPath)) {
  totalFiles++
  process.stdout.write('tests/production-hydration-test.mjs ... ')
  try {
    const output = runTestFile(prodHydrationPath, e2eEnv)
    const counts = parseCounts(output)
    if (counts) {
      const passed = counts.passed
      const failed = counts.failed
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
const edgeTestPath = resolve(root, 'tests', 'edge-test.mjs')
if (existsSync(edgeTestPath)) {
  totalFiles++
  process.stdout.write('tests/edge-test.mjs ... ')
  try {
    const output = runTestFile(edgeTestPath)
    const counts = parseCounts(output)
    if (counts) {
      const passed = counts.passed
      const failed = counts.failed
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
