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

export default function tailwindcss(options = {}) {
  const entry = options.entry || 'src/global.css'
  let compileFn = null

  async function getCompile() {
    if (!compileFn) {
      const tw = await import('@tailwindcss/node')
      compileFn = tw.compile
    }
    return compileFn
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

      try {
        const compile = await getCompile()
        const result = await compile(content, {
          base: baseDir,
          onDependency: (path) => {
            if (path) this.dependencies.add(path)
          }
        })

        const candidates = scanCandidates(resolve(baseDir, 'app'))
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
