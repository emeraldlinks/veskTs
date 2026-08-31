export interface CodeLine {
  no: number;
  text: string;
  isError: boolean;
}

export interface Codeframe {
  file: string;
  line: number;
  column: number;
  context: number;
  code: CodeLine[];
}

export function buildCodeframe(src: string, line: number, column?: number, context = 5): Codeframe | null {
  if (typeof src !== 'string' || src.length === 0) return null;
  if (typeof line !== 'number' || !Number.isInteger(line)) return null;
  const lines = src.split('\n');
  if (line < 1 || line > lines.length) return null;
  const col = typeof column === 'number' && Number.isInteger(column) && column >= 1 ? column : 1;
  const window = typeof context === 'number' && Number.isFinite(context) && context >= 0 ? context : 5;
  const start = Math.max(1, line - window);
  const end = Math.min(lines.length, line + window);
  const code: CodeLine[] = [];
  for (let i = start; i <= end; i++) {
    code.push({ no: i, text: lines[i - 1] ?? '', isError: i === line });
  }
  return { file: '', line, column: col, context: window, code };
}

export interface ErroredLocation {
  file: string;
  line: number | null;
  column: number | null;
  message: string;
  stack: string | null;
  codeframe: Codeframe | null;
}

const LOCATION_RE = /\((\d+):(\d+)\)/;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v === 'object' && v !== null) return v as Record<string, unknown>;
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  return null;
}

function parseEmbeddedLocation(message: string): { line: number; column: number } | null {
  const m = message.match(LOCATION_RE);
  if (!m) return null;
  const line = parseInt(m[1], 10);
  const column = parseInt(m[2], 10);
  if (!Number.isFinite(line) || !Number.isFinite(column)) return null;
  return { line, column: column + 1 };
}

export function parseCompilerError(err: unknown, file: string, src?: string): ErroredLocation | null {
  if (err === undefined || err === null) return null;

  const record = asRecord(err);

  let message: string;
  let stack: string | null = null;
  if (record && typeof record.message === 'string') {
    message = record.message;
    if (typeof record.stack === 'string') stack = record.stack;
  } else if (typeof err === 'string') {
    message = err;
  } else {
    try {
      message = String(err);
    } catch {
      message = 'Unknown compiler error';
    }
    const asAny = err as { stack?: unknown };
    if (asAny && typeof asAny.stack === 'string') stack = asAny.stack;
  }

  let line: number | null = null;
  let column: number | null = null;
  let fileResolved = typeof file === 'string' ? file : '';

  // acorn raises VeskError with `.loc { line, column }` (column 0-based) and
  // other codegen errors carry `.position` / `.pos` plus `.line`/`.column`
  // fields on the VeskError class itself. Prefer explicit fields.
  if (record) {
    const loc = asRecord(record.loc);
    if (loc) {
      const ln = asNumber(loc.line);
      if (ln !== null) {
        line = ln;
        const rawCol = asNumber(loc.column);
        column = rawCol !== null ? rawCol + 1 : 1;
      }
    }

    if (line === null) {
      const pos = asRecord(record.position);
      if (pos) {
        const ln = asNumber(pos.line);
        if (ln !== null) {
          line = ln;
          const rawCol = asNumber(pos.column);
          column = rawCol !== null ? rawCol + 1 : 1;
        }
      }
    }

    if (line === null) {
      const ln = asNumber(record.line);
      if (ln !== null && ln > 0) {
        line = ln;
        const rawCol = asNumber(record.column);
        if (rawCol !== null) column = rawCol;
      }
    }

    if (typeof record.file === 'string' && record.file) fileResolved = record.file;
  }

  // Fall back to the "(line:column)" embedded in the message text (column is
  // 0-based in VeskError messages, matching acorn's loc).
  if (line === null) {
    const embedded = parseEmbeddedLocation(message);
    if (embedded) {
      line = embedded.line;
      column = embedded.column;
    }
  }

  let codeframe: Codeframe | null = null;
  if (src !== undefined && typeof src === 'string' && src.length > 0 && line !== null) {
    codeframe = buildCodeframe(src, line, column ?? 1);
    if (codeframe) codeframe.file = fileResolved;
  }

  return {
    file: fileResolved,
    line,
    column,
    message,
    stack,
    codeframe,
  };
}