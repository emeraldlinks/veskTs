/**
 * Vesk Tailwind CSS plugin.
 * Scans .vsk files for class attributes, builds a purge-able content list,
 * runs the Tailwind CLI to generate the final CSS, and handles HMR rebuilds.
 * @module plugin-tailwind
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

interface GlobScanOptions {
  cwd?: string
  nodir?: boolean
}

const CLASS_RE = /class(?:\w+)?=["']([^"']*)["']/g

export interface TailwindOptions {
  entry?: string
  appDir?: string
}

const SCAN_EXT = /\.(vsk|js|ts|jsx|tsx)$/

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.vesk') continue
      out.push(...walkFiles(p))
    } else if (SCAN_EXT.test(name)) {
      out.push(p)
    }
  }
  return out
}

function scanCandidates(dir: string): string[] {
  const candidates = new Set<string>()
  const base = resolve(dir)
  if (!existsSync(base)) return []
  for (const file of walkFiles(base)) {
    try {
      const content = readFileSync(file, 'utf-8')
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

async function loadFallbackStylesheet(id: string, base: string): Promise<{ content: string; base: string }> {
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
  let cssPath: string | null = null
  if (pkg.style) {
    cssPath = path.resolve(pkgDir, pkg.style)
  } else if (pkg.exports?.['.']?.style) {
    cssPath = path.resolve(pkgDir, pkg.exports['.'].style)
  }
  if (cssPath === null) cssPath = path.resolve(pkgDir, 'index.css')
  if (!existsSync(cssPath)) throw new Error(`Cannot resolve stylesheet for package '${id}'`)
  const content = await readFile(cssPath, 'utf-8')
  return { content, base: path.dirname(cssPath) }
}

async function loadFallbackModule(id: string, base: string): Promise<{ module: unknown; base: string }> {
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

function extractTailwindDirectives(css: string): { directives: string; userCSS: string } {
  let tailwindLines: string[] = []
  let userLines: string[] = []
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

interface CompileOptions {
  base: string
  from: string
  onDependency: (path: string) => void
  loadStylesheet?: (id: string, base: string) => Promise<{ content: string; base: string }>
  loadModule?: (id: string, base: string) => Promise<{ module: unknown; base: string }>
}

interface CompileResult {
  build(candidates: string[]): string
}

interface TailwindCompile {
  (css: string, options: CompileOptions): Promise<CompileResult>
}

interface TailwindPlugin {
  name: string
  dependencies: Set<string>
  onBuildStart: () => Promise<void>
  onCSS: (content: string, filePath: string) => Promise<string | null>
  onFileWatch: (filePath: string) => Promise<{ handled: boolean }>
}

export default function tailwindcss(options: TailwindOptions = {}): TailwindPlugin {
  const entry = options.entry || 'src/global.css'
  const appDir = options.appDir || 'app'
  let compileReady: { compile: TailwindCompile; node: boolean } | null = null

  async function getCompile(): Promise<{ compile: TailwindCompile; node: boolean }> {
    if (compileReady) return compileReady
    try {
      const tw = await import('@tailwindcss/node')
      compileReady = { compile: tw.compile, node: true }
    } catch {
      const tw = await import('tailwindcss')
      compileReady = { compile: tw.compile as TailwindCompile, node: false }
    }
    return compileReady
  }

  return {
    name: '@vesk/plugin-tailwind',
    dependencies: new Set<string>(),

    async onBuildStart(): Promise<void> {
      this.dependencies = new Set<string>()
    },

    async onCSS(content: string, filePath: string): Promise<string | null> {
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
        const compileOpts: CompileOptions = {
          base: baseDir,
          from: entryPath,
          onDependency: (path: string) => {
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
        console.error(`[vesk/plugin-tailwind] Compile error:`, err instanceof Error ? err.message : String(err))
        return content
      }
    },

    async onFileWatch(filePath: string): Promise<{ handled: boolean }> {
      if (this.dependencies.has(filePath)) {
        return { handled: true }
      }
      return { handled: false }
    },
  }
}
