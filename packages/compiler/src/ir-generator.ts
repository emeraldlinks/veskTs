import type { Node as ESTreeNode } from 'estree';
import {
  IRRoot,
  ComponentIR,
  StaticNode,
  TextNode,
  DynamicBinding,
  OpaqueDynamicRegion,
  MapRegion,
  WhileLoop,
  SwitchBlock,
  TryCatch,
  RuntimeStatement,
  ForLoop,
  TrackDecl,
  ComponentRef,
  ComponentCall,
  ServerBlock,
  ClientBlock,
  HeadBlock,
  Expression,
  SlotNode,
} from '@vesk/compiler/src/ir';
import type { IRNode } from '@vesk/compiler/src/ir';
import { VeskError } from '@vesk/compiler/src/errors';
import { createBaseParser } from '@vesk/compiler/src/parser';
import type { VeskAnnotation } from '@vesk/compiler/src/parser';

let __vskAnnotations: VeskAnnotation[] = [];

function parseExprNode(text: string): ESTreeNode | null {
  try {
    const parser = createBaseParser();
    const ast = parser.parse(`(${text})`, { ecmaVersion: 'latest', sourceType: 'module' });
    return ((ast as { body: Array<{ expression?: ESTreeNode }> }).body[0]?.expression as ESTreeNode) ?? null;
  } catch {
    return null;
  }
}

function getForClauseAnnotation(forStart: number): VeskAnnotation | null {
  let keyRange: [number, number] | undefined;
  let indexName: string | undefined;
  let clauseStart = -1;
  let clauseEnd = -1;
  for (const ann of __vskAnnotations) {
    if (ann.kind !== 'for-clause' || ann.forStart !== forStart) continue;
    if (ann.keyRange) keyRange = ann.keyRange;
    if (ann.indexName) indexName = ann.indexName;
    clauseStart = ann.clauseStart;
    clauseEnd = ann.clauseEnd;
  }
  if (clauseStart === -1) return null;
  return { kind: 'for-clause', forStart, clauseStart, clauseEnd, ...(keyRange ? { keyRange } : {}), ...(indexName !== undefined ? { indexName } : {}) };
}

function getSource(source: string, node: { start: number; end: number }): string {
  return source.slice(node.start, node.end);
}

function componentUsesFetch(nodes: IRNode[]): boolean {
  for (const node of nodes) {
    if (node instanceof ServerBlock || node instanceof ClientBlock) {
      if (componentUsesFetch(node.children)) return true;
    } else if (node instanceof RuntimeStatement) {
      if (node.raw.includes('useFetch(')) return true;
    } else if (node instanceof DynamicBinding) {
      if (node.expression.raw.includes('useFetch(')) return true;
    } else if (node instanceof MapRegion) {
      if (componentUsesFetch(node.bodyTemplate)) return true;
      if (componentUsesFetch(node.alternateNodes)) return true;
    } else if (node instanceof OpaqueDynamicRegion) {
      if (componentUsesFetch(node.consequentNodes) || componentUsesFetch(node.alternateNodes)) return true;
    } else if (node instanceof WhileLoop) {
      if (componentUsesFetch(node.bodyTemplate)) return true;
    } else if (node instanceof ForLoop) {
      if (componentUsesFetch(node.bodyTemplate)) return true;
    } else if (node instanceof TryCatch) {
      if (componentUsesFetch(node.bodyTemplate) || componentUsesFetch(node.catchBody)) return true;
    } else if (node instanceof SwitchBlock) {
      for (const c of node.cases) {
        if (componentUsesFetch(c.body)) return true;
      }
    }
  }
  return false;
}

function extractKeyExpr(nodes: IRNode[]): Expression | null {
  for (const n of nodes) {
    if (n instanceof StaticNode && n.keyExpr) return n.keyExpr;
  }
  return null;
}

function isTrackDeclaration(decl: ESTreeNode & { type: string; declarations?: Array<{ id: { type: string; lazy?: boolean; elements?: Array<{ name?: string } | null> } }> }): boolean {
  return (
    (decl as any).type === 'VariableDeclaration' &&
    (decl as any).declarations.length === 1 &&
    (decl as any).declarations[0].id.type === 'ArrayPattern' &&
    (decl as any).declarations[0].id.lazy === true
  );
}

