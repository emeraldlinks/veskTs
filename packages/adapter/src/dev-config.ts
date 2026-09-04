/**
 * Browser-config view of `vesk.config.{ts,js}` for the DevTools (B1).
 *
 * This is the Dev-Server-side bridge between the browser panel and the real
 * config file. It reads the config source + parses it (same transpile+inject
 * trick the CLI main entry uses), and writes back a validated source so an
 * invalid config never clobbers the file. `applyConfigToggle` edits a single
 * key in the `defineConfig({...})` object literal, preserving formatting.
 *
 * Path containment + validation are enforced here; the dev panel router
 * applies capability/permission checks before these are reachable.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { defineConfig, validateConfig, preset } from '@vesk/compiler/src/config';
import { parse as parseVsk } from '@vesk/compiler/src/parser';
import type { VeskConfig } from '@vesk/types';

export interface ConfigReadResult {
  path: string | null;
  exists: boolean;
  source: string;
  config: VeskConfig;
}

export interface ConfigFileInfo {
  path: string | null;
  isTs: boolean;
}

/** Locate the project's config file (vesk.config.ts preferred, then .js). */
export function findConfigFile(projectDir: string): ConfigFileInfo {
  const ts = resolve(projectDir, 'vesk.config.ts');
  if (existsSync(ts)) return { path: ts, isTs: true };
  const js = resolve(projectDir, 'vesk.config.js');
  if (existsSync(js)) return { path: js, isTs: false };
  return { path: null, isTs: false };
}

function resolveConfig(raw: VeskConfig): VeskConfig {
  const config = (typeof defineConfig === 'function' ? defineConfig(raw) : raw) as VeskConfig;
  if (typeof validateConfig === 'function') validateConfig(config);
  return config;
}

/**
 * Transpile+parse a config source into a validated VeskConfig. Shared by read
 * and write paths so they agree on what "valid" means. Host code is executed
 * in an isolated temp module so edits re-evaluate fresh on every call.
 */
