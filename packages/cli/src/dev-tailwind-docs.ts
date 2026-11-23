import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

type ThemeEntry = { value: unknown; options?: number };
export type DesignSystem = {
  theme: { entries: () => Iterable<[string, ThemeEntry]>; prefix: string | null };
  getClassList: () => Array<[string, { modifiers: string[] }]>;
  candidatesToCss: (candidates: string[]) => Array<string | null>;
};

export type TailwindViewerSection = {
  id: string;
  title: string;
  kind: 'colors' | 'spacing' | 'fontSizes' | 'fontFamilies' | 'fontWeights' | 'letterSpacing' | 'lineHeights' | 'screens' | 'borderRadius' | 'shadows' | 'width' | 'minWidth' | 'maxWidth' | 'height' | 'minHeight' | 'maxHeight' | 'opacity' | 'borderWidth' | 'zIndex' | 'transitions' | 'aspectRatio' | 'blur' | 'dropShadow' | 'animations' | 'scale' | 'rotate' | 'classes';
  data: unknown;
};

export type TailwindExample = {
  title: string;
  description: string;
  classes: string;
  html: string;
  tip?: string;
};

export type TailwindViewerModel = {
  tailwindVersion: string;
  prefix: string;
  sections: TailwindViewerSection[];
  examples: TailwindExample[];
  classCss: Record<string, string>;
  generatedAt: string;
};

export type TailwindDocsResult = { html: string; model: TailwindViewerModel };

type LoadOptions = { baseDir: string; cssSource?: string };

const DEFAULT_TYPOGRAPHY_EXAMPLE = 'The quick brown fox jumps over the lazy dog';

