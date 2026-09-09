import { parse } from '/root/vesk/packages/compiler/dist/index.js'
const base = `/root/vesk/vesk-doc/app/components/docs/DocsHeader.vsk`
const cases = {
  'in-component track + single element': `component Foo {\n const &[open] = track(false)\n <div/>\n}`,
  'in-component track + frag': `component Foo {\n const &[open] = track(false)\n <> <div/> </>\n}`,
  'in-component track + if inside frag': `component Foo {\n const &[open] = track(false)\n <> <div/> if (open) { <span/> } </>\n}`,
  'bare track then element (no component)': `const &[open] = track(false)\n<div/>`,
  'bare track then if/else then frag': `const &[open] = track(false)\n<>\n<div/>\n</>`,
}
for (const [name, code] of Object.entries(cases)) {
  try {
    parse(code, { filename: base, sourceType: 'module' })
    console.log(`[ok]   ${name}`)
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`)
  }
}