function getParamNames(params: Array<{ type: string; name?: string; properties?: Array<{ key: { name?: string; value?: string }; value: { type: string; right?: { start: number; end: number } } }>; elements?: Array<{ name?: string } | null> }>, source: string): string[] {
  return params.map((p) => {
    if (p.type === 'Identifier') return [p.name!];
    if (p.type === 'ObjectPattern') return p.properties!.map((prop) => {
      const name = prop.key.name || prop.key.value;
      if (prop.value.type === 'AssignmentPattern') {
        const defaultSrc = source.slice(prop.value.right!.start, prop.value.right!.end);
        return `${name} = ${defaultSrc}`;
      }
      return name!;
    });
    if (p.type === 'ArrayPattern') return p.elements!.map((el) => el?.name ?? '_');
    return ['_'];
  }).flat();
}

function getJSXTagName(nameNode: { type: string; name?: string; object?: any; property?: any }): string {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name!;
  if (nameNode.type === 'JSXMemberExpression') {
    return getJSXTagName(nameNode.object) + '.' + getJSXTagName(nameNode.property);
  }
  return 'unknown';
}

function isHTMLTag(name: string): boolean {
  return name.length > 0 && name[0] === name[0].toLowerCase();
}

function isMapCall(expr: any): boolean {
  return (
    expr.type === 'CallExpression' &&
    expr.callee.type === 'MemberExpression' &&
    expr.callee.property.name === 'map' &&
    expr.arguments.length === 1 &&
    expr.arguments[0].type === 'ArrowFunctionExpression'
  );
}

function toExpression(source: string, expr: { start: number; end: number }): Expression {
  return new Expression(getSource(source, expr), [], expr as unknown as ESTreeNode, source);
}

function processAttribute(source: string, attr: any): { name: string; value: string | Expression } {
  const name = attr.name.type === 'JSXIdentifier' ? attr.name.name : getSource(source, attr.name);
  if (attr.value === null) return { name, value: '' };
  if (attr.value.type === 'Literal') return { name, value: String(attr.value.value) };
  if (attr.value.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression;
    if (expr.type === 'Literal') return { name, value: String(expr.value) };
    return { name, value: toExpression(source, expr) };
  }
  return { name, value: '' };
}