function readPackageVersion(pkgName: string, fromDir: string): string {
  const req = createRequire(pathToFileURL(resolve(fromDir, 'package.json')).href);
  try {
    const pkgPath = req.resolve(`${pkgName}/package.json`);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function findTailwindBase(fromDir: string): string {
  const attempts = [fromDir, process.cwd(), resolve(fromDir, 'node_modules/@vesk/plugin-tailwind')];
  for (const base of attempts) {
    try {
      const req = createRequire(pathToFileURL(resolve(base, 'package.json')).href);
      req.resolve('tailwindcss/package.json');
      return base;
    } catch {}
  }
  return fromDir;
}

function resolveTailwindNode(fromDir: string): { load: (css: string, opts: { base: string }) => Promise<DesignSystem> } {
  const attempts = [fromDir, process.cwd(), resolve(fromDir, 'node_modules/@vesk/plugin-tailwind')];
  let lastErr: unknown;
  for (const base of attempts) {
    try {
      const req = createRequire(pathToFileURL(resolve(base, 'package.json')).href);
      const modPath = req.resolve('@tailwindcss/node');
      return { load: async (css, opts) => {
        const mod = await import(pathToFileURL(modPath).href) as { __unstable__loadDesignSystem: (css: string, opts: { base: string }) => Promise<DesignSystem> };
        return mod.__unstable__loadDesignSystem(css, opts);
      } };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function normalizeThemeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(normalizeThemeValue).join(', ');
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return normalizeThemeValue((value as Record<string, unknown>).value);
  }
  return String(value ?? '');
}

function themeByNamespace(ds: DesignSystem): Map<string, Array<[string, string]>> {
  const map = new Map<string, Array<[string, string]>>();
  for (const [key, entry] of ds.theme.entries()) {
    if (!key.startsWith('--')) continue;
    const body = key.slice(2);
    const idx = body.indexOf('-');
    const ns = idx === -1 ? body : body.slice(0, idx);
    const name = idx === -1 ? 'DEFAULT' : body.slice(idx + 1);
    const arr = map.get(ns) || [];
    arr.push([name, normalizeThemeValue(entry?.value)]);
    map.set(ns, arr);
  }
  return map;
}

function sortNumericEntries(entries: Array<[string, string]>): Array<[string, string]> {
  return entries.slice().sort((a, b) => {
    const an = parseFloat(a[1]);
    const bn = parseFloat(b[1]);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a[0].localeCompare(b[0], undefined, { numeric: true });
  });
}

function buildModel(ds: DesignSystem, tailwindVersion: string): TailwindViewerModel {
  const ns = themeByNamespace(ds);
  const sections: TailwindViewerSection[] = [];

  const colors = ns.get('color') || [];
  if (colors.length) {
    const colorMap: Record<string, string> = {};
    for (const [name, value] of colors) colorMap[name] = value;
    sections.push({ id: 'Colors', title: 'Colors', kind: 'colors', data: { backgroundColor: colorMap, textColor: colorMap, borderColor: colorMap } });
  }

  const spacing = ns.get('spacing') || [];
  if (spacing.length) {
    const spacingMap: Record<string, string> = {};
    for (const [name, value] of sortNumericEntries(spacing)) spacingMap[name] = value;
    sections.push({ id: 'Spacing', title: 'Spacing', kind: 'spacing', data: spacingMap });
  }

  const fontSizes = ns.get('text') || [];
  if (fontSizes.length) {
    const map: Record<string, string> = {};
    for (const [name, value] of sortNumericEntries(fontSizes)) map[name] = value;
    sections.push({ id: 'Font Sizes', title: 'Font Sizes', kind: 'fontSizes', data: { fontSize: map, typographyExample: DEFAULT_TYPOGRAPHY_EXAMPLE } });
  }

  const fontFamilies = ns.get('font') || [];
  const familyMap: Record<string, string> = {};
  for (const [name, value] of fontFamilies) {
    if (name.startsWith('weight-')) continue;
    familyMap[name] = value;
  }
  if (Object.keys(familyMap).length) {
    sections.push({ id: 'Font Families', title: 'Font Families', kind: 'fontFamilies', data: { fontFamily: familyMap, typographyExample: DEFAULT_TYPOGRAPHY_EXAMPLE } });
  }

  const fontWeights = fontFamilies.filter(([n]) => n.startsWith('weight-')).map(([n, v]) => [n.replace(/^weight-/, ''), v] as [string, string]);
  if (fontWeights.length) {
    const map: Record<string, string> = {};
    for (const [name, value] of sortNumericEntries(fontWeights)) map[name] = value;
    sections.push({ id: 'Font Weight', title: 'Font Weight', kind: 'fontWeights', data: { fontWeight: map, typographyExample: DEFAULT_TYPOGRAPHY_EXAMPLE } });
  }

  const tracking = ns.get('tracking') || [];
  if (tracking.length) {
    const map: Record<string, string> = {};
    for (const [name, value] of sortNumericEntries(tracking)) map[name] = value;
    sections.push({ id: 'Letter Spacing', title: 'Letter Spacing', kind: 'letterSpacing', data: { letterSpacing: map, typographyExample: DEFAULT_TYPOGRAPHY_EXAMPLE } });
  }

  const leading = ns.get('leading') || [];
  if (leading.length) {
    const map: Record<string, string> = {};
    for (const [name, value] of sortNumericEntries(leading)) map[name] = value;
    sections.push({ id: 'Line Height', title: 'Line Height', kind: 'lineHeights', data: { lineHeight: map, typographyExample: DEFAULT_TYPOGRAPHY_EXAMPLE } });
  }

  const screens = ns.get('breakpoint') || [];
  if (screens.length) {
    const map: Record<string, string> = {};
    for (const [name, value] of sortNumericEntries(screens)) map[name] = value;
    sections.push({ id: 'Screens', title: 'Screens', kind: 'screens', data: map });
  }

  const radius = ns.get('radius') || [];
  if (radius.length) {
    const map: Record<string, string> = {};
    for (const [name, value] of sortNumericEntries(radius)) map[name] = value;
    sections.push({ id: 'Border Radius', title: 'Border Radius', kind: 'borderRadius', data: map });
  }

  const shadows = ns.get('shadow') || [];
  if (shadows.length) {
    const map: Record<string, string> = {};
    for (const [name, value] of shadows) map[name] = value;
    sections.push({ id: 'Shadows', title: 'Shadows', kind: 'shadows', data: map });
  }

  const spacingScale = Object.fromEntries(sortNumericEntries(spacing));
  const containerScale = Object.fromEntries(sortNumericEntries(ns.get('container') || []));
  if (Object.keys(spacingScale).length) {
    sections.push({ id: 'Width', title: 'Width', kind: 'width', data: { scale: spacingScale, extra: { auto: 'auto', px: '1px', full: '100%', screen: '100vw', min: 'min-content', max: 'max-content', fit: 'fit-content' } } });
    sections.push({ id: 'Min Width', title: 'Min Width', kind: 'minWidth', data: { scale: spacingScale, extra: { '0': '0px', full: '100%', min: 'min-content', max: 'max-content', fit: 'fit-content', ...containerScale } } });
    sections.push({ id: 'Max Width', title: 'Max Width', kind: 'maxWidth', data: { scale: spacingScale, extra: { none: 'none', full: '100%', min: 'min-content', max: 'max-content', fit: 'fit-content', prose: '65ch', ...containerScale } } });
    sections.push({ id: 'Height', title: 'Height', kind: 'height', data: { scale: spacingScale, extra: { auto: 'auto', px: '1px', full: '100%', screen: '100vh', min: 'min-content', max: 'max-content', fit: 'fit-content' } } });
    sections.push({ id: 'Min Height', title: 'Min Height', kind: 'minHeight', data: { scale: spacingScale, extra: { '0': '0px', full: '100%', screen: '100vh', min: 'min-content', max: 'max-content', fit: 'fit-content' } } });
    sections.push({ id: 'Max Height', title: 'Max Height', kind: 'maxHeight', data: { scale: spacingScale, extra: { none: 'none', full: '100%', screen: '100vh', min: 'min-content', max: 'max-content', fit: 'fit-content' } } });
  }

  sections.push({ id: 'Opacity', title: 'Opacity', kind: 'opacity', data: ['0','5','10','15','20','25','30','35','40','45','50','55','60','65','70','75','80','85','90','95','100'].map((k) => [k, String(Number(k)/100)]) });
  sections.push({ id: 'Border Width', title: 'Border Width', kind: 'borderWidth', data: [['','1px'],['0','0px'],['2','2px'],['4','4px'],['8','8px']] });
  sections.push({ id: 'Z-Index', title: 'Z-Index', kind: 'zIndex', data: [['0','0'],['10','10'],['20','20'],['30','30'],['40','40'],['50','50'],['auto','auto']] });
  const easing = Object.fromEntries((ns.get('ease') || []).map(([k,v]) => [k,v]));
  sections.push({ id: 'Transitions', title: 'Transitions', kind: 'transitions', data: {
    duration: [['75','75ms'],['100','100ms'],['150','150ms'],['200','200ms'],['300','300ms'],['500','500ms'],['700','700ms'],['1000','1000ms']],
    timing: Object.keys(easing).length ? easing : { linear:'linear', in:'cubic-bezier(0.4,0,1,1)', out:'cubic-bezier(0,0,0.2,1)', 'in-out':'cubic-bezier(0.4,0,0.2,1)' },
    delay: [['75','75ms'],['100','100ms'],['150','150ms'],['200','200ms'],['300','300ms'],['500','500ms'],['700','700ms'],['1000','1000ms']],
  } });
  const aspect = Object.fromEntries((ns.get('aspect') || []).map(([k,v]) => [k,v]));
  sections.push({ id: 'Aspect Ratio', title: 'Aspect Ratio', kind: 'aspectRatio', data: Object.keys(aspect).length ? aspect : { auto:'auto', square:'1 / 1', video:'16 / 9' } });
  const blur = Object.fromEntries((ns.get('blur') || []).map(([k,v]) => [k,v]));
  sections.push({ id: 'Blur', title: 'Blur', kind: 'blur', data: Object.keys(blur).length ? blur : { none:'0', sm:'4px', DEFAULT:'8px', md:'12px', lg:'16px', xl:'24px', '2xl':'40px', '3xl':'64px' } });
  const dropShadow = Object.fromEntries((ns.get('drop') || []).filter(([k]) => k.startsWith('shadow-')).map(([k,v]) => [k.replace(/^shadow-/, ''), v]));
  if (Object.keys(dropShadow).length) sections.push({ id: 'Drop Shadow', title: 'Drop Shadow', kind: 'dropShadow', data: dropShadow });
  const animate = Object.fromEntries((ns.get('animate') || []).map(([k,v]) => [k,v]));
  if (Object.keys(animate).length) sections.push({ id: 'Animations', title: 'Animations', kind: 'animations', data: animate });
  sections.push({ id: 'Scale', title: 'Scale', kind: 'scale', data: [['0','0'],['50','.5'],['75','.75'],['90','.9'],['95','.95'],['100','1'],['105','1.05'],['110','1.1'],['125','1.25'],['150','1.5']] });
  sections.push({ id: 'Rotate', title: 'Rotate', kind: 'rotate', data: [['0','0deg'],['1','1deg'],['2','2deg'],['3','3deg'],['6','6deg'],['12','12deg'],['45','45deg'],['90','90deg'],['180','180deg']] });

  const classes = ds.getClassList().map(([name]) => name).filter(Boolean);
  sections.push({ id: 'Classes', title: 'Classes', kind: 'classes', data: { classes, total: classes.length } });

  const examples: TailwindExample[] = [
    { title: 'Button', description: 'A primary action with hover/focus states.', classes: 'inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400', html: '<button class="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400">Save changes</button>', tip: 'Combine color, spacing, typography, radius, and state variants.' },
    { title: 'Card', description: 'A common content container pattern.', classes: 'max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm', html: '<div class="max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div class="text-sm font-medium text-blue-600">Tailwind</div><div class="mt-2 text-lg font-semibold text-gray-900">Build fast</div><p class="mt-2 text-sm text-gray-600">Utility classes let you style elements directly in markup.</p></div>', tip: 'Use max-w, padding, border, radius, and shadow together.' },
    { title: 'Responsive Grid', description: 'Columns change at breakpoints.', classes: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3', html: '<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"><div class="rounded-lg bg-blue-100 p-4 text-sm text-blue-900">1</div><div class="rounded-lg bg-blue-100 p-4 text-sm text-blue-900">2</div><div class="rounded-lg bg-blue-100 p-4 text-sm text-blue-900">3</div></div>', tip: 'Prefix with sm:/md:/lg: to apply at breakpoints.' },
    { title: 'Centering with Flex', description: 'Center content horizontally and vertically.', classes: 'flex h-32 items-center justify-center rounded-xl bg-gray-100', html: '<div class="flex h-32 items-center justify-center rounded-xl bg-gray-100"><span class="rounded-md bg-white px-3 py-1 text-sm shadow">Centered</span></div>', tip: 'flex + items-center + justify-center is the common centering pattern.' },
  ];
  const classCss: Record<string, string> = {};
  const inspect = ['flex','grid','hidden','block','inline-flex','items-center','justify-center','justify-between','p-4','px-4','py-2','m-4','mt-2','gap-4','text-sm','text-lg','font-semibold','rounded-lg','rounded-xl','bg-blue-600','text-white','shadow-sm','border','w-full','h-32','max-w-sm','grid-cols-1','sm:grid-cols-2','lg:grid-cols-3'];
  for (const c of inspect) {
    const css = ds.candidatesToCss([c])[0];
    if (css) classCss[c] = css;
  }

  return {
    tailwindVersion,
    prefix: ds.theme.prefix || '',
    sections,
    examples,
    classCss,
    generatedAt: new Date().toISOString(),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function serializeForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

export function renderTailwindViewerHtml(model: TailwindViewerModel): string {
  const data = serializeForScript(model);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tailwind Config Viewer</title>
  <style>
    :root { --bg:#f3f4f6; --panel:#fff; --panel-border:#d1d5db; --text:#111827; --muted:#6b7280; --soft:#e5e7eb; --accent:#0d9488; --midnight:#0b1220; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); -webkit-font-smoothing:antialiased; }
    body.mode-dark { --bg:#0b1220; --panel:#111827; --panel-border:#111827; --text:#e5e7eb; --muted:#9ca3af; --soft:#374151; }
    * { box-sizing:border-box; }
    a { color:inherit; text-decoration:none; }
    .topbar { display:flex; justify-content:space-between; align-items:center; padding:16px; background:var(--panel); border-bottom:1px solid var(--panel-border); font-size:20px; font-weight:700; color:#374151; position:sticky; top:0; z-index:30; }
    body.mode-dark .topbar { color:#9ca3af; }
    .layout { display:flex; gap:16px; padding:32px 12px; }
    .sidebar { width:260px; flex:none; position:sticky; top:89px; max-height:calc(100vh - 105px); overflow:auto; padding:8px 12px 48px; }
    .content { min-width:0; flex:1; padding-left:16px; }
    .nav-link { position:relative; display:flex; align-items:center; padding:8px 0; color:#374151; font-size:16px; }
    body.mode-dark .nav-link { color:#9ca3af; }
    .nav-link.active, .nav-link:hover { color:#111827; }
    body.mode-dark .nav-link.active, body.mode-dark .nav-link:hover { color:#e5e7eb; }
    .dot { position:absolute; left:-12px; width:5px; height:5px; border-radius:999px; background:#6b7280; opacity:0; transition:.2s; }
    .nav-link.active .dot { opacity:1; }
    .section { margin-bottom:48px; max-width:100%; }
    .section h1 { margin:0 0 8px; font-size:30px; font-weight:500; color:#1f2937; }
    body.mode-dark .section h1 { color:#9ca3af; }
    .panel { background:var(--panel); border:1px solid var(--panel-border); border-radius:6px; padding:24px; }
    .row { display:flex; flex-wrap:wrap; gap:16px; }
    .swatch { width:144px; margin-bottom:16px; }
    .swatch-tile { width:144px; height:144px; display:flex; align-items:center; justify-content:center; margin-bottom:8px; }
    .label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:14px; color:#1f2937; cursor:pointer; word-break:break-word; position:relative; }
    body.mode-dark .label { color:#9ca3af; }
    .label:hover { color:var(--accent); }
    .value { font-size:14px; color:#374151; word-break:break-word; }
    body.mode-dark .value { color:#9ca3af; }
    .spacing-box { background:#6b7280; margin-bottom:8px; }
    body.mode-dark .spacing-box { background:#374151; }
    .toolbar { display:flex; gap:8px; margin-bottom:24px; flex-wrap:wrap; align-items:center; }
    .btn { border:1px solid #d1d5db; background:#fff; color:#374151; padding:8px 12px; border-radius:4px; cursor:pointer; font-size:14px; }
    .btn.selected { background:#e5e7eb; font-weight:600; }
    body.mode-dark .btn { background:#111827; color:#9ca3af; border-color:#374151; }
    body.mode-dark .btn.selected { background:#1f2937; color:#e5e7eb; }
    .search { width:100%; max-width:420px; padding:10px 12px; border:1px solid #d1d5db; border-radius:6px; background:var(--panel); color:var(--text); }
    .class-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:8px 16px; }
    .muted { color:var(--muted); font-size:14px; }
    .hidden { display:none !important; }
    .mobile-hide { display:block; }
    .copy-tip { position:fixed; z-index:50; background:#1f2937; color:#fff; padding:6px 8px; border-radius:6px; font-size:12px; pointer-events:none; transform:translate(-50%, -100%); white-space:nowrap; }
    .hero { background:linear-gradient(135deg,#0f766e22,#2563eb22); border:1px solid var(--panel-border); border-radius:10px; padding:20px; margin-bottom:24px; }
    .hero h2 { margin:0 0 8px; font-size:22px; }
    .hero p { margin:0; color:var(--muted); line-height:1.6; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
    .chip { font-size:12px; padding:6px 10px; border-radius:999px; background:var(--panel); border:1px solid var(--panel-border); color:var(--muted); }
    .example-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
    .example { border:1px solid var(--panel-border); border-radius:10px; overflow:hidden; background:var(--panel); }
    .example-head { padding:14px 16px; border-bottom:1px solid var(--panel-border); }
    .example-head h3 { margin:0 0 4px; font-size:16px; }
    .example-head p { margin:0; font-size:13px; color:var(--muted); line-height:1.5; }
    .example-preview { padding:16px; background:linear-gradient(180deg,transparent,rgba(0,0,0,.02)); min-height:120px; }
    .example-code { margin:0; padding:14px 16px; background:#0f172a; color:#e2e8f0; font-size:12px; line-height:1.6; overflow:auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .example-actions { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--panel-border); align-items:center; }
    .btn-sm { border:1px solid var(--panel-border); background:var(--panel); color:var(--text); padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; }
    .inspector { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
    .inspector textarea { width:100%; min-height:88px; padding:12px; border:1px solid #d1d5db; border-radius:8px; font:13px ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--panel); color:var(--text); }
    .inspector pre { margin:0; padding:12px; border:1px solid var(--panel-border); border-radius:8px; background:#0f172a; color:#e2e8f0; font-size:12px; overflow:auto; min-height:88px; }
    @media (max-width: 900px) { .inspector { grid-template-columns:1fr; } }
    @media (max-width: 900px) { .mobile-hide { display:none; } .layout { display:block; } .content { padding-left:0; } .swatch,.swatch-tile { width:100%; } }
  </style>
</head>
<body>
  <div class="topbar">
    <div>Tailwind Config Viewer</div>
    <div class="muted" style="font-size:14px;font-weight:500">Vesk dev</div>
  </div>
  <div class="layout">
    <aside class="sidebar mobile-hide">
      <label style="display:flex;gap:8px;align-items:center;margin:0 0 12px 12px;color:#374151;font-size:14px">
        <input id="darkMode" type="checkbox" /> Dark Mode
      </label>
      <div id="twVersion" class="muted" style="margin-left:12px"></div>
      <nav id="nav" style="padding:12px 12px 48px"></nav>
    </aside>
    <main class="content" id="content"></main>
  </div>
  <div id="copyTip" class="copy-tip hidden">Copy</div>
  <script>
    const MODEL = ${data};
    const nav = document.getElementById('nav');
    const content = document.getElementById('content');
    const tip = document.getElementById('copyTip');
    document.getElementById('twVersion').textContent = 'Tailwind v' + MODEL.tailwindVersion;
    const dark = localStorage.getItem('tcvDarkMode') === 'true';
    document.getElementById('darkMode').checked = dark;
    document.body.classList.toggle('mode-dark', dark);
    document.getElementById('darkMode').addEventListener('change', (e) => {
      document.body.classList.toggle('mode-dark', e.target.checked);
      localStorage.setItem('tcvDarkMode', String(e.target.checked));
    });

    function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function copyText(text, el){ navigator.clipboard?.writeText(text).catch(()=>{}); tip.textContent='Copied'; tip.classList.remove('hidden'); const r=el.getBoundingClientRect(); tip.style.left=(r.left+r.width/2)+'px'; tip.style.top=(r.top-6)+'px'; setTimeout(()=>{ tip.classList.add('hidden'); tip.textContent='Copy'; }, 900); }
    function label(text, value){ return '<div><div class="label" data-copy="'+esc(text)+'">'+esc(text)+'</div>' + (value ? '<div class="value">'+esc(value)+'</div>' : '') + '</div>'; }

    function renderColors(section){
      const d = section.data;
      return '<div class="toolbar" data-color-toolbar="'+esc(section.id)+'">'
        + '<button class="btn selected" data-prop="backgroundColor">Background</button>'
        + '<button class="btn" data-prop="textColor">Text</button>'
        + '<button class="btn" data-prop="borderColor">Border</button></div>'
        + '<div class="row" id="colors-'+esc(section.id)+'"></div>';
    }
    function fillColors(section, prop){
      const prefix = {backgroundColor:'bg', textColor:'text', borderColor:'border'}[prop];
      const entries = Object.entries(section.data[prop] || {});
      const root = document.getElementById('colors-'+section.id);
      root.innerHTML = entries.map(([name, value]) => {
        let style='';
        let inner='';
        if(prop==='backgroundColor') style='background:'+value;
        if(prop==='borderColor') style='border:2px solid '+value;
        if(prop==='textColor') { style='border:1px solid #d1d5db'; inner='<span style="font-size:30px;color:'+value+'">Aa</span>'; }
        return '<div class="swatch"><div class="swatch-tile" style="'+style+'">'+inner+'</div>'+label(prefix+'-'+name, value)+'</div>';
      }).join('');
      bindCopy(root);
    }

    function renderSpacing(section){
      return '<div class="toolbar" data-spacing-toolbar="'+esc(section.id)+'">'
        + '<button class="btn selected" data-prop="p">Padding</button>'
        + '<button class="btn" data-prop="m">Margin</button>'
        + '<button class="btn" data-prop="-m">Negative Margin</button>'
        + '<select class="btn" data-dim><option value="">All</option><option value="t">Top</option><option value="r">Right</option><option value="b">Bottom</option><option value="l">Left</option><option value="x">Horizontal</option><option value="y">Vertical</option></select></div>'
        + '<div id="spacing-'+esc(section.id)+'"></div>';
    }
    function fillSpacing(section, prop, dim){
      const root = document.getElementById('spacing-'+section.id);
      root.innerHTML = Object.entries(section.data).map(([name,value]) => '<div style="margin-bottom:24px"><div class="spacing-box" style="width:'+esc(value)+';height:'+esc(value)+'"></div>'+label(prop+dim+'-'+name, value)+'</div>').join('');
      bindCopy(root);
    }

    function simpleList(entries, prefix, sampleStyleFn, text){
      return '<div style="display:flex;flex-direction:column;gap:24px">' + entries.map(([name,value]) => '<div><div style="'+sampleStyleFn(value)+';margin-bottom:8px;color:var(--text)">'+esc(text)+'</div>'+label(prefix+name, value)+'</div>').join('') + '</div>';
    }

    function sizeEntries(section) {
      const entries = Object.entries(section.data.extra || {});
      for (const [k,v] of Object.entries(section.data.scale || {})) entries.push([k, 'calc(var(--spacing) * ' + k + ') /* ' + v + ' */']);
      return entries;
    }
    function sizeBar(prefix, cssProp, axis, section) {
      return '<div style="display:flex;flex-direction:column;gap:24px">' + sizeEntries(section).map(([k,v]) => {
        const raw = String(v).replace(/ \\/\\*.*\\*\\//, '');
        const style = axis === 'x' ? 'width:min(' + raw + ',100%);max-width:100%;height:24px;background:#6b7280;margin-bottom:8px' : 'height:min(' + raw + ',320px);width:24px;background:#6b7280;margin-bottom:8px';
        return '<div><div style="' + style + '"></div>' + label(prefix + k, v) + '</div>';
      }).join('') + '</div>';
    }

    function renderSection(section){
      if(section.kind==='colors') return renderColors(section);
      if(section.kind==='spacing') return renderSpacing(section);
      if(section.kind==='fontSizes') return simpleList(Object.entries(section.data.fontSize), 'text-', v=>'font-size:'+v+';line-height:1', section.data.typographyExample);
      if(section.kind==='fontFamilies') return simpleList(Object.entries(section.data.fontFamily), 'font-', v=>'font-family:'+v, section.data.typographyExample);
      if(section.kind==='fontWeights') return simpleList(Object.entries(section.data.fontWeight), 'font-', v=>'font-weight:'+v, section.data.typographyExample);
      if(section.kind==='letterSpacing') return simpleList(Object.entries(section.data.letterSpacing), 'tracking-', v=>'letter-spacing:'+v, section.data.typographyExample);
      if(section.kind==='lineHeights') return simpleList(Object.entries(section.data.lineHeight), 'leading-', v=>'line-height:'+v, section.data.typographyExample);
      if(section.kind==='screens') return '<div style="display:flex;flex-direction:column;gap:24px">'+Object.entries(section.data).map(([k,v])=>'<div><div style="height:40px;background:#6b7280;max-width:'+esc(v)+';margin-bottom:8px"></div>'+label(k+':',v)+'</div>').join('')+'</div>';
      if(section.kind==='borderRadius') return '<div class="row">'+Object.entries(section.data).map(([k,v])=>'<div class="swatch"><div class="swatch-tile spacing-box" style="border-radius:'+esc(v)+'"></div>'+label('rounded-'+k,v)+'</div>').join('')+'</div>';
      if(section.kind==='shadows') return '<div class="row">'+Object.entries(section.data).map(([k,v])=>'<div class="swatch"><div class="swatch-tile" style="box-shadow:'+esc(v)+';background:var(--panel)"></div>'+label('shadow-'+k,v)+'</div>').join('')+'</div>';
      if(section.kind==='width') return sizeBar('w-', 'width', 'x', section);
      if(section.kind==='minWidth') return sizeBar('min-w-', 'min-width', 'x', section);
      if(section.kind==='maxWidth') return sizeBar('max-w-', 'max-width', 'x', section);
      if(section.kind==='height') return sizeBar('h-', 'height', 'y', section);
      if(section.kind==='minHeight') return sizeBar('min-h-', 'min-height', 'y', section);
      if(section.kind==='maxHeight') return sizeBar('max-h-', 'max-height', 'y', section);
      if(section.kind==='opacity') return '<div class="row">' + section.data.map(([k,v]) => '<div class="swatch"><div class="swatch-tile" style="background:#111827;opacity:'+esc(v)+'"></div>'+label('opacity-'+k,v)+'</div>').join('') + '</div>';
      if(section.kind==='borderWidth') return '<div class="row">' + section.data.map(([k,v]) => '<div class="swatch"><div class="swatch-tile" style="border:'+esc(v)+' solid #374151;background:var(--panel)"></div>'+label('border'+(k?'-'+k:''),v)+'</div>').join('') + '</div>';
      if(section.kind==='zIndex') return '<div style="display:flex;flex-direction:column;gap:16px">' + section.data.map(([k,v]) => '<div><div style="position:relative;height:40px"><div style="position:absolute;left:0;top:0;width:120px;height:32px;background:#d1d5db"></div><div style="position:absolute;left:24px;top:8px;width:120px;height:32px;background:#6b7280;z-index:'+esc(v)+'"></div></div>'+label('z-'+k,v)+'</div>').join('') + '</div>';
      if(section.kind==='transitions') return '<div style="display:flex;flex-direction:column;gap:28px"><div><div class="muted" style="margin-bottom:12px;font-weight:600">Duration</div><div style="display:flex;flex-direction:column;gap:16px">'+section.data.duration.map(([k,v])=>'<div><div style="width:96px;height:24px;background:#6b7280;margin-bottom:8px"></div>'+label('duration-'+k,v)+'</div>').join('')+'</div></div><div><div class="muted" style="margin-bottom:12px;font-weight:600">Timing</div><div style="display:flex;flex-direction:column;gap:16px">'+Object.entries(section.data.timing).map(([k,v])=>'<div><div style="width:96px;height:24px;background:#6b7280;margin-bottom:8px"></div>'+label('ease-'+k,v)+'</div>').join('')+'</div></div><div><div class="muted" style="margin-bottom:12px;font-weight:600">Delay</div><div style="display:flex;flex-direction:column;gap:16px">'+section.data.delay.map(([k,v])=>'<div><div style="width:96px;height:24px;background:#6b7280;margin-bottom:8px"></div>'+label('delay-'+k,v)+'</div>').join('')+'</div></div></div>';
      if(section.kind==='aspectRatio') return '<div class="row">' + Object.entries(section.data).map(([k,v]) => '<div class="swatch" style="width:180px"><div style="width:180px;aspect-ratio:'+esc(v)+';background:#6b7280;margin-bottom:8px"></div>'+label('aspect-'+k,v)+'</div>').join('') + '</div>';
      if(section.kind==='blur') return '<div class="row">' + Object.entries(section.data).map(([k,v]) => '<div class="swatch"><div class="swatch-tile" style="background:linear-gradient(135deg,#14b8a6,#6366f1);filter:blur('+esc(v)+')"></div>'+label('blur-'+k,v)+'</div>').join('') + '</div>';
      if(section.kind==='dropShadow') return '<div class="row">' + Object.entries(section.data).map(([k,v]) => '<div class="swatch"><div class="swatch-tile" style="background:var(--panel);filter:drop-shadow('+esc(v)+')"></div>'+label('drop-shadow-'+k,v)+'</div>').join('') + '</div>';
      if(section.kind==='animations') return '<div style="display:flex;flex-direction:column;gap:16px">' + Object.entries(section.data).map(([k,v]) => '<div>'+label('animate-'+k,v)+'</div>').join('') + '</div>';
      if(section.kind==='scale') return '<div class="row">' + section.data.map(([k,v]) => '<div class="swatch"><div class="swatch-tile" style="background:#6b7280;transform:scale('+esc(v)+')"></div>'+label('scale-'+k,v)+'</div>').join('') + '</div>';
      if(section.kind==='rotate') return '<div class="row">' + section.data.map(([k,v]) => '<div class="swatch"><div class="swatch-tile" style="background:#6b7280;transform:rotate('+esc(v)+')"></div>'+label('rotate-'+k,v)+'</div>').join('') + '</div>';
      if(section.kind==='classes') {
        const classes = section.data.classes || [];
        return '<div class="toolbar"><input id="classSearch" class="search" placeholder="Search '+classes.length+' classes" /><span class="muted" id="classCount"></span></div><div class="class-grid" id="classGrid"></div>';
      }
      return '';
    }

    const intro = document.createElement('section');
    intro.className = 'section';
    intro.id = 'Getting Started';
    intro.innerHTML = '<h1>Getting Started</h1><div class="panel"><div class="hero"><h2>Tailwind for Vesk developers</h2><p>Search utilities, click any class to copy, inspect generated CSS, and learn by example. This page is dev-only and reflects your active Tailwind/design-system.</p><div class="chips"><span class="chip">Click class to copy</span><span class="chip">Search all classes</span><span class="chip">Live examples</span><span class="chip">CSS inspector</span></div></div><div class="inspector"><div><div class="muted" style="margin-bottom:8px;font-weight:600">Try classes (space-separated)</div><textarea id="classInspector" spellcheck="false">flex items-center justify-between gap-4 rounded-xl bg-blue-600 px-4 py-3 text-white shadow-sm</textarea></div><div><div class="muted" style="margin-bottom:8px;font-weight:600">Generated CSS (from Tailwind design system)</div><pre id="classInspectorOut"></pre></div></div></div>';
    content.appendChild(intro);
    const introLink = document.createElement('a');
    introLink.href = '#Getting%20Started'; introLink.className = 'nav-link active'; introLink.dataset.section = 'Getting Started'; introLink.innerHTML = '<span class="dot"></span>Getting Started';
    nav.appendChild(introLink);

    const ex = document.createElement('section');
    ex.className = 'section'; ex.id = 'Examples';
    ex.innerHTML = '<h1>Examples</h1><div class="panel"><div class="muted" style="margin-bottom:16px">Real patterns with markup you can copy. Hover/focus/responsive variants are shown as class names.</div><div class="example-grid" id="exampleGrid"></div></div>';
    content.appendChild(ex);
    const exLink = document.createElement('a'); exLink.href = '#Examples'; exLink.className='nav-link'; exLink.dataset.section='Examples'; exLink.innerHTML='<span class="dot"></span>Examples'; nav.appendChild(exLink);

    for (const section of MODEL.sections) {
      const link = document.createElement('a');
      link.href = '#' + encodeURIComponent(section.id);
      link.className = 'nav-link';
      link.dataset.section = section.id;
      link.innerHTML = '<span class="dot"></span>' + esc(section.title);
      nav.appendChild(link);

      const el = document.createElement('section');
      el.className = 'section';
      el.id = section.id;
      el.innerHTML = '<h1>'+esc(section.title)+'</h1><div class="panel">'+renderSection(section)+'</div>';
      content.appendChild(el);
    }

    function bindCopy(root){
      root.querySelectorAll('[data-copy]').forEach(el => {
        el.addEventListener('click', () => copyText(el.getAttribute('data-copy') || '', el));
      });
    }
    const inspector = document.getElementById('classInspector');
    const inspectorOut = document.getElementById('classInspectorOut');
    const inspect = () => {
      const cls = inspector.value.split(/\\s+/).filter(Boolean);
      const known = cls.map(c => MODEL.classCss[c]).filter(Boolean);
      inspectorOut.textContent = known.length ? known.join('\\n') : '/* Select common classes from the reference below, or copy a class to see its generated CSS when available. */';
    };
    inspector.addEventListener('input', inspect); inspect();

    const exampleGrid = document.getElementById('exampleGrid');
    exampleGrid.innerHTML = MODEL.examples.map((e, i) => '<article class="example"><div class="example-head"><h3>'+esc(e.title)+'</h3><p>'+esc(e.description)+'</p></div><div class="example-preview">'+e.html+'</div><pre class="example-code">'+esc(e.html)+'</pre><div class="example-actions"><button class="btn-sm" data-copy-example="'+i+'">Copy markup</button><span class="muted">'+esc(e.tip||'')+'</span></div></article>').join('');
    exampleGrid.querySelectorAll('[data-copy-example]').forEach(btn => btn.addEventListener('click', () => {
      const ex = MODEL.examples[Number(btn.getAttribute('data-copy-example'))];
      copyText(ex.html, btn);
    }));

    bindCopy(content);

    for (const section of MODEL.sections) {
      if (section.kind === 'colors') {
        fillColors(section, 'backgroundColor');
        content.querySelector('[data-color-toolbar="'+section.id+'"]').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-prop]'); if(!btn) return;
          content.querySelectorAll('[data-color-toolbar="'+section.id+'"] .btn').forEach(b=>b.classList.remove('selected'));
          btn.classList.add('selected');
          fillColors(section, btn.getAttribute('data-prop'));
        });
      }
      if (section.kind === 'spacing') {
        let prop='p', dim='';
        fillSpacing(section, prop, dim);
        const bar = content.querySelector('[data-spacing-toolbar="'+section.id+'"]');
        bar.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-prop]'); if(!btn) return;
          bar.querySelectorAll('.btn[data-prop]').forEach(b=>b.classList.remove('selected'));
          btn.classList.add('selected');
          prop = btn.getAttribute('data-prop'); fillSpacing(section, prop, dim);
        });
        bar.querySelector('[data-dim]').addEventListener('change', (e) => { dim = e.target.value; fillSpacing(section, prop, dim); });
      }
      if (section.kind === 'classes') {
        const all = section.data.classes;
        const grid = document.getElementById('classGrid');
        const count = document.getElementById('classCount');
        const search = document.getElementById('classSearch');
        const render = () => {
          const q = search.value.toLowerCase().trim();
          const filtered = q ? all.filter(c => c.toLowerCase().includes(q)).slice(0, 1000) : all.slice(0, 400);
          grid.innerHTML = filtered.map(c => '<div class="label" data-copy="'+esc(c)+'" data-class="'+esc(c)+'">'+esc(c)+'</div>').join('');
          count.textContent = (q ? filtered.length + ' shown' : filtered.length + ' shown of ' + all.length) + (filtered.length >= 1000 ? ' (refine search)' : '');
          bindCopy(grid);
          grid.querySelectorAll('[data-class]').forEach(el => el.addEventListener('mouseenter', () => {
            const c = el.getAttribute('data-class'); const css = MODEL.classCss[c];
            if (css) { inspector.value = c; inspectorOut.textContent = css; }
          }));
        };
        search.addEventListener('input', render);
        render();
      }
    }

    const links = [...document.querySelectorAll('.nav-link')];
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          links.forEach(l => l.classList.toggle('active', l.dataset.section === e.target.id));
        }
      }
    }, { rootMargin: '-40% 0px -55% 0px', threshold: [0] });
    document.querySelectorAll('.section').forEach(s => obs.observe(s));
  </script>
</body>
</html>`;
}

export async function generateTailwindDocs(opts: LoadOptions): Promise<TailwindDocsResult> {
  const baseDir = opts.baseDir;
  const cssSource = opts.cssSource || resolve(baseDir, 'src/global.css');
  const css = existsSync(cssSource) ? readFileSync(cssSource, 'utf-8') : '@import "tailwindcss";\n';
  const tw = resolveTailwindNode(baseDir);
  const twBase = findTailwindBase(baseDir);
  const ds = await tw.load(css, { base: twBase });
  const tailwindVersion = readPackageVersion('tailwindcss', twBase);
  const model = buildModel(ds, tailwindVersion);
  return { html: renderTailwindViewerHtml(model), model };
}
