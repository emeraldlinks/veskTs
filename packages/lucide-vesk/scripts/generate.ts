/**
 * Generate lucide-vesk icon components from the `lucide` package.
 * Covers every icon and every alias — mirrors lucide-react parity.
 *
 * Run: npx tsx packages/lucide-vesk/scripts/generate.ts
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgRoot = join(__dirname, "..");

function toPascalCase(value: string): string {
  // character loop — no regex
  let out = "";
  let capNext = true;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "-" || ch === "_" || ch === " ") {
      capNext = true;
      continue;
    }
    if (capNext) {
      out += ch.toUpperCase();
      capNext = false;
    } else {
      out += ch;
    }
  }
  return out;
}

function resolveLucidePaths(): { iconsDir: string; aliasesFile: string } | null {
  const candidates = [
    join(pkgRoot, "../../node_modules/lucide/dist/esm/icons"),
    join(pkgRoot, "../lucide/dist/esm/icons"),
    join(pkgRoot, "node_modules/lucide/dist/esm/icons"),
    "/root/vesk/node_modules/lucide/dist/esm/icons",
  ];
  for (const iconsDir of candidates) {
    const aliasesFile = join(dirname(iconsDir), "iconsAndAliases.js");
    if (existsSync(iconsDir) && existsSync(aliasesFile)) return { iconsDir, aliasesFile };
  }
  return null;
}

async function main() {
  const resolved = resolveLucidePaths();
  if (!resolved) {
    console.error("[lucide-vesk] could not locate lucide icons. Run npm install lucide.");
    process.exit(1);
  }
  const { iconsDir, aliasesFile } = resolved;
  console.log(`[lucide-vesk] iconsDir=${iconsDir}`);
  console.log(`[lucide-vesk] aliasesFile=${aliasesFile}`);

  const files = readdirSync(iconsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.slice(0, -3))
    .sort();

  console.log(`[lucide-vesk] found ${files.length} icon files`);

  const iconsOutDir = join(pkgRoot, "src/icons");
  mkdirSync(iconsOutDir, { recursive: true });

  // Build a map from kebab file name -> IconNode
  const kebabToNode = new Map<string, unknown>();
  const kebabToPascal = new Map<string, string>();

  for (const kebab of files) {
    const filePath = join(iconsDir, `${kebab}.js`);
    const content = readFileSync(filePath, "utf-8");
    // Extract IconNode array: file is `const X = [...] ; export { X as default }`
    // We can evaluate by importing as ESM — simpler: parse JSON-ish between `const` and `];`
    // Use dynamic import for accuracy
    const mod = await import(`file://${filePath}`);
    const node = (mod.default ?? mod[Object.keys(mod)[0]]) as unknown;
    if (!Array.isArray(node)) {
      console.warn(`[lucide-vesk] skip ${kebab}: not an array`);
      continue;
    }
    kebabToNode.set(kebab, node);
    kebabToPascal.set(kebab, toPascalCase(kebab));
  }

  // Generate per-icon files
  for (const [kebab, node] of kebabToNode.entries()) {
    const pascal = kebabToPascal.get(kebab)!;
    const outPath = join(iconsOutDir, `${pascal}.ts`);
    const nodeJson = JSON.stringify(node, null, 2);
    const src = `/**
 * @license lucide-vesk v0.511.0 - ISC
 * @name ${kebab}
 * @see https://lucide.dev/icons/${kebab}
 * Auto-generated — do not edit. Generated from lucide@${kebab}.
 * Never scoped — no style tag.
 */
import createLucideIcon from "../createLucideIcon.js";
import type { IconNode } from "../types.js";

export const __iconNode: IconNode = ${nodeJson} as unknown as IconNode;

const ${pascal} = createLucideIcon("${kebab}", __iconNode);