function processJSXChildren(source: string, children: any[]): IRNode[] {
  const result: IRNode[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.type === 'JSXText') {
      const text = child.value.replace(/\n\s*/g, ' ');
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('//')) { i++; continue; }

      const forMatch = trimmed.match(/^for\s*\(([^)]+)\)/);
      if (forMatch && i + 1 < children.length && children[i + 1].type === 'JSXExpressionContainer') {
        const exprNode = children[i + 1].expression;
        if (exprNode.type !== 'JSXEmptyExpression') {
          const decl = forMatch[1];
          let bodyNodes: IRNode[];
          if (exprNode.type === 'JSXFragment') {
            bodyNodes = [];
            for (const c of exprNode.children) bodyNodes.push(...processJSXChildren(source, [c]));
          } else if (exprNode.type === 'JSXElement') {
            bodyNodes = processJSXElement(source, exprNode);
          } else {
            bodyNodes = exprToIR(source, exprNode);
          }

          if (/ of /.test(decl)) {
            const ofParts = decl.split(' of ');
            if (ofParts.length === 2) {
              const itemVar = ofParts[0].trim().replace(/^(const|let|var)\s+/, '');
              const exprText = ofParts[1].trim();
              const arrExpr = new Expression(exprText, [], parseExprNode(exprText), null);
              const rawFor = child.value.match(/^\s*for\s*\(/);
              const ann = rawFor ? getForClauseAnnotation(child.start + rawFor[0].indexOf('for')) : null;
              const keyExpr = ann?.keyRange ? new Expression(source.slice(ann.keyRange[0], ann.keyRange[1])) : null;
              const indexVar = ann?.indexName ?? null;
              let alternate: IRNode[] = [];
              let consumed = 2;
              const emptyText = children[i + 2];
              const emptyContainer = children[i + 3];
              if (
                emptyText && emptyText.type === 'JSXText' && ['#empty', 'empty'].includes(emptyText.value.trim()) &&
                emptyContainer && emptyContainer.type === 'JSXExpressionContainer' &&
                emptyContainer.expression.type !== 'JSXEmptyExpression'
              ) {
                alternate = exprToIR(source, emptyContainer.expression);
                consumed = 4;
              }
              result.push(new MapRegion(arrExpr, itemVar, bodyNodes, keyExpr, indexVar, alternate));
              i += consumed;
              continue;
            }
          } else if (/ in /.test(decl)) {
            const inParts = decl.split(' in ');
            if (inParts.length === 2) {
              const itemVar = inParts[0].trim().replace(/^(const|let|var)\s+/, '');
              const arrExpr = new Expression(inParts[1].trim());
              result.push(new ForLoop(itemVar, arrExpr, '', bodyNodes, 'for-in'));
              i += 2;
              continue;
            }
          }
        }
      }

      result.push(new TextNode(text));
      i++;
    } else if (child.type === 'JSXExpressionContainer') {
      const expr = child.expression;
      if (expr.type === 'JSXEmptyExpression') { i++; continue; }

      if (isMapCall(expr)) {
        const arrowFn = expr.arguments[0];
        const itemVar = arrowFn.params[0]?.name ?? 'item';
        const indexVar = arrowFn.params[1]?.name ?? null;
        const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
        const arrayExpr = toExpression(source, expr.callee.object);
        const keyExpr = extractKeyExpr(bodyNodes);
        result.push(new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr, indexVar));
        i++;
        continue;
      }

      if (expr.type === 'LogicalExpression' && expr.operator === '&&') {
        const condExpr = toExpression(source, expr.left);
        const consequent = exprToIR(source, expr.right);
        result.push(new OpaqueDynamicRegion(condExpr, consequent));
        i++;
        continue;
      }

      if (expr.type === 'ConditionalExpression') {
        const condExpr = toExpression(source, expr.test);
        const consequent = exprToIR(source, expr.consequent);
        const alternate = exprToIR(source, expr.alternate);
        result.push(new OpaqueDynamicRegion(condExpr, consequent, alternate));
        i++;
        continue;
      }

      if (
        (expr.type === 'MemberExpression' && !expr.computed &&
          expr.object.type === 'Identifier' && expr.object.name === 'props' &&
          expr.property.type === 'Identifier' && expr.property.name === 'children')
        || (expr.type === 'Identifier' && expr.name === 'children')
      ) {
        result.push(new SlotNode());
        i++;
        continue;
      }

      result.push(new DynamicBinding(toExpression(source, expr)));
      i++;
    } else if (child.type === 'JSXElement') {
      result.push(...processJSXElement(source, child));
      i++;
    } else if (child.type === 'JSXFragment') {
      for (const c of child.children) result.push(...processJSXChildren(source, [c]));
      i++;
    } else {
      i++;
    }
  }
  return result;
}

