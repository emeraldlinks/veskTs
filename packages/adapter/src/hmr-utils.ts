/**
 * Shareable HMR source-text helpers factored out of `hmr.ts` so the .vsk hot
 * path can be reused (and benchmarked) independently of the WebSocket server.
 * Adapter text processing is tooling, not compiler syntax analysis — regex is
 * permitted here.
 */

export interface ComponentAssignment {
  name: string;
  raw: string;
}

export function extractComponentAssignments(code: string): ComponentAssignment[] {
  const assignments: ComponentAssignment[] = [];
  const startRegex = /__components\["(\w+)"\]\s*=\s*/;
  const lines = code.split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(startRegex);
    if (m) {
      const name = m[1];
      const startIdx = i;
      let braceDepth = 0;
      for (let j = 0; j < lines[i].length; j++) {
        if (lines[i][j] === '{') braceDepth++;
        if (lines[i][j] === '}') braceDepth--;
      }
      i++;
      while (i < lines.length && braceDepth > 0) {
        for (let j = 0; j < lines[i].length; j++) {
          if (lines[i][j] === '{') braceDepth++;
          if (lines[i][j] === '}') braceDepth--;
        }
        i++;
      }
      const fullAssignment = lines.slice(startIdx, i).join('\n');
      assignments.push({ name, raw: fullAssignment });
    } else {
      i++;
    }
  }
  return assignments;
}

export function extractSourceDir(filename: string): string | null {
  if (filename === 'page.vsk') return '';
  if (filename.endsWith('/page.vsk')) return filename.slice(0, -'/page.vsk'.length);
  if (filename === 'layout.vsk') return '';
  if (filename.endsWith('/layout.vsk')) return filename.slice(0, -'/layout.vsk'.length);
  return null;
}

export function escapeSource(src: string): string {
  return src.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}