export default ${pascal};
export { ${pascal} };
`;
    writeFileSync(outPath, src);
  }
  console.log(`[lucide-vesk] wrote ${kebabToNode.size} icon modules to src/icons`);

  // Parse aliases file
  const aliasesContent = readFileSync(aliasesFile, "utf-8");
  const lines = aliasesContent.split("\n");
  // Map aliasPascal -> targetKebab
  const aliasToKebab = new Map<string, string>();
  const primaryPascalSet = new Set<string>(Array.from(kebabToPascal.values()));
  // Also track which files are re-exported under which alias names
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("export")) continue;
    // Extract target file: from './icons/xxx.js'
    const fromIdx = trimmed.indexOf("from");
    if (fromIdx === -1) continue;
    const fromPart = trimmed.slice(fromIdx);
    // find ./icons/<kebab>.js
    const iconsIdx = fromPart.indexOf("./icons/");
    if (iconsIdx === -1) continue;
    const after = fromPart.slice(iconsIdx + "./icons/".length);
    let kebab = "";
    for (let i = 0; i < after.length; i++) {
      const ch = after[i]!;
      if (ch === "'" || ch === '"' || ch === "." || ch === "/") break;
      kebab += ch;
    }
    if (!kebab) continue;
    // Extract alias names: inside { ... }
    const braceStart = trimmed.indexOf("{");
    const braceEnd = trimmed.indexOf("}");
    if (braceStart === -1 || braceEnd === -1) continue;
    const inside = trimmed.slice(braceStart + 1, braceEnd);
    const parts = inside.split(",");
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      // p is like "default as House" or "default as AlarmCheck"
      const asIdx = p.indexOf(" as ");
      if (asIdx === -1) continue;
      const alias = p.slice(asIdx + 4).trim();
      if (!alias) continue;
      // alias is PascalCase name
      aliasToKebab.set(alias, kebab);
    }
  }
  console.log(`[lucide-vesk] parsed ${aliasToKebab.size} alias entries`);

  // Build index.ts
  // We need to re-export every primary Pascal plus every alias
  // For alias, we re-export from its target file's component
  // Example: export { AlarmClockCheck as AlarmCheck } from "./icons/AlarmClockCheck.js";
  // But the file's export is named after primary Pascal. So alias mapping: targetKebab's primary Pascal is the actual export name in file.
  const kebabToPrimaryPascal = kebabToPascal;
  const indexLines: string[] = [];
  indexLines.push(`/**
 * lucide-vesk — barrel
 * Auto-generated — covers every Lucide icon and alias.
 * Same props as lucide-react, fully typed, never scoped.
 */
