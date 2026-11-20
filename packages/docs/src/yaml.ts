import type { ProjectIntelligence } from '@vesk/docs/src/ir';
import { generateOpenApi, type OpenApiOptions } from '@vesk/docs/src/openapi';

type JsonLike = string | number | boolean | null | undefined | JsonLike[] | { [key: string]: JsonLike };

function scalar(value: JsonLike): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error('Unsupported YAML scalar');
}

function isObject(value: JsonLike): value is { [key: string]: JsonLike } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function indentText(indent: number): string {
  let out = '';
  for (let i = 0; i < indent; i++) out += ' ';
  return out;
}

function emitKeyValue(key: string, value: JsonLike, indent: number, lines: string[]): void {
  const prefix = `${indentText(indent)}${JSON.stringify(key)}:`;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix} []`);
      return;
    }
    lines.push(prefix);
    emitArray(value, indent + 2, lines);
    return;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      lines.push(`${prefix} {}`);
      return;
    }
    lines.push(prefix);
    emitObject(value, indent + 2, lines);
    return;
  }
  lines.push(`${prefix} ${scalar(value)}`);
}

function emitArray(value: JsonLike[], indent: number, lines: string[]): void {
  for (const item of value) {
    if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${indentText(indent)}- []`);
      } else {
        lines.push(`${indentText(indent)}-`);
        emitArray(item, indent + 2, lines);
      }
      continue;
    }
    if (isObject(item)) {
      const keys = Object.keys(item).sort();
      if (keys.length === 0) {
        lines.push(`${indentText(indent)}- {}`);
      } else {
        lines.push(`${indentText(indent)}-`);
        emitObject(item, indent + 2, lines);
      }
      continue;
    }
    lines.push(`${indentText(indent)}- ${scalar(item)}`);
  }
}

function emitObject(value: { [key: string]: JsonLike }, indent: number, lines: string[]): void {
  for (const key of Object.keys(value).sort()) emitKeyValue(key, value[key], indent, lines);
}

export function toYaml(value: JsonLike): string {
  const lines: string[] = [];
  if (isObject(value)) emitObject(value, 0, lines);
  else if (Array.isArray(value)) emitArray(value, 0, lines);
  else lines.push(scalar(value));
  return `${lines.join('\n')}\n`;
}

export function generateOpenApiYaml(intelligence: ProjectIntelligence, options: OpenApiOptions = {}): string {
  return toYaml(generateOpenApi(intelligence, options) as JsonLike);
}