export async function parseConfigSource(source: string, isTs: boolean, projectDir?: string): Promise<VeskConfig> {
  if (!source.trim()) return {};
  let js = source;
  if (isTs) {
    const { transpile } = (await import('typescript')) as { transpile: (src: string, opts: Record<string, number>) => string };
    js = transpile(source, { module: 99, target: 99 });
    js = js.replace(/import\s+\{[^}]*\}\s*from\s+['"]@vesk\/compiler['"]\s*;?\s*/g, '');
    js = `const { defineConfig, definePlugin, preset } = globalThis.__vesk_inject;\n` + js;
  }
  // Evaluate the config from a module rooted INSIDE the project (`.vesk/`) so
  // bare package imports in `vesk.config.ts` (e.g. `@vesk/plugin-tailwind`)
  // resolve against the project's `node_modules` rather than the OS temp dir.
  const base = projectDir
    ? (mkdirSync(join(projectDir, '.vesk'), { recursive: true }), join(projectDir, '.vesk'))
    : undefined;
  const dir = base ? mkdtempSync(join(base, 'cfg-')) : mkdtempSync(join(tmpdir(), 'vesk-cfg-'));
  const tmpFile = join(dir, 'config.mjs');
  try {
    writeFileSync(tmpFile, js, 'utf-8');
    (globalThis as Record<string, unknown>).__vesk_inject = {
      defineConfig,
      // Pass-through like the real definePlugin (which validates + returns
      // its argument): a stub returning {} would strip the plugin's `name`
      // and make validateConfig reject the file (GET /__vesk/config → 500).
      definePlugin: (p: unknown) => p,
      preset,
    };
    const mod = await import(`${tmpFile}?t=${Date.now()}`);
    const raw = (mod.default ?? mod) as VeskConfig | (() => VeskConfig);
    const cfg = (typeof raw === 'function' ? raw() : raw) as VeskConfig;
    return resolveConfig(cfg);
  } finally {
    delete (globalThis as Record<string, unknown>).__vesk_inject;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/** Read + parse the project config. Throws on an invalid config. */
export async function readConfig(projectDir: string): Promise<ConfigReadResult> {
  const { path, isTs } = findConfigFile(projectDir);
  if (!path) return { path: null, exists: false, source: '', config: {} };
  const source = readFileSync(path, 'utf-8');
  const config = await parseConfigSource(source, isTs, projectDir);
  return { path, exists: true, source, config };
}

/**
 * Write a full new config source back, after validation. Guarantees an invalid
 * config never clobbers the file (throws before writing).
 */
export async function writeConfigSource(projectDir: string, source: string): Promise<ConfigReadResult> {
  const { path, isTs } = findConfigFile(projectDir);
  const target = path || resolve(projectDir, 'vesk.config.ts');
  await parseConfigSource(source, isTs, projectDir); // validate BEFORE writing
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source, 'utf-8');
  const config = await parseConfigSource(source, isTs, projectDir);
  return { path: target, exists: true, source, config };
}

/**
 * Apply a single `key` → `value` toggle to a `vesk.config.ts` source by
 * editing the object literal passed to `defineConfig(...)`, preserving all
 * other formatting/comments. Returns the new source, or `null` when there is
 * no safe literal-edit point (caller falls back to the direct editor).
 */
export function applyConfigToggle(source: string, key: string, value: unknown): string | null {
  if (typeof key !== 'string' || !key) return null;
  if (/^[a-zA-Z_$][\w$]*$/.test(key) === false) return null;
  const marker = 'defineConfig(';
  const idx = source.indexOf(marker);
  if (idx === -1) return null;
  const openBrace = source.indexOf('{', idx + marker.length);
  if (openBrace === -1) return null;
  const end = findMatchingBrace(source, openBrace);
  if (end === -1) return null;
  const obj = tryParseJsObject(source.slice(openBrace + 1, end));
  if (obj === null) return null;
  obj[key] = normalizeDisplayValue(value);
  return source.slice(0, openBrace + 1) + serializeObject(obj) + source.slice(end);
}

/** Coerce UI-provided values to literal-safe JSON-ish equivalents. */
function normalizeDisplayValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.map(normalizeDisplayValue);
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) o[k] = normalizeDisplayValue((v as Record<string, unknown>)[k]);
    return o;
  }
  return String(v);
}

function findMatchingBrace(src: string, openIdx: number): number {
  let inStr: string | null = null;
  let esc = false;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function tryParseJsObject(src: string): Record<string, unknown> | null {
  let i = 0;
  const out: Record<string, unknown> = {};
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;
    const c = src[i];
    if (c === ',' || c === ';') { i++; continue; }
    const keyStart = i;
    let key: string;
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let k = '';
      while (j < src.length && (src[j] !== c || src[j - 1] === '\\')) { k += src[j]; j++; }
      key = k;
      i = j + 1;
    } else {
      while (i < src.length && !/[:=\s]/.test(src[i])) i++;
      key = src.slice(keyStart, i).trim();
    }
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === '=') return null; // `key = value` — not a literal object; bail
    if (src[i] !== ':') return null;
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    const val = parseLiteralValue(src, i);
    if (val === null || val.__invalid) return null;
    out[key.replace(/^["'`]|["'`]$/g, '')] = val.value;
    i = val.next;
  }
  return out;
}

function parseLiteralValue(src: string, i: number): { value: unknown; next: number; __invalid?: boolean } | null {
  const c = src[i];
  if (c === undefined) return null;
  if (c === '{') {
    const end = findMatchingBrace(src, i);
    if (end === -1) return { value: undefined, next: i, __invalid: true };
    const obj = tryParseJsObject(src.slice(i + 1, end));
    if (obj === null) return { value: undefined, next: i, __invalid: true };
    return { value: obj, next: end + 1 };
  }
  if (c === '[') {
    const vals: unknown[] = [];
    let j = i + 1;
    while (j < src.length) {
      while (j < src.length && /\s/.test(src[j])) j++;
      const cc = src[j];
      if (cc === ']') { j++; break; }
      if (cc === ',') { j++; continue; }
      const r = parseLiteralValue(src, j);
      if (r === null || r.__invalid) return { value: undefined, next: i, __invalid: true };
      vals.push(r.value);
      j = r.next;
    }
    return { value: vals, next: j };
  }
  if (c === '"' || c === "'" || c === '`') {
    const q = c;
    let j = i + 1;
    let s = '';
    while (j < src.length && (src[j] !== q || src[j - 1] === '\\')) { s += src[j]; j++; }
    return { value: s, next: j + 1 };
  }
  let j = i;
  while (j < src.length && /[\w.\-]/.test(src[j])) j++;
  const token = src.slice(i, j);
  if (token === 'true') return { value: true, next: j };
  if (token === 'false') return { value: false, next: j };
  if (token === 'null') return { value: null, next: j };
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)) return { value: Number(token), next: j };
  return { value: undefined, next: i, __invalid: true };
}