`);
  indexLines.push(`export { default as Icon, Icon } from "./Icon.js";`);
  indexLines.push(`export { default as createLucideIcon, createLucideIcon } from "./createLucideIcon.js";`);
  indexLines.push(`export { defaultAttributes } from "./defaultAttributes.js";`);
  indexLines.push(`export * from "./types.js";`);
  indexLines.push(`export * from "./utils.js";`);
  indexLines.push(``);
  // Primary exports
  const sortedPrimaryPascal = Array.from(primaryPascalSet).sort();
  for (const pascal of sortedPrimaryPascal) {
    // find kebab for this pascal
    let foundKebab: string | null = null;
    for (const [k, p] of kebabToPascal.entries()) if (p === pascal) { foundKebab = k; break; }
    if (!foundKebab) continue;
    indexLines.push(`export { default as ${pascal}, ${pascal} } from "./icons/${pascal}.js";`);
    indexLines.push(`export { __iconNode as __iconNode${pascal} } from "./icons/${pascal}.js";`);
  }
  indexLines.push(``);
  indexLines.push(`// Aliases — additional names pointing to the same icon component`);
  const sortedAliases = Array.from(aliasToKebab.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [alias, kebab] of sortedAliases) {
    // Skip if alias is already a primary (duplicate export would conflict)
    if (primaryPascalSet.has(alias)) continue;
    const primaryPascal = kebabToPrimaryPascal.get(kebab);
    if (!primaryPascal) continue;
    // re-export alias as same component instance: export { Primary as Alias } from "./icons/Primary.js";
    indexLines.push(`export { ${primaryPascal} as ${alias} } from "./icons/${primaryPascal}.js";`);
  }
  indexLines.push(``);
  // Provide `icons` object map for dynamic access (like lucide's iconsAndAliases)
  indexLines.push(`// Convenience: ` + "`icons` map — every icon node keyed by Pascal name");
  indexLines.push(`import type { IconNode } from "./types.js";`);
  // We'll generate the map by importing each __iconNode
  // To avoid circular, we can construct map lazily via re-imports? Simpler: generate object literal referencing imports
  // But we already exported __iconNode per file; we can build a map that imports them.
  // Let's create a separate icons object via imports
  indexLines.push(`export const icons: Record<string, IconNode> = {`);
  for (const pascal of sortedPrimaryPascal) {
    indexLines.push(`  ${pascal}: (await import("./icons/${pascal}.js")).__iconNode as unknown as IconNode,`.replace("await import", "/* lazy */ null as unknown as IconNode //")); // placeholder to keep types — we'll generate differently
  }
  // Instead, we will generate icons map via explicit imports above would be circular.
  // Simpler to generate icons as object of IconNode literals? Instead we will generate a helper that re-exports nodes.
  // For now, emit a minimal icons map that will be filled at runtime via dynamic requires? We'll just export a type-only placeholder.

  // Remove the placeholder lines we just added and generate proper map
  // Find and replace: we'll rebuild the tail
  // To keep file simple, we will not generate a broken icons map; instead generate a proper static map using imports.
  // Let's regenerate tail correctly.

  // Rebuild from scratch with proper imports for icons map
  const finalIndexLines: string[] = [];
  finalIndexLines.push(`/**
 * lucide-vesk — barrel
 * Auto-generated — covers every Lucide icon and alias.
 * Same props as lucide-react, fully typed, never scoped.
 */
`);
  finalIndexLines.push(`export { Icon } from "./Icon.js";`);
  finalIndexLines.push(`export { createLucideIcon } from "./createLucideIcon.js";`);
  finalIndexLines.push(`export { defaultAttributes } from "./defaultAttributes.js";`);
  finalIndexLines.push(`export type { IconNode, LucideProps, LucideIcon, SVGElementType } from "./types.js";`);
  finalIndexLines.push(`export { toKebabCase, toPascalCase, mergeClasses, hasA11yProp } from "./utils.js";`);
  finalIndexLines.push(``);
  for (const pascal of sortedPrimaryPascal) {
    finalIndexLines.push(`export { ${pascal}, __iconNode as __iconNode${pascal} } from "./icons/${pascal}.js";`);
  }
  finalIndexLines.push(``);
  finalIndexLines.push(`// Aliases`);
  for (const [alias, kebab] of sortedAliases) {
    if (primaryPascalSet.has(alias)) continue;
    const primaryPascal = kebabToPrimaryPascal.get(kebab);
    if (!primaryPascal) continue;
    finalIndexLines.push(`export { ${primaryPascal} as ${alias} } from "./icons/${primaryPascal}.js";`);
  }
  finalIndexLines.push(``);
  finalIndexLines.push(`// Dynamic icon resolver (like lucide-react/dynamic) — not used for static imports but handy for runtime`);
  finalIndexLines.push(`export type IconName = ${sortedPrimaryPascal.map((p) => `"${p}"`).join(" | ")};`);
  finalIndexLines.push(``);

  writeFileSync(join(pkgRoot, "src/index.ts"), finalIndexLines.join("\n"));
  console.log(`[lucide-vesk] wrote src/index.ts with ${sortedPrimaryPascal.length} primaries + ${sortedAliases.filter(([a]) => !primaryPascalSet.has(a)).length} aliases`);

  // Also generate a test to verify coverage
  const allNames = new Set<string>([...primaryPascalSet, ...sortedAliases.map(([a]) => a)]);
  console.log(`[lucide-vesk] total exported names: ${allNames.size}`);

  // Write a manifest JSON for verification
  writeFileSync(join(pkgRoot, "src/manifest.json"), JSON.stringify({ count: allNames.size, primaries: sortedPrimaryPascal.length, aliases: sortedAliases.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