function exprToIR(source: string, expr: any): IRNode[] {
  if (expr.type === 'JSXElement') return processJSXElement(source, expr);
  if (expr.type === 'JSXFragment') {
    const nodes: IRNode[] = [];
    for (const c of expr.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (isMapCall(expr)) {
    const arrowFn = expr.arguments[0];
    const itemVar = arrowFn.params[0]?.name ?? 'item';
    const indexVar = arrowFn.params[1]?.name ?? null;
    const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
    const arrayExpr = toExpression(source, expr.callee.object);
    const keyExpr = extractKeyExpr(bodyNodes);
    return [new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr, indexVar)];
  }
  return [new DynamicBinding(toExpression(source, expr))];
}

function processJSXCallbackBody(source: string, body: any): IRNode[] {
  if (body.type === 'JSXElement') return processJSXElement(source, body);
  if (body.type === 'JSXFragment') {
    const nodes: IRNode[] = [];
    for (const c of body.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (body.type === 'ParenthesizedExpression') return exprToIR(source, body.expression);
  return exprToIR(source, body);
}

function processJSXElement(source: string, element: any): IRNode[] {
  const tagName = getJSXTagName(element.openingElement.name);
  const selfClosing = element.openingElement.selfClosing;

  if (tagName === 'Head') {
    const children = selfClosing ? [] : processJSXChildren(source, element.children || []);
    return [new HeadBlock(children)];
  }

  if (!isHTMLTag(tagName) && selfClosing) {
    const { props, spreadProps } = extractProps(source, element);
    return [new ComponentCall(tagName, props, [], spreadProps)];
  }

  if (!isHTMLTag(tagName)) {
    const { props, spreadProps } = extractProps(source, element);
    const children = processJSXChildren(source, element.children || []);
    return [new ComponentCall(tagName, props, children, spreadProps)];
  }

  const attributes = element.openingElement.attributes
    .filter((attr: any) => attr.type !== 'JSXSpreadAttribute')
    .map((attr: any) => processAttribute(source, attr));
  const staticAttrs: { name: string; value: string }[] = [];
  const attrBindings: IRNode[] = [];
  let keyExpr: Expression | null = null;

  for (const attr of attributes) {
    if (attr.name === 'key') {
      keyExpr = typeof attr.value === 'string' ? new Expression(JSON.stringify(attr.value)) : attr.value;
      continue;
    }
    if (attr.name === 'ref') {
      attrBindings.push(new DynamicBinding(attr.value as Expression, 'attribute', attr.name));
      continue;
    }
    if (typeof attr.value === 'string') {
      staticAttrs.push({ name: attr.name, value: attr.value });
    } else {
      staticAttrs.push({ name: attr.name, value: '' });
      attrBindings.push(new DynamicBinding(attr.value as Expression, 'attribute', attr.name));
    }
  }

  const children = selfClosing ? [] : processJSXChildren(source, element.children || []);
  const node = new StaticNode(tagName, staticAttrs, [...attrBindings, ...children], keyExpr);
  node.selfClosing = selfClosing;
  return [node];
}

function extractProps(source: string, element: any): { props: { name: string; value: Expression }[]; spreadProps: Expression[] } {
  const props: { name: string; value: Expression }[] = [];
  const spreadProps: Expression[] = [];
  for (const attr of element.openingElement.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      spreadProps.push(toExpression(source, attr.argument));
    } else {
      props.push({
        name: attr.name.type === 'JSXIdentifier' ? attr.name.name : getSource(source, attr.name),
        value:
          attr.value === null
            ? new Expression('true')
            : attr.value.type === 'JSXExpressionContainer'
              ? toExpression(source, attr.value.expression)
              : new Expression(JSON.stringify(attr.value.value)),
      });
    }
  }
  return { props, spreadProps };
}

function buildGuardChain(source: string, guardClauses: any[], mainReturn: any): IRNode[] {
  const mainBody: IRNode[] = [];
  if (mainReturn && mainReturn.argument) {
    if (mainReturn.argument.type === 'JSXElement') {
      mainBody.push(...processJSXElement(source, mainReturn.argument));
    } else if (mainReturn.argument.type === 'JSXFragment') {
      for (const c of mainReturn.argument.children) {
        mainBody.push(...processJSXChildren(source, [c]));
      }
    } else {
      mainBody.push(new DynamicBinding(toExpression(source, mainReturn.argument)));
    }
  }

  let currentAlternate: IRNode[] = mainBody;
  for (let i = guardClauses.length - 1; i >= 0; i--) {
    const guard = guardClauses[i];
    const condExpr = toExpression(source, guard.test);
    const consequent: IRNode[] = [];
    if (guard.consequent.type === 'ReturnStatement' && guard.consequent.argument) {
      if (guard.consequent.argument.type === 'JSXElement') {
        consequent.push(...processJSXElement(source, guard.consequent.argument));
      } else {
        consequent.push(new DynamicBinding(toExpression(source, guard.consequent.argument)));
      }
    }
    currentAlternate = [new OpaqueDynamicRegion(condExpr, consequent, currentAlternate)];
  }

  return currentAlternate;
}

function getComponentRefName(decl: any): string | null {
  if (!isTrackDeclaration(decl)) return null;
  const pattern = decl.declarations[0].id;
  if (pattern.type === 'ArrayPattern' && pattern.elements.length === 1) {
    const name = pattern.elements[0]?.name;
    if (name && name[0] === name[0].toUpperCase()) return name;
  }
  return null;
}

function hasJSXInSubtree(node: any): boolean {
  if (!node) return false;
  if (node.type === 'JSXElement' || node.type === 'JSXExpressionContainer' || node.type === 'JSXFragment') return true;
  if (node.type === 'BlockStatement') return node.body.some(hasJSXInSubtree);
  if (node.type === 'IfStatement') return hasJSXInSubtree(node.consequent) || hasJSXInSubtree(node.alternate);
  if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') return hasJSXInSubtree(node.body);
  if (node.type === 'WhileStatement' || node.type === 'DoWhileStatement') return hasJSXInSubtree(node.body);
  if (node.type === 'SwitchStatement') return node.cases.some((c: any) => c.consequent?.some(hasJSXInSubtree));
  if (node.type === 'TryStatement') return hasJSXInSubtree(node.block) || hasJSXInSubtree(node.handler) || hasJSXInSubtree(node.finalizer);
  if (node.type === 'CatchClause') return hasJSXInSubtree(node.body);
  if (node.type === 'LabeledStatement') return hasJSXInSubtree(node.body);
  if (node.type === 'ReturnStatement') return hasJSXInSubtree(node.argument);
  return false;
}

function isGuardClause(node: any): boolean {
  return node.type === 'IfStatement' && node.consequent.type === 'ReturnStatement' && hasJSXInSubtree(node.consequent);
}

function isStatementMode(bodyStmts: any[]): boolean {
  if (bodyStmts.some((s) => s.type === 'JSXElement' || s.type === 'JSXExpressionContainer' || s.type === 'JSXFragment')) return true;
  for (const stmt of bodyStmts) {
    if (stmt.type === 'IfStatement' && !isGuardClause(stmt) && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'ForOfStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'ForStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'ForInStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'WhileStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'DoWhileStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'SwitchStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'TryStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'LabeledStatement' && hasJSXInSubtree(stmt)) return true;
  }
  return false;
}

function processBlockBody(source: string, block: any): IRNode[] {
  if (block.type === 'BlockStatement') return processStatementModeBody(source, block.body);
  if (block.type === 'JSXElement') return processJSXElement(source, block);
  if (block.type === 'JSXFragment') {
    const nodes: IRNode[] = [];
    for (const c of block.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (block.type === 'IfStatement') return processIfStatement(source, block);
  if (block.type === 'JSXExpressionContainer') {
    return [new DynamicBinding(toExpression(source, block.expression))];
  }
  const raw = getSource(source, block);
  if (raw) return [new RuntimeStatement(raw, block, source)];
  return [];
}

function processIfStatement(source: string, stmt: any): IRNode[] {
  const condExpr = toExpression(source, stmt.test);
  const consequent = processBlockBody(source, stmt.consequent);
  const alternate = stmt.alternate ? processBlockBody(source, stmt.alternate) : [];
  return [new OpaqueDynamicRegion(condExpr, consequent, alternate)];
}

function processForStatement(source: string, stmt: any, alternate: IRNode[] = []): IRNode[] {
  if (stmt.type === 'ForOfStatement') {
    const left = stmt.left;
    const itemVar =
      left.type === 'VariableDeclaration'
        ? left.declarations[0]?.id?.name ?? 'item'
        : left.name ?? 'item';
    const arrayExpr = toExpression(source, stmt.right);
    const bodyTemplate = processBlockBody(source, stmt.body);
    const ann = getForClauseAnnotation(stmt.start);
    const keyExpr = ann?.keyRange ? new Expression(source.slice(ann.keyRange[0], ann.keyRange[1])) : null;
    const indexVar = ann?.indexName ?? null;
    return [new MapRegion(arrayExpr, itemVar, bodyTemplate, keyExpr, indexVar, alternate)];
  }
  if (stmt.type === 'ForInStatement') {
    const left = getSource(source, stmt.left);
    const objExpr = toExpression(source, stmt.right);
    const bodyTemplate = processBlockBody(source, stmt.body);
    return [new ForLoop(left, objExpr, '', bodyTemplate, 'for-in')];
  }
  if (stmt.type === 'ForStatement') {
    const init = stmt.init ? getSource(source, stmt.init) : '';
    const test = stmt.test ? toExpression(source, stmt.test) : new Expression('true');
    const update = stmt.update ? getSource(source, stmt.update) : '';
    const bodyTemplate = processBlockBody(source, stmt.body);
    return [new ForLoop(init, test, update, bodyTemplate, 'for')];
  }
  return [];
}

function processWhileStatement(source: string, stmt: any): IRNode[] {
  const condition = toExpression(source, stmt.test);
  const bodyTemplate = processBlockBody(source, stmt.body);
  const isDoWhile = stmt.type === 'DoWhileStatement';
  return [new WhileLoop(condition, bodyTemplate, isDoWhile)];
}

function processSwitchStatement(source: string, stmt: any): IRNode[] {
  const discriminant = toExpression(source, stmt.discriminant);
  const cases = stmt.cases.map((c: any) => ({
    test: c.test ? toExpression(source, c.test) : null,
    body: processStatementModeBody(source, c.consequent),
  }));
  return [new SwitchBlock(discriminant, cases)];
}

function processTryStatement(source: string, stmt: any): IRNode[] {
  const bodyTemplate = processBlockBody(source, stmt.block);
  const catchBody = stmt.handler ? processBlockBody(source, stmt.handler.body) : [];
  const catchParamName = stmt.handler?.param?.name ?? null;
  return [new TryCatch(bodyTemplate, catchBody, catchParamName)];
}

function processStatementModeBody(source: string, bodyStmts: any[]): IRNode[] {
  const nodes: IRNode[] = [];
  for (let i = 0; i < bodyStmts.length; i++) {
    const stmt = bodyStmts[i];
    if (stmt.type === 'JSXElement') {
      nodes.push(...processJSXElement(source, stmt));
    } else if (stmt.type === 'JSXExpressionContainer') {
      if (stmt.expression.type === 'JSXEmptyExpression') continue;
      if (isMapCall(stmt.expression)) {
        const arrowFn = stmt.expression.arguments[0];
        const itemVar = arrowFn.params[0]?.name ?? 'item';
        const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
        const arrayExpr = toExpression(source, stmt.expression.callee.object);
        const keyExpr = extractKeyExpr(bodyNodes);
        nodes.push(new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr));
        continue;
      }
      nodes.push(new DynamicBinding(toExpression(source, stmt.expression)));
    } else if (stmt.type === 'JSXFragment') {
      for (const c of stmt.children) {
        nodes.push(...processJSXChildren(source, [c]));
      }
    } else if (stmt.type === 'VeskBlock') {
      if (stmt.tag === 'empty') continue;
      const inner = processStatementModeBody(source, stmt.body);
      if (stmt.tag === 'server') {
        nodes.push(new ServerBlock(inner));
      } else if (stmt.tag === 'client') {
        nodes.push(new ClientBlock(inner));
      }
    } else if (isTrackDeclaration(stmt)) {
      const elements = stmt.declarations[0].id.elements;
      const name = elements[0]?.name;
      const rawName = elements.length > 1 ? elements[1]?.name : null;
      const init = getSource(source, stmt.declarations[0].init);
      if (name) nodes.push(new TrackDecl(name, init, rawName));
      const refName = getComponentRefName(stmt);
      if (refName) nodes.push(new ComponentRef(refName));
    } else if (stmt.type === 'IfStatement') {
      nodes.push(...processIfStatement(source, stmt));
    } else if (stmt.type === 'ForOfStatement') {
      let alternate: IRNode[] = [];
      let consumed = 1;
      const next = bodyStmts[i + 1];
      if (next && next.type === 'VeskBlock' && next.tag === 'empty') {
        alternate = processStatementModeBody(source, next.body);
        consumed = 2;
      }
      nodes.push(...processForStatement(source, stmt, alternate));
      i += consumed - 1;
    } else if (stmt.type === 'WhileStatement' || stmt.type === 'DoWhileStatement') {
      nodes.push(...processWhileStatement(source, stmt));
    } else if (stmt.type === 'SwitchStatement') {
      nodes.push(...processSwitchStatement(source, stmt));
    } else if (stmt.type === 'TryStatement') {
      nodes.push(...processTryStatement(source, stmt));
    } else if (stmt.type === 'ReturnStatement') {
      if (stmt.argument) {
        nodes.push(...exprToIR(source, stmt.argument));
      }
    } else if (stmt.type === 'LabeledStatement') {
      nodes.push(...processBlockBody(source, stmt.body));
    } else if (stmt.type === 'ForInStatement') {
      nodes.push(...processForStatement(source, stmt));
    } else if (stmt.type === 'ForStatement') {
      nodes.push(...processForStatement(source, stmt));
    } else if (stmt.type === 'ClassDeclaration') {
      throw VeskError.classDecl();
    } else {
      const raw = getSource(source, stmt);
      if (raw) nodes.push(new RuntimeStatement(raw, stmt, source));
    }
  }
  return nodes;
}

function extractStyle(body: IRNode[]): { body: IRNode[]; css: string | null } {
  const cssParts: string[] = [];
  const filtered: IRNode[] = [];
  for (const node of body) {
    if (node instanceof StaticNode && node.tag === 'style') {
      for (const child of node.children) {
        if (child instanceof TextNode) {
          cssParts.push(child.value);
        }
      }
    } else {
      filtered.push(node);
    }
  }
  return { body: filtered, css: cssParts.join('\n') || null };
}

function validateBlocks(compName: string, isClient: boolean, body: IRNode[]): void {
  for (const node of body) {
    if (isClient) {
      if (node instanceof ServerBlock) {
        throw VeskError.serverBlockInClient(compName);
      }
    } else {
      if (node instanceof ClientBlock) {
        throw VeskError.clientBlockInServer(compName);
      }
    }
    if (node instanceof StaticNode || node instanceof ServerBlock || node instanceof ClientBlock) {
      validateBlocks(compName, isClient, (node as any).children || []);
    }
  }
}

function processEnum(node: any, source: string, exported: boolean): string {
  const name = node.id.name;
  const pairs: string[] = [];
  const reversePairs: string[] = [];
  let autoVal = 0;
  for (const member of node.members) {
    const key = member.id.name;
    let val: string;
    if (member.initializer) {
      val = getSource(source, member.initializer);
    } else {
      val = String(autoVal);
    }
    pairs.push(`${JSON.stringify(key)}: ${val}`);
    reversePairs.push(`${val}: ${JSON.stringify(key)}`);
    if (!member.initializer) autoVal++;
  }
  const allPairs = [...reversePairs, ...pairs].join(', ');
  const prefix = exported ? `export const ${name}` : `const ${name}`;
  return `${prefix} = { ${allPairs} };`;
}

export function generateIR(ast: any, source: string): IRRoot {
  __vskAnnotations = (ast as { __vskAnnotations?: VeskAnnotation[] }).__vskAnnotations ?? [];
  const components: ComponentIR[] = [];
  const imports: string[] = [];
  const importedNames = new Set<string>();
  let staticProps: string | null = null;
  let loadFn: string | null = null;
  const topLevelCode: string[] = [];

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      imports.push(getSource(source, node));
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportSpecifier') {
          importedNames.add(spec.local.name);
        }
      }
      continue;
    }

    if (node.type === 'ExportNamedDeclaration' && node.declaration && !staticProps) {
      const decl = node.declaration;
      const fnName = decl.type === 'FunctionDeclaration'
        ? decl.id?.name
        : decl.type === 'VariableDeclaration'
          ? decl.declarations[0]?.id?.name
          : null;
      if (fnName === 'getStaticProps') {
        staticProps = getSource(source, decl);
        continue;
      }
    }

    if (node.type === 'ExportNamedDeclaration' && node.declaration && !loadFn) {
      const decl = node.declaration;
      const fnName = decl.type === 'FunctionDeclaration'
        ? decl.id?.name
        : decl.type === 'VariableDeclaration'
          ? decl.declarations[0]?.id?.name
          : null;
      if (fnName === 'load') {
        loadFn = getSource(source, decl);
        continue;
      }
    }

    let inner = node;
    let exported = false;
    let defaultExport = false;
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      inner = node.declaration;
      exported = true;
    } else if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
      inner = node.declaration;
      exported = true;
      defaultExport = true;
    }

    if (inner.type === 'ComponentDeclaration') {
      // handled below
    } else if (inner.type === 'ClassDeclaration') {
      throw VeskError.classDecl();
    } else if (inner.type === 'TSEnumDeclaration') {
      const code = processEnum(inner, source, exported);
      topLevelCode.push(code);
      continue;
    } else {
      topLevelCode.push(getSource(source, node));
      continue;
    }

    const name = inner.id.name;
    const paramNames = getParamNames(inner.params, source);
    const bodyStmts = inner.body.body;
    const isClientComp = !!inner.client;

    if (isStatementMode(bodyStmts)) {
      const raw = processStatementModeBody(source, bodyStmts);
      const { body, css } = extractStyle(raw);
      validateBlocks(name, isClientComp, body);
      const comp = new ComponentIR(name, paramNames, body, { mode: 'statement', exported, defaultExport, isClient: inner.client, isAsync: inner.async, ssrAwait: componentUsesFetch(body) });
      comp.style = css;
      components.push(comp);
    } else {
      const guardClauses: any[] = [];
      let mainReturn: any = null;
      const preamble: IRNode[] = [];

      for (const stmt of bodyStmts) {
        if (stmt.type === 'VeskBlock') {
          const innerBody = processStatementModeBody(source, stmt.body);
          if (stmt.tag === 'server') {
            preamble.push(new ServerBlock(innerBody));
          } else if (stmt.tag === 'client') {
            preamble.push(new ClientBlock(innerBody));
          }
        } else if (stmt.type === 'ReturnStatement') {
          mainReturn = stmt;
        } else if (isTrackDeclaration(stmt)) {
          const elements = stmt.declarations[0].id.elements;
          const trackName = elements[0]?.name;
          const rawName = elements.length > 1 ? elements[1]?.name : null;
          const init = getSource(source, stmt.declarations[0].init);
          if (trackName) preamble.push(new TrackDecl(trackName, init, rawName));
          const refName = getComponentRefName(stmt);
          if (refName) preamble.push(new ComponentRef(refName));
        } else if (stmt.type === 'IfStatement' && !mainReturn && stmt.consequent.type !== 'ThrowStatement') {
          guardClauses.push(stmt);
        } else if (stmt.type === 'ClassDeclaration') {
          throw VeskError.classDecl();
        } else {
          const raw = getSource(source, stmt);
          if (raw) preamble.push(new RuntimeStatement(raw, stmt, source));
        }
      }

      const guardBody = buildGuardChain(source, guardClauses, mainReturn);
      const { body, css } = extractStyle([...preamble, ...guardBody]);
      validateBlocks(name, isClientComp, body);
      const comp = new ComponentIR(name, paramNames, body, { exported, defaultExport, isClient: inner.client, isAsync: inner.async, ssrAwait: componentUsesFetch(body) });
      comp.style = css;
      components.push(comp);
    }
  }

  const autoImportable = [
    'useFetch', 'useRouter', 'useParams', 'usePathname', 'useSearchParams', 'useNavigate',
    'useHead', 'useTitle',
    'defineAction',
    'Form', 'Field', 'required', 'email', 'minLength', 'maxLength', 'pattern', 'custom',
    'Link', 'NavLink', 'Outlet',
    'Image', 'Portal',
    'Experiment',
  ];
  const usedFunctions = new Set<string>();

  for (const code of topLevelCode) {
    for (const fn of autoImportable) {
      if (code.includes(fn + '(')) usedFunctions.add(fn);
    }
  }

  function scanForAutoImport(nodes: IRNode[]): void {
    for (const node of nodes) {
      if (node instanceof RuntimeStatement && node.raw) {
        for (const fn of autoImportable) {
          if (node.raw.includes(fn + '(')) usedFunctions.add(fn);
        }
      }
      if (node instanceof ComponentCall) {
        if (autoImportable.includes(node.componentName)) {
          usedFunctions.add(node.componentName);
        }
        for (const prop of node.props) {
          if (prop.value && prop.value.raw) {
            for (const fn of autoImportable) {
              if (prop.value.raw.includes(fn + '(')) usedFunctions.add(fn);
            }
          }
        }
        scanForAutoImport(node.children);
      }
      if (node instanceof MapRegion) {
        scanForAutoImport(node.bodyTemplate);
        scanForAutoImport(node.alternateNodes);
      }
      if (node instanceof OpaqueDynamicRegion) {
        scanForAutoImport(node.consequentNodes);
        scanForAutoImport(node.alternateNodes);
      }
      if (node instanceof DynamicBinding && node.expression && node.expression.raw) {
        for (const fn of autoImportable) {
          if (node.expression.raw.includes(fn + '(')) usedFunctions.add(fn);
        }
      }
      if (node instanceof StaticNode || node instanceof ServerBlock || node instanceof ClientBlock || node instanceof HeadBlock) {
        scanForAutoImport(node.children);
      }
    }
  }
  scanForAutoImport(components.flatMap(c => c.body));

  if (usedFunctions.size > 0) {
    const existing = new Set<string>();
    for (const imp of imports) {
      const match = imp.match(/import\s+\{([^}]+)\}\s+from\s+['"]@vesk\/runtime['"]/);
      if (match) {
        for (const n of match[1].split(',')) existing.add(n.trim().split(/\s+as\s+/).pop()!);
      }
    }
    const missing = [...usedFunctions].filter(f => !existing.has(f));
    if (missing.length > 0) {
      imports.push(`import { ${missing.join(', ')} } from '@vesk/runtime';`);
    }
  }

  return new IRRoot(components, imports, importedNames, staticProps, loadFn, topLevelCode);
}