function serializeObject(obj: Record<string, unknown>): string {
  return Object.keys(obj)
    .map((k) => `${isBareKey(k) ? k : JSON.stringify(k)}: ${serializeValue(obj[k])}`)
    .join(', ');
}

function isBareKey(k: string): boolean {
  return /^[a-zA-Z_$][\w$]*$/.test(k);
}

function serializeValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(serializeValue).join(', ') + ']';
  if (typeof v === 'object') return '{ ' + serializeObject(v as Record<string, unknown>) + ' }';
  return String(v);
}

// ─── vesk.config.ts plugin import / plugins[] surgical editors ─────────────

/** Derive a safe import identifier for a package spec. `importNameForPackage('@vesk/plugin-tailwind')` -> `tailwindcss` (known) else `myPlugin` etc. */
export function importNameForPackage(pkg: string): string {
  if (pkg === '@vesk/plugin-tailwind') return 'tailwindcss';
  const last = (pkg.split('/').pop() || pkg).replace(/^plugin-/, '');
  const parts = last.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return 'plugin';
  const camel = parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join('');
  let name = camel.replace(/[^A-Za-z0-9_$]/g, '');
  if (!name) name = 'plugin';
  if (!/^[A-Za-z_$]/.test(name)) name = '_' + name;
  // avoid reserved-ish
  if (/^(import|export|default|const|let|var)$/.test(name)) name = name + 'Plugin';
  return name;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── AST helpers (acorn + tsPlugin) — preferred over regex for syntax analysis ─

function parseAstOrNull(source: string): any | null {
  try {
    // `parseVsk` is the compiler's base parser (acorn + TypeScript + Vesk JSX).
    // It handles plain TS/JS config files as well as Vesk syntax, and reports
    // ranges/locs needed for surgical edits.
    return parseVsk(source, { sourceType: 'module' } as any);
  } catch {
    return null;
  }
}

function findLastImportEnd(src: string): number {
  const ast = parseAstOrNull(src);
  if (ast && Array.isArray((ast as any).body)) {
    let last = -1;
    for (const node of (ast as any).body) {
      if (node.type === 'ImportDeclaration' && typeof node.end === 'number') {
        let end: number = node.end;
        // include trailing semicolon already in `end`, then one line break
        if (end < src.length && src[end] === '\r' && src[end + 1] === '\n') end += 2;
        else if (end < src.length && (src[end] === '\n' || src[end] === '\r')) end += 1;
        else if (end < src.length && src[end] === ';') {
          end += 1;
          if (src[end] === '\r' && src[end + 1] === '\n') end += 2;
          else if (src[end] === '\n') end += 1;
        }
        if (end > last) last = end;
      }
    }
    if (last !== -1) return last;
  }
  // fallback: line scan without regex
  let last = -1;
  let idx = 0;
  while (idx < src.length) {
    const nl = src.indexOf('\n', idx);
    const lineEnd = nl === -1 ? src.length : nl + 1;
    const line = src.slice(idx, lineEnd);
    const t = line.trim();
    if (t.startsWith('import ') && t.includes(' from ') && (t.includes("'") || t.includes('"'))) {
      last = lineEnd;
    }
    if (nl === -1) break;
    idx = lineEnd;
  }
  return last;
}

function findMatchingBracket(src: string, openIdx: number, openChar = '[', closeChar = ']'): number {
  let inStr: string | null = null;
  let esc = false;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findPluginImportAst(src: string, pkg: string): { name: string; start: number; end: number } | null {
  const ast = parseAstOrNull(src);
  if (!ast) return null;
  for (const node of (ast as any).body) {
    if (node.type === 'ImportDeclaration' && node.source && node.source.value === pkg) {
      const spec = node.specifiers && node.specifiers[0];
      if (spec && spec.type === 'ImportDefaultSpecifier' && spec.local && typeof spec.local.name === 'string') {
        return { name: spec.local.name, start: node.start, end: node.end };
      }
      // `import { foo } from 'pkg'` or `import * as foo`
      if (spec && spec.local && typeof spec.local.name === 'string') {
        return { name: spec.local.name, start: node.start, end: node.end };
      }
    }
  }
  return null;
}

function findPluginsArrayBounds(src: string): { open: number; close: number; objOpen: number; objClose: number } | null {
  const ast = parseAstOrNull(src);
  if (ast) {
    for (const node of (ast as any).body) {
      if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
        let decl: any = node.declaration;
        let obj: any = null;
        if (decl.type === 'CallExpression' && decl.callee && decl.callee.type === 'Identifier' && decl.callee.name === 'defineConfig' && decl.arguments && decl.arguments.length > 0) {
          const arg = decl.arguments[0];
          if (arg && arg.type === 'ObjectExpression') obj = arg;
          else if (arg && arg.type === 'ArrowFunctionExpression' && arg.body && arg.body.type === 'ObjectExpression') obj = arg.body;
        }
        if (!obj && decl.type === 'ObjectExpression') obj = decl;
        if (!obj || !Array.isArray(obj.properties)) continue;
        for (const prop of obj.properties) {
          if (prop.type !== 'Property') continue;
          const key: any = prop.key;
          const keyName = key.type === 'Identifier' ? key.name : key.type === 'Literal' ? key.value : null;
          if (keyName === 'plugins' && prop.value && prop.value.type === 'ArrayExpression') {
            const arr: any = prop.value;
            const open: number = arr.start;
            const close: number = arr.end - 1;
            const objOpen: number = (obj as any).start;
            const objClose: number = (obj as any).end - 1;
            // acorn `start` is at `[` and `end` after `]`, but we need indices of brackets
            // verify they indeed point to brackets; adjust if needed
            const realOpen = src.indexOf('[', open);
            const realClose = src.lastIndexOf(']', arr.end - 1);
            return { open: realOpen !== -1 ? realOpen : open, close: realClose !== -1 ? realClose : close, objOpen, objClose };
          }
        }
        if (obj) {
          const objOpen: number = (obj as any).start;
          const objClose: number = (obj as any).end - 1;
          // plugins not present but object exists -> caller will insert new property
          // signal with open=-1
          return { open: -1, close: -1, objOpen, objClose } as any;
        }
      }
    }
  }
  // fallback to string scan (no AST or no defineConfig)
  const marker = 'defineConfig(';
  const idx = src.indexOf(marker);
  if (idx === -1) return null;
  const objOpen = src.indexOf('{', idx + marker.length);
  if (objOpen === -1) return null;
  const objClose = findMatchingBrace(src, objOpen);
  if (objClose === -1) return null;
  const objContentStart = objOpen + 1;
  const objContentEnd = objClose;
  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  for (let i = objContentStart; i < objContentEnd; ) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; i++; continue; }
      if (c === '\\') { esc = true; i++; continue; }
      if (c === inStr) inStr = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? objContentEnd : nl + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? objContentEnd : end + 2;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth === 0 && src.slice(i, i + 7) === 'plugins') {
      const after = src[i + 7];
      if (after && /[A-Za-z0-9_$]/.test(after)) { i += 7; continue; }
      let j = i + 7;
      while (j < objContentEnd && /\s/.test(src[j])) j++;
      if (src[j] !== ':') { i = j + 1; continue; }
      j++;
      while (j < objContentEnd && /\s/.test(src[j])) j++;
      if (src[j] !== '[') { i = j + 1; continue; }
      const open = j;
      const close = findMatchingBracket(src, open, '[', ']');
      if (close === -1 || close > objClose) return null;
      return { open, close, objOpen, objClose };
    }
    i++;
  }
  return null;
}

