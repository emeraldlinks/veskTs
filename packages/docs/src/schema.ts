import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { IntelligenceCertainty, IntelligenceSourceLocation } from '@vesk/types';
import type { SchemaNode, SchemaRecord } from '@vesk/docs/src/ir';

export interface SchemaResolution {
  schema: SchemaNode;
  ref: string | null;
  dependencies: string[];
}

export interface SchemaOptions {
  nameHint?: string;
  node?: ts.Node;
  source?: IntelligenceSourceLocation | null;
  certainty?: IntelligenceCertainty;
}

function sanitizeName(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = ch.charCodeAt(0);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === '_' || ch === '-') out += ch;
    else out += '_';
  }
  if (out.length === 0) return 'Schema';
  const first = out.charCodeAt(0);
  if (first >= 48 && first <= 57) out = `Schema_${out}`;
  return out;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

export function sourceLocationFromNode(node: ts.Node | undefined): IntelligenceSourceLocation | null {
  if (!node) return null;
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: source.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}

export class SchemaRegistry {
  readonly records = new Map<string, SchemaRecord>();

  constructor(private readonly checker: ts.TypeChecker, private readonly generatorVersion: string) {}

  schemaFor(type: ts.Type, options: SchemaOptions = {}): SchemaResolution {
    const dependencies = new Set<string>();
    const schema = this.build(type, options, {
      active: new Set<string>(),
      dependencies,
      certainty: options.certainty ?? 'resolved',
    });
    return { schema, ref: this.refForSchema(schema), dependencies: [...dependencies] };
  }

  private refForSchema(schema: SchemaNode): string | null {
    const ref = schema.$ref;
    return typeof ref === 'string' && ref.startsWith('#/components/schemas/') ? ref.slice('#/components/schemas/'.length) : null;
  }

  private build(type: ts.Type, options: SchemaOptions, state: { active: Set<string>; dependencies: Set<string>; certainty: IntelligenceCertainty }): SchemaNode {
    const checker = this.checker;
    const flags = type.flags;
    const literal = flags & ts.TypeFlags.StringLiteral;
    if (literal) return { type: 'string', enum: [(type as ts.StringLiteralType).value] };
    const numberLiteral = flags & ts.TypeFlags.NumberLiteral;
    if (numberLiteral) return { type: 'number', enum: [(type as ts.NumberLiteralType).value] };
    const booleanLiteral = flags & ts.TypeFlags.BooleanLiteral;
    if (booleanLiteral) return { type: 'boolean', enum: [checker.typeToString(type) === 'true'] };
    if (flags & ts.TypeFlags.String) return { type: 'string' };
    if (flags & ts.TypeFlags.Number) return { type: 'number' };
    if (flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
    if (flags & ts.TypeFlags.BigInt) return { type: 'integer' };
    if (flags & ts.TypeFlags.Null) return { type: 'null' };
    if (flags & ts.TypeFlags.Undefined) return { type: 'null' };
    if (flags & ts.TypeFlags.Never) return { not: {} };

    if (checker.isArrayType(type)) {
      const args = checker.getTypeArguments(type as ts.TypeReference);
      return { type: 'array', items: args.length > 0 ? this.build(args[0], {}, state) : {} };
    }

    if (checker.isTupleType(type)) {
      const args = checker.getTypeArguments(type as ts.TypeReference);
      return { type: 'array', prefixItems: args.map((arg) => this.build(arg, {}, state)), minItems: args.length, maxItems: args.length };
    }

    if (type.isUnion()) {
      const nullable = type.types.some((part) => Boolean(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
      const parts = type.types.filter((part) => !(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
      const built = parts.map((part) => this.build(part, options, state));
      const merged = built.length === 1 ? built[0] : { anyOf: built };
      if (nullable && merged && typeof merged === 'object' && !Array.isArray(merged)) return { anyOf: [merged, { type: 'null' }] };
      return merged;
    }

    if (type.isIntersection()) {
      return { allOf: type.types.map((part) => this.build(part, options, state)) };
    }

    const symbol = type.aliasSymbol ?? type.getSymbol();
    const typeText = checker.typeToString(type, options.node, ts.TypeFormatFlags.NoTruncation);
    if (symbol?.name === 'Date') return { type: 'string', format: 'date-time' };
    if (symbol?.name === 'Promise') {
      const args = checker.getTypeArguments(type as ts.TypeReference);
      return args.length > 0 ? this.build(args[0], options, state) : {};
    }

    const nameHint = options.nameHint ?? symbol?.name ?? typeText;
    const id = `${sanitizeName(nameHint)}_${hashText(typeText)}`;
    if (state.active.has(id)) {
      state.dependencies.add(id);
      return { $ref: `#/components/schemas/${id}` };
    }
    const existing = this.records.get(id);
    if (existing) {
      state.dependencies.add(id);
      return { $ref: `#/components/schemas/${id}` };
    }

    state.active.add(id);
    const schema = this.buildObject(type, options, state);
    state.active.delete(id);
    const source = options.source ?? sourceLocationFromNode(symbol?.declarations?.[0] ?? options.node);
    const dependencies = [...state.dependencies].filter((dep) => dep !== id);
    this.records.set(id, {
      id,
      name: nameHint,
      source,
      schema,
      dependencies,
      provenance: {
        certainty: state.certainty,
        source: source ?? undefined,
        value: schema,
        reason: state.certainty === 'resolved' ? 'Resolved with the TypeScript type checker' : undefined,
      },
    });
    state.dependencies.add(id);
    return { $ref: `#/components/schemas/${id}` };
  }

  private buildObject(type: ts.Type, options: SchemaOptions, state: { active: Set<string>; dependencies: Set<string>; certainty: IntelligenceCertainty }): SchemaNode {
    const checker = this.checker;
    const schema: SchemaNode = { type: 'object', properties: {} };
    const properties = schema.properties as Record<string, SchemaNode>;
    const required: string[] = [];
    const declarationNode = options.node ?? type.getSymbol()?.declarations?.[0];
    for (const property of checker.getPropertiesOfType(type)) {
      if (property.name.startsWith('__@')) continue;
      const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? declarationNode ?? options.node;
      if (!declaration) continue;
      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
      properties[property.name] = this.build(propertyType, { node: declaration }, state);
      if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.name);
    }
    if (required.length > 0) schema.required = required;
    const indexInfos = checker.getIndexInfosOfType(type);
    const stringIndex = indexInfos.find((info) => info.keyType.flags & ts.TypeFlags.String);
    if (stringIndex) schema.additionalProperties = this.build(stringIndex.type, { node: declarationNode }, state);
    else schema.additionalProperties = false;
    if (Object.keys(properties).length === 0) delete schema.properties;
    return schema;
  }
}

export function refSchema(id: string): SchemaNode {
  return { $ref: `#/components/schemas/${id}` };
}

export function provenanceSchema<T>(value: T | null | undefined, certainty: IntelligenceCertainty, source: IntelligenceSourceLocation | null, reason?: string) {
  return {
    certainty,
    ...(value === null || value === undefined ? {} : { value: value as T }),
    ...(source ? { source } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function generatorVersion(): string {
  return `vesk-docs@${'1'}`;
}
