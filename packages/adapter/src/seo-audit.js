import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

const SEVERITY = { WARN: 'warn', ERROR: 'error' };

function walkFiles(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { if (!entry.startsWith('.')) results.push(...walkFiles(full)); }
    else if (entry === 'page.vsk' || entry === 'layout.vsk') results.push(full);
  }
  return results;
}

function collectCombinedSource(appDir) {
  const files = walkFiles(appDir);
  const pages = files.filter(f => f.endsWith('/page.vsk') || f.endsWith('\\page.vsk'));
  const layouts = files.filter(f => f.endsWith('/layout.vsk') || f.endsWith('\\layout.vsk'));

  const combined = [];
  for (const pagePath of pages) {
    const dir = resolve(pagePath, '..');
    const layoutPath = resolve(dir, 'layout.vsk');
    const pageSrc = readFileSync(pagePath, 'utf-8');
    const layoutSrc = existsSync(layoutPath) ? readFileSync(layoutPath, 'utf-8') : '';
    const combinedSrc = layoutSrc ? layoutSrc + '\n' + pageSrc : pageSrc;
    combined.push({
      path: pagePath,
      src: combinedSrc,
      hasLayout: !!layoutSrc,
    });
  }
  return combined;
}

const SEO_CHECKS = {
  h1: (src) => {
    const count = (src.match(/<h1[^>]*>/gi) || []).length;
    const issues = [];
    if (count === 0) issues.push({ severity: SEVERITY.ERROR, message: `Missing <h1> — each page needs exactly one` });
    if (count > 1) issues.push({ severity: SEVERITY.WARN, message: `Multiple <h1> (${count}) — should have exactly one` });
    return issues;
  },

  altText: (src) => {
    const issues = [];
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRegex.exec(src)) !== null) {
      const tag = m[0];
      if (!/alt\s*=/i.test(tag)) {
        issues.push({ severity: SEVERITY.ERROR, message: `Image missing alt text: ${m[1]}` });
      }
    }
    return issues;
  },

  imageAlt: (src) => {
    const issues = [];
    const imgRegex = /<Image\s+([^>]+)>/g;
    let m;
    while ((m = imgRegex.exec(src)) !== null) {
      const tag = m[1];
      if (!/alt\s*=/i.test(tag)) {
        const srcMatch = tag.match(/src=["']([^"']+)["']/);
        issues.push({ severity: SEVERITY.ERROR, message: `<Image> missing alt text: ${srcMatch ? srcMatch[1] : 'unknown'}` });
      }
    }
    return issues;
  },

  metaDescription: (src) => {
    if (!/name=["']description["']/.test(src)) {
      return [{ severity: SEVERITY.WARN, message: 'Missing meta description' }];
    }
    return [];
  },

  ogTags: (src) => {
    const issues = [];
    const required = ['og:title', 'og:description', 'og:image'];
    for (const tag of required) {
      const pattern = new RegExp(`property=["']${tag}["']`);
      if (!pattern.test(src)) {
        issues.push({ severity: SEVERITY.WARN, message: `Missing Open Graph tag: ${tag}` });
      }
    }
    return issues;
  },

  langAttr: (src) => {
    if (!/<html[^>]*\slang=/i.test(src)) {
      return [{ severity: SEVERITY.WARN, message: 'Missing lang attribute on <html>' }];
    }
    return [];
  },

  title: (src) => {
    if (!/<title>/i.test(src) && !/<Head>/i.test(src) && !/title>/i.test(src)) {
      return [{ severity: SEVERITY.ERROR, message: 'Missing <title> or <Head> — page title is critical for SEO' }];
    }
    return [];
  },

  headingOrder: (src) => {
    const headings = [];
    const hRegex = /<h(\d)[^>]*>/gi;
    let m;
    while ((m = hRegex.exec(src)) !== null) headings.push(parseInt(m[1]));

    const issues = [];
    let expected = 1;
    for (const level of headings) {
      if (level > expected + 1) {
        issues.push({ severity: SEVERITY.WARN, message: `Heading order skip: h${expected} → h${level}` });
      }
      expected = Math.max(expected, level);
    }
    return issues;
  },
};

export function runSeoAudit(appDir, options = {}) {
  const combined = collectCombinedSource(appDir);
  if (combined.length === 0) {
    console.error('vesk seo-audit: no page.vsk files found');
    return { passed: 0, errors: 0, warnings: 0 };
  }

  let errors = 0;
  let warnings = 0;

  for (const { path, src, hasLayout } of combined) {
    const relPath = path.replace(appDir, '').replace(/^\//, '');
    let fileErrors = 0;
    let fileWarnings = 0;
    const fileIssues = [];

    for (const [, check] of Object.entries(SEO_CHECKS)) {
      const issues = check(src, path);
      for (const issue of issues) {
        if (issue.severity === SEVERITY.ERROR) { fileErrors++; }
        else { fileWarnings++; }
        fileIssues.push(issue);
      }
    }

    errors += fileErrors;
    warnings += fileWarnings;

    if (fileIssues.length === 0) {
      console.error(`  ✓ ${relPath}`);
    } else {
      console.error(`  ${fileErrors > 0 ? '✗' : '⚠'} ${relPath} (${fileErrors} errors, ${fileWarnings} warnings)`);
      for (const issue of fileIssues) {
        const prefix = issue.severity === SEVERITY.ERROR ? '    ✗' : '    ⚠';
        console.error(`  ${prefix} ${issue.message}`);
      }
    }
  }

  const total = combined.length;
  const status = errors > 0 ? 'FAIL' : (warnings > 0 ? 'PASS_WARN' : 'PASS');
  console.error(`vesk seo-audit: ${total} pages — ${errors} errors, ${warnings} warnings [${status}]`);
  return { passed: total, errors, warnings };
}