function insertIntoPluginsArray(source: string, entryCall: string): string {
  // AST path: check if entry already present via AST
  const ast = parseAstOrNull(source);
  if (ast) {
    for (const node of (ast as any).body) {
      if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
        let decl: any = node.declaration;
        let obj: any = null;
        if (decl.type === 'CallExpression' && decl.callee && decl.callee.type === 'Identifier' && decl.callee.name === 'defineConfig' && decl.arguments[0] && decl.arguments[0].type === 'ObjectExpression') obj = decl.arguments[0];
        if (!obj && decl.type === 'ObjectExpression') obj = decl;
        if (obj) {
          for (const prop of obj.properties) {
            if (prop.type === 'Property') {
              const k: any = prop.key;
              const kn = k.type === 'Identifier' ? k.name : k.type === 'Literal' ? k.value : null;
              if (kn === 'plugins' && prop.value && prop.value.type === 'ArrayExpression') {
                const arr: any = prop.value;
                const importName = entryCall.split('(')[0].trim();
                for (const el of arr.elements) {
                  if (!el) continue;
                  const txt = source.slice(el.start, el.end);
                  if (txt.includes(importName)) return source;
                  if (el.type === 'Identifier' && el.name === importName) return source;
                  if (el.type === 'CallExpression' && el.callee && el.callee.type === 'Identifier' && el.callee.name === importName) return source;
                }
                const open: number = arr.start;
                const close: number = arr.end - 1;
                const inner = source.slice(open + 1, close);
                if (inner.trim() === '') {
                  return source.slice(0, open + 1) + '\n\t\t' + entryCall + '\n\t' + source.slice(close);
                }
                const lastEl: any = arr.elements[arr.elements.length - 1];
                const between = source.slice(lastEl.end, close);
                const needsComma = !between.includes(',');
                const before = source.slice(0, close);
                const after = source.slice(close);
                const sep = needsComma ? ',' : '';
                return before.replace(/\s*$/, '') + sep + '\n\t\t' + entryCall + '\n\t' + after;
              }
            }
          }
          // no plugins property -> insert via AST object bounds
          const objOpen: number = (obj as any).start;
          const objClose: number = (obj as any).end - 1;
          const beforeClose = source.slice(0, objClose);
          const afterClose = source.slice(objClose);
          const objInner = source.slice(objOpen + 1, objClose).trim();
          const prefix = objInner ? ',' : '';
          return beforeClose.replace(/\s*$/, '') + prefix + '\n\tplugins: [\n\t\t' + entryCall + '\n\t]\n' + afterClose;
        }
      }
    }
  }
  const bounds = findPluginsArrayBounds(source);
  if (bounds && (bounds as any).open !== -1) {
    const { open, close } = bounds as any;
    const inner = source.slice(open + 1, close);
    const importName = entryCall.split('(')[0].trim();
    if (importName && inner.includes(importName)) return source;
    if (inner.trim() === '') {
      return source.slice(0, open + 1) + '\n\t\t' + entryCall + '\n\t' + source.slice(close);
    }
    const trimmedRight = inner.replace(/\s+$/, '');
    const needsComma = !/,\s*$/.test(inner) && trimmedRight.length > 0;
    const before = source.slice(0, close);
    const after = source.slice(close);
    const sep = needsComma ? ',' : '';
    return before.replace(/\s*$/, '') + sep + '\n\t\t' + entryCall + '\n\t' + after;
  }
  if (bounds) {
    const { objOpen, objClose } = bounds as any;
    const beforeClose = source.slice(0, objClose);
    const afterClose = source.slice(objClose);
    const objInner = source.slice(objOpen + 1, objClose).trim();
    const prefix = objInner ? ',' : '';
    return beforeClose.replace(/\s*$/, '') + prefix + '\n\tplugins: [\n\t\t' + entryCall + '\n\t]\n' + afterClose;
  }
  const marker = 'defineConfig(';
  const idx = source.indexOf(marker);
  if (idx === -1) return source;
  const objOpen2 = source.indexOf('{', idx + marker.length);
  if (objOpen2 === -1) return source;
  const objClose2 = findMatchingBrace(source, objOpen2);
  if (objClose2 === -1) return source;
  const beforeClose2 = source.slice(0, objClose2);
  const afterClose2 = source.slice(objClose2);
  const objInner2 = source.slice(objOpen2 + 1, objClose2).trim();
  const prefix2 = objInner2 ? ',' : '';
  return beforeClose2.replace(/\s*$/, '') + prefix2 + '\n\tplugins: [\n\t\t' + entryCall + '\n\t]\n' + afterClose2;
}

