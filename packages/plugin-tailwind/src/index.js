/**
 * Vesk Tailwind CSS plugin.
 * Scans .vsk files for class attributes, builds a purge-able content list,
 * runs the Tailwind CLI to generate the final CSS, and handles HMR rebuilds.
 * @module plugin-tailwind
 */

import { readFileSync, existsSync, globSync } from 'fs'
import { resolve } from 'path'

const CLASS_RE = /class(?:\w+)?=["']([^"']*)["']/g

function scanCandidates(dir) {
  const candidates = new Set()
  const base = resolve(dir)
  if (!existsSync(base)) return []
  const files = globSync('**/*.{vsk,js,ts,jsx,tsx}', { cwd: base, nodir: true })
  for (const file of files) {
    try {
      const content = readFileSync(resolve(base, file), 'utf-8')
      let match
      while ((match = CLASS_RE.exec(content)) !== null) {
        const classes = match[1].split(/\s+/)
        for (const cls of classes) {
          if (cls && cls.length > 1 && !cls.startsWith('{') && !cls.startsWith('}')) {
            candidates.add(cls)
          }
        }
      }
    } catch {}
  }
  return [...candidates]
}

async function loadFallbackStylesheet(id, base) {
  const { readFile } = await import('fs/promises')
  const path = await import('path')
  const { createRequire } = await import('module')
  if (id.startsWith('.')) {
    const p = path.resolve(base, id)
    const content = await readFile(p, 'utf-8')
    return { content, base: path.dirname(p) }
  }
  const req = createRequire(path.join(base, 'noop.mjs'))
  const pkgJson = req.resolve(id + '/package.json')
  const pkgDir = path.dirname(pkgJson)
  const pkg = JSON.parse(await readFile(pkgJson, 'utf-8'))
  let cssPath = null
  if (pkg.style) {
    cssPath = path.resolve(pkgDir, pkg.style)
  } else if (pkg.exports?.['.']?.style) {
    cssPath = path.resolve(pkgDir, pkg.exports['.'].style)
  } else {
    cssPath = path.resolve(pkgDir, 'index.css')
  }
  if (!existsSync(cssPath)) throw new Error(`Cannot resolve stylesheet for package '${id}'`)
  const content = await readFile(cssPath, 'utf-8')
  return { content, base: path.dirname(cssPath) }
}

async function loadFallbackModule(id, base) {
  const path = await import('path')
  const { createRequire } = await import('module')
  if (id.startsWith('.')) {
    const p = path.resolve(base, id)
    const mod = await import(p)
    return { module: mod.default ?? mod, base: path.dirname(p) }
  }
  const req = createRequire(path.join(base, 'noop.mjs'))
  const pkgPath = req.resolve(id)
  const mod = await import(pkgPath)
  return { module: mod.default ?? mod, base: path.dirname(pkgPath) }
}

const TAILWIND_BLOCK = /^\s*@(theme\s*\{|layer\s+(base|components|utilities)\s*\{|utility\s+\w+\s*\{)/m

function extractTailwindDirectives(css) {
  let tailwindLines = []
  let userLines = []
  let i = 0
  const lines = css.split('\n')

  while (i < lines.length) {
    const trimmed = lines[i].trim()

    const isImport = trimmed.startsWith('@import') && trimmed.includes('tailwindcss')
    const isSource = trimmed.startsWith('@source ')
    const isBlockStart = TAILWIND_BLOCK.test(trimmed)

    if (isImport || isSource || isBlockStart) {
      if (isImport || isSource) {
        tailwindLines.push(lines[i])
        i++
        continue
      }
      const blockStart = i
      let braceCount = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length
      i++
      while (i < lines.length && braceCount > 0) {
        braceCount += (lines[i].match(/\{/g) || []).length
        braceCount -= (lines[i].match(/\}/g) || []).length
        i++
      }
      tailwindLines.push(lines.slice(blockStart, i).join('\n'))
      continue
    }

    userLines.push(lines[i])
    i++
  }

  return {
    directives: tailwindLines.join('\n').trim(),
    userCSS: userLines.join('\n').trim(),
  }
}

export { extractTailwindDirectives }

export default function tailwindcss(options = {}) {
  const entry = options.entry || 'src/global.css'
  const appDir = options.appDir || 'app'
  let compileReady = null

  async function getCompile() {
    if (compileReady) return compileReady
    try {
      const tw = await import('@tailwindcss/node')
      compileReady = { compile: tw.compile, node: true }
    } catch {
      const tw = await import('tailwindcss')
      compileReady = { compile: tw.compile, node: false }
    }
    return compileReady
  }

  return {
    name: '@vesk/plugin-tailwind',
    dependencies: new Set(),

    async onBuildStart() {
      this.dependencies = new Set()
    },

    async onCSS(content, filePath) {
      const baseDir = process.cwd()
      const entryPath = resolve(baseDir, entry)
      const resolvedFilePath = filePath ? resolve(baseDir, filePath) : ''
      if (resolvedFilePath !== entryPath && !(filePath && filePath.endsWith(entry.replace(/^\.\//, '')))) {
        return null
      }

      const { directives } = extractTailwindDirectives(content)
      if (!directives) return content

      try {
        const { compile, node } = await getCompile()
        const compileOpts = {
          base: baseDir,
          from: entryPath,
          onDependency: (path) => {
            if (path) this.dependencies.add(path)
          },
        }
        if (!node) {
          compileOpts.loadStylesheet = (id, base) => loadFallbackStylesheet(id, base)
          compileOpts.loadModule = (id, base) => loadFallbackModule(id, base)
        }
        const result = await compile(directives, compileOpts)

        const candidates = scanCandidates(baseDir)
        const finalCss = result.build(candidates)
        return finalCss
      } catch (err) {
        console.error(`[vesk/plugin-tailwind] Compile error:`, err.message)
        return content
      }
    },

    async onFileWatch(filePath) {
      if (this.dependencies.has(filePath)) {
        return { handled: true }
      }
      return { handled: false }
    },
  }
}
