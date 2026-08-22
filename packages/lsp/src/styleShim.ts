/**
 * Style-block language features — real CSS completion/hover inside
 * `<style>…</style>` regions of a .vsk file.
 *
 * The compiler records style regions in source coordinates but SKIPS their
 * content when emitting generated code. Volar therefore remaps client
 * positions into generated space where the caret inside a style block has no
 * exact counterpart, and its completion dispatcher never descends into the
 * css embedded code — so plugin-level providers can't recover the caret.
 *
 * Instead this module installs a connection-level shim BEFORE volar registers
 * its handlers: `connection.onCompletion`/`onHover` handlers are wrapped so
 * requests whose RAW position (original .vsk geometry) falls inside a style
 * region are answered here with vscode-css-languageservice, and everything
 * else delegates to volar unchanged.
 *
 * The current document text + style regions are pushed into `noteStyleState`
 * by VeskVirtualCode.update() on every change, so the shim always sees the
 * editor's live buffer without touching disk.
 */

import type { Connection } from 'vscode-languageserver/node';
import {
  getCSSLanguageService,
  type Stylesheet,
} from 'vscode-css-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';

const cssLs = getCSSLanguageService({ useDefaultDataProvider: true });
const stylesheets = new WeakMap<TextDocument, Stylesheet>();

function parseStylesheet(doc: TextDocument): Stylesheet {
  const cached = stylesheets.get(doc);
  if (cached) {
    return cached;
  }
  const sheet = cssLs.parseStylesheet(doc);
  stylesheets.set(doc, sheet);
  return sheet;
}

export interface StyleRegion {
  start: number;
  end: number;
  content: string;
}

interface DocState {
  text: string;
  regions: StyleRegion[];
}

const latestDocs = new Map<string, DocState>();

/** Called by VeskVirtualCode.update() on every document change. */
export function noteStyleState(fileName: string, text: string, regions: StyleRegion[]): void {
  latestDocs.set(fileNameToUriKey(fileName), { text, regions });
}

function fileNameToUriKey(fileName: string): string {
  // Both the tests (file:// URIs) and VS Code use file scheme for .vsk docs.
  return fileName.startsWith('file://') ? fileName : `file://${fileName}`;
}

function positionToOffset(text: string, position: { line: number; character: number }): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  const lineText = lines[Math.min(position.line, lines.length - 1)] ?? '';
  return offset + Math.min(position.character, lineText.length);
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length - 1,
    character: offset - (lastNewline + 1),
  };
}

function locate(state: DocState, position: { line: number; character: number }) {
  const offset = positionToOffset(state.text, position);
  for (const region of state.regions) {
    let contentStart = state.text.indexOf(region.content, region.start);
    if (contentStart === -1 || contentStart >= region.end) {
      contentStart = Math.max(0, region.end - region.content.length);
    }
    const bodyEnd = contentStart + region.content.length;
    if (offset >= contentStart && offset <= bodyEnd) {
      return { region, contentStart, bodyEnd, offset };
    }
  }
  return null;
}

interface ShimResult<T> {
  handled: T | undefined;
  /** False when the request must delegate to volar's handler. */
  matched: boolean;
}

function withCss<T>(
  params: { position: { line: number; character: number }; textDocument: { uri: string } },
  compute: (cssDoc: TextDocument, position: { line: number; character: number }, state: DocState, located: { contentStart: number; bodyEnd: number; offset: number }) => T,
): ShimResult<T> {
  const uri = params.textDocument?.uri ?? '';
  if (!uri.endsWith('.vsk')) {
    return { matched: false, handled: undefined };
  }
  const state = latestDocs.get(uri);
  if (!state || state.regions.length === 0) {
    return { matched: false, handled: undefined };
  }
  const located = locate(state, params.position);
  if (!located) {
    return { matched: false, handled: undefined };
  }
  const cssDoc = TextDocument.create('vsk://style-block.css', 'css', 0, located.region.content);
  const cssOffset = located.offset - located.contentStart;
  const handled = compute(cssDoc, cssDoc.positionAt(Math.max(0, cssOffset)), state, located);
  return { matched: true, handled };
}

/** Wrap volar's feature handlers with style-block-aware preemption. */
export function installStyleShim(connection: Connection): void {
  const realOnCompletion = connection.onCompletion.bind(connection);
  connection.onCompletion = (handler) =>
    realOnCompletion(async (params, token, workDone, resultProgress) => {
      const shim = withCss(params, (doc, pos) => {
        const list = cssLs.doComplete(doc, pos, parseStylesheet(doc));
        if (!list) {
          return null;
        }
        // Items keep label/insertText only: textEdits carry css-doc ranges
        // that would be meaningless in root space; clients insert at caret.
        const items = list.items.map((item) => {
          const { textEdit: _t, additionalTextEdits: _a, ...rest } = item as Record<string, unknown> & { label: string };
          void _t;
          void _a;
          return rest;
        });
        return { isIncomplete: list.isIncomplete, items };
      });
      if (shim.matched) {
        return shim.handled;
      }
      return handler(params, token, workDone, resultProgress);
    });

  const realOnHover = connection.onHover.bind(connection);
  connection.onHover = (handler) =>
    realOnHover(async (params, token, workDone) => {
      const shim = withCss(params, (doc, pos, _state, located) => {
        const hover = cssLs.doHover(doc, pos, parseStylesheet(doc));
        if (!hover) {
          return null;
        }
        if (hover.range) {
          hover.range = {
            start: offsetToPosition(_state.text, located.contentStart + doc.offsetAt(hover.range.start)),
            end: offsetToPosition(_state.text, located.contentStart + doc.offsetAt(hover.range.end)),
          };
        }
        return hover;
      });
      if (shim.matched) {
        return shim.handled;
      }
      return handler(params, token, workDone);
    });
}
