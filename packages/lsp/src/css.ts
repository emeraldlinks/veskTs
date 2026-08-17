/** @module css — CSS style-block completions, color parsing, and position helpers. */

import { Color } from 'vscode-languageserver/node.js';
import type { TextDocument, Position } from 'vscode-languageserver/node.js';
import { NAMED_COLORS } from './knowledge';

/** Return true if the cursor position is inside a `<style>` block. */
export function isInsideStyleBlock(document: TextDocument, position: Position): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(0, offset);
  const after = text.substring(offset);
  const lastStyleOpen = before.lastIndexOf('<style');
  const lastStyleClose = before.lastIndexOf('</style>');
  if (lastStyleOpen === -1) return false;
  if (lastStyleClose > lastStyleOpen) return false;
  const nextClose = after.indexOf('</style>');
  if (nextClose === -1) return false;
  return true;
}

/** Parse the CSS context at the cursor, returning the current property name and partial value prefix. */
export function getCSSPrefix(document: TextDocument, position: Position): { property: string; valuePrefix: string } {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 500), offset);
  const lines = before.split('\n');
  const currentLine = lines[lines.length - 1];
  const colonIdx = currentLine.lastIndexOf(':');
  if (colonIdx !== -1) {
    const prop = currentLine.substring(0, colonIdx).trim();
    const valAfter = currentLine.substring(colonIdx + 1);
    const valMatch = valAfter.match(/([\w-]*)$/);
    return { property: prop, valuePrefix: valMatch?.[1] || '' };
  }
  const propMatch = currentLine.match(/([\w-]*)\s*$/);
  return { property: '', valuePrefix: propMatch?.[1] || '' };
}

/** Parse a CSS color string (#hex, rgb(), rgba(), hsl(), named) into an LSP Color object, or null. */
export function parseCSSColorValue(value: string): Color | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) {
    const h = v.slice(1);
    if (h.length === 3) return { red: parseInt(h[0] + h[0], 16) / 255, green: parseInt(h[1] + h[1], 16) / 255, blue: parseInt(h[2] + h[2], 16) / 255, alpha: 1 };
    if (h.length === 6) return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255, alpha: 1 };
    if (h.length === 8) return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255, alpha: parseInt(h.slice(6, 8), 16) / 255 };
  }
  const rgb = v.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) return { red: parseInt(rgb[1]) / 255, green: parseInt(rgb[2]) / 255, blue: parseInt(rgb[3]) / 255, alpha: 1 };
  const rgba = v.match(/^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (rgba) return { red: parseInt(rgba[1]) / 255, green: parseInt(rgba[2]) / 255, blue: parseInt(rgba[3]) / 255, alpha: parseFloat(rgba[4]) };
  const hsl = v.match(/^hsl\s*\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/);
  if (hsl) {
    const h = parseInt(hsl[1]) / 360, s = parseInt(hsl[2]) / 100, l = parseInt(hsl[3]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 1 / 6) { r = c; g = x; } else if (h < 2 / 6) { r = x; g = c; } else if (h < 3 / 6) { g = c; b = x; } else if (h < 4 / 6) { g = x; b = c; } else if (h < 5 / 6) { r = x; b = c; } else { r = c; b = x; }
    return { red: r + m, green: g + m, blue: b + m, alpha: 1 };
  }
  if (NAMED_COLORS[v]) {
    const [r, g, b] = NAMED_COLORS[v];
    return { red: r / 255, green: g / 255, blue: b / 255, alpha: v === 'transparent' ? 0 : 1 };
  }
  return null;
}