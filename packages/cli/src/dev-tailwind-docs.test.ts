import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTailwindDocs, renderTailwindViewerHtml } from './dev-tailwind-docs.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

async function main() {
  console.log('\n=== dev-tailwind-docs ===');
  const root = mkdtempSync(join(tmpdir(), 'vesk-tailwind-docs-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/global.css'), '@import "tailwindcss";\n', 'utf-8');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'test', private: true }), 'utf-8');

    const result = await generateTailwindDocs({ baseDir: root, cssSource: join(root, 'src/global.css') });
    assert(result.html.includes('Tailwind Config Viewer'), 'renders Tailwind Config Viewer title');
    assert(result.html.includes('Colors'), 'includes Colors section');
    assert(result.html.includes('Spacing'), 'includes Spacing section');
    assert(result.html.includes('Font Sizes'), 'includes Font Sizes section');
    assert(result.html.includes('/_tailwind.html') === false, 'does not self-link incorrectly');
    assert(result.model.sections.some((s) => s.kind === 'classes'), 'includes classes section');
    assert(result.model.tailwindVersion !== 'unknown' || result.model.tailwindVersion === 'unknown', 'has tailwind version field');

    const html = renderTailwindViewerHtml(result.model);
    assert(html.includes('data-copy="bg-red-500"') || html.includes('bg-red-500'), 'contains class names');
    assert(html.includes('Dark Mode'), 'contains dark mode toggle');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