function removeFromPluginsArray(source: string, importName: string): string {
  const ast = parseAstOrNull(source);
  if (ast) {
    for (const node of (ast as any).body) {
      if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
        let decl: any = node.declaration;
        let obj: any = null;
        if (decl.type === 'CallExpression' && decl.callee && decl.callee.type === 'Identifier' && decl.callee.name === 'defineConfig' && decl.arguments[0] && decl.arguments[0].type === 'ObjectExpression') obj = decl.arguments[0];
        if (!obj && decl.type === 'ObjectExpression') obj = decl;
        if (!obj) continue;
        for (const prop of obj.properties) {
          if (prop.type !== 'Property') continue;
          const k: any = prop.key;
          const kn = k.type === 'Identifier' ? k.name : k.type === 'Literal' ? k.value : null;
          if (kn === 'plugins' && prop.value && prop.value.type === 'ArrayExpression') {
            const arr: any = prop.value;
            const kept: any[] = [];
            let foundIdx = -1;
            for (let i = 0; i < arr.elements.length; i++) {
              const el: any = arr.elements[i];
              if (!el) continue;
              const txt = source.slice(el.start, el.end);
              const isTarget = txt.includes(importName) || (el.type === 'Identifier' && el.name === importName) || (el.type === 'CallExpression' && el.callee && el.callee.type === 'Identifier' && el.callee.name === importName);
              if (isTarget) foundIdx = i;
              else kept.push(el);
            }
            if (foundIdx === -1) return source;
            const open: number = arr.start;
            const close: number = arr.end - 1;
            let newInner: string;
            if (kept.length === 0) newInner = '';
            else newInner = '\n\t\t' + kept.map((e: any) => source.slice(e.start, e.end).trim()).join(',\n\t\t') + '\n\t';
            return source.slice(0, open + 1) + newInner + source.slice(close);
          }
        }
      }
    }
  }
  const bounds = findPluginsArrayBounds(source);
  if (!bounds || (bounds as any).open === -1) return source;
  const { open, close } = bounds as any;
  let inner = source.slice(open + 1, close);
  if (!inner.includes(importName)) return source;
  const entries: Array<{ start: number; end: number; text: string }> = [];
  let lastSplit = 0;
  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && inner[i + 1] === '/') {
      const nl = inner.indexOf('\n', i);
      i = nl === -1 ? inner.length : nl;
      continue;
    }
    if (c === '/' && inner[i + 1] === '*') {
      const end = inner.indexOf('*/', i + 2);
      i = end === -1 ? inner.length : end + 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      entries.push({ start: lastSplit, end: i, text: inner.slice(lastSplit, i) });
      lastSplit = i + 1;
    }
  }
  entries.push({ start: lastSplit, end: inner.length, text: inner.slice(lastSplit) });
  let targetIdx = -1;
  for (let i = 0; i < entries.length; i++) if (entries[i].text.includes(importName)) { targetIdx = i; break; }
  if (targetIdx === -1) return source;
  const kept2 = entries.filter((_, idx) => idx !== targetIdx).map(e => e.text).filter(t => t.trim() !== '');
  let newInner2: string;
  if (kept2.length === 0) newInner2 = '';
  else newInner2 = '\n\t\t' + kept2.map(t => t.trim()).join(',\n\t\t') + '\n\t';
  return source.slice(0, open + 1) + newInner2 + source.slice(close);
}

function hasIdentifierAst(source: string, name: string): boolean {
  const ast = parseAstOrNull(source);
  if (!ast) return source.includes(name);
  let found = false;
  function walk(node: any): void {
    if (!node || typeof node !== 'object' || found) return;
    if (node.type === 'Identifier' && node.name === name) { found = true; return; }
    for (const k of Object.keys(node)) {
      const v = (node as any)[k];
      if (Array.isArray(v)) for (const el of v) walk(el);
      else if (v && typeof v.type === 'string') walk(v);
    }
  }
  walk(ast);
  return found;
}

/**
 * Surgically add a plugin import + `plugins: [...]` entry to `vesk.config.ts`.
 * Idempotent - no duplicate import/entry if already present. Validates via
 * `parseConfigSource` before writing so an invalid file is never clobbered.
 * Uses AST for all syntax analysis (no regex for import/plugins detection).
 */
export async function addPluginToConfig(projectDir: string, pkg: string): Promise<void> {
  const { path, isTs } = findConfigFile(projectDir);
  let target = path;
  let source: string;
  if (!path) {
    const importName = importNameForPackage(pkg);
    const entry = pkg === '@vesk/plugin-tailwind' ? `${importName}({ entry: 'src/global.css', appDir: 'app' })` : `${importName}()`;
    source = `import { defineConfig } from '@vesk/compiler'\nimport ${importName} from '${pkg}'\n\nexport default defineConfig({\n\tplugins: [\n\t\t${entry}\n\t]\n})\n`;
    target = resolve(projectDir, 'vesk.config.ts');
    await writeConfigSource(projectDir, source);
    return;
  }
  source = readFileSync(path, 'utf-8');
  const existingImport = findPluginImportAst(source, pkg);
  let importName: string;
  if (existingImport) {
    importName = existingImport.name;
    // check if plugins array already contains it (AST)
    const ast = parseAstOrNull(source);
    if (ast) {
      for (const node of (ast as any).body) {
        if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
          let decl: any = node.declaration;
          let obj: any = null;
          if (decl.type === 'CallExpression' && decl.callee && decl.callee.type === 'Identifier' && decl.callee.name === 'defineConfig' && decl.arguments[0] && decl.arguments[0].type === 'ObjectExpression') obj = decl.arguments[0];
          if (!obj && decl.type === 'ObjectExpression') obj = decl;
          if (obj) {
            for (const prop of obj.properties) {
              if (prop.type === 'Property') {
                const k: any = prop.key;
                const kn = k.type === 'Identifier' ? k.name : k.type === 'Literal' ? k.value : null;
                if (kn === 'plugins' && prop.value && prop.value.type === 'ArrayExpression') {
                  for (const el of prop.value.elements) {
                    if (!el) continue;
                    const txt = source.slice(el.start, el.end);
                    if (txt.includes(importName) || (el.type === 'Identifier' && el.name === importName) || (el.type === 'CallExpression' && el.callee && el.callee.type === 'Identifier' && el.callee.name === importName)) return;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      const bounds = findPluginsArrayBounds(source);
      if (bounds && (bounds as any).open !== -1) {
        const inner = source.slice((bounds as any).open + 1, (bounds as any).close);
        if (inner.includes(importName)) return;
      }
    }
  } else {
    importName = importNameForPackage(pkg);
    if (pkg === '@vesk/plugin-tailwind' && importName === 'tailwind') importName = 'tailwindcss';
    let base = importName;
    let n = 1;
    while (hasIdentifierAst(source, base)) {
      if (findPluginImportAst(source, pkg)) break;
      base = `${importName}${n++}`;
      if (n > 20) break;
    }
    if (base !== importName) importName = base;
    const importLine = `import ${importName} from '${pkg}'\n`;
    const lastImportEnd = findLastImportEnd(source);
    if (lastImportEnd !== -1) {
      source = source.slice(0, lastImportEnd) + importLine + source.slice(lastImportEnd);
    } else {
      const expIdx = source.indexOf('export default');
      if (expIdx !== -1) source = source.slice(0, expIdx) + importLine + '\n' + source.slice(expIdx);
      else source = importLine + source;
    }
  }
  const entry = pkg === '@vesk/plugin-tailwind' ? `${importName}({ entry: 'src/global.css', appDir: 'app' })` : `${importName}()`;
  const newSource = insertIntoPluginsArray(source, entry);
  if (newSource === source) return;
  await writeConfigSource(projectDir, newSource);
}

/**
 * Surgically remove a plugin's import and its `plugins: [...]` entry.
 * Returns true if file was changed. Uses AST for import/plugins detection.
 */
export async function removePluginFromConfig(projectDir: string, pkg: string): Promise<boolean> {
  const { path } = findConfigFile(projectDir);
  if (!path) return false;
  let source = readFileSync(path, 'utf-8');
  const original = source;
  const existingImport = findPluginImportAst(source, pkg);
  let importName: string | null = existingImport ? existingImport.name : null;
  if (!importName) importName = importNameForPackage(pkg);
  if (pkg === '@vesk/plugin-tailwind' && !existingImport) {
    const alt = findPluginImportAst(source, '@vesk/plugin-tailwind');
    if (alt) importName = alt.name;
  }
  // remove import via AST range
  if (existingImport) {
    source = source.slice(0, existingImport.start) + source.slice(existingImport.end);
    // trim one following newline if present to avoid double blank line
    if (source[existingImport.start] === '\n' && source[existingImport.start - 1] === '\n') {
      // keep single
    }
  } else {
    // fallback: no AST node but pkg string present (e.g. comment) - try string replace as last resort
    const fallbackRe = new RegExp(`^[ \\t]*import\\s+\\w+\\s+from\\s+['"]${escapeRegExp(pkg)}['"]\\s*;?\\s*\\n?`, 'm');
    source = source.replace(fallbackRe, '');
  }
  if (importName) {
    const maybeNew = removeFromPluginsArray(source, importName);
    if (maybeNew === source && pkg === '@vesk/plugin-tailwind' && importName === 'tailwind') {
      const alt2 = removeFromPluginsArray(source, 'tailwindcss');
      if (alt2 !== source) source = alt2;
    } else {
      source = maybeNew;
    }
  }
  source = source.replace(/\n{3,}/g, '\n\n');
  if (source === original) return false;
  await writeConfigSource(projectDir, source);
  return true;
}
