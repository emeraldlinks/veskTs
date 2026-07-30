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
  SlotNode
} from "./ir.js";
import { VeskError } from "./errors.js";
function getSource(source, node) {
  return source.slice(node.start, node.end);
}
function extractKeyExpr(nodes) {
  for (const n of nodes) {
    if (n instanceof StaticNode && n.keyExpr) return n.keyExpr;
  }
  return null;
}
function isTrackDeclaration(decl) {
  return decl.type === "VariableDeclaration" && decl.declarations.length === 1 && decl.declarations[0].id.type === "ArrayPattern" && decl.declarations[0].id.lazy === true;
}
function getParamNames(params, source) {
  return params.map((p) => {
    if (p.type === "Identifier") return [p.name];
    if (p.type === "ObjectPattern") return p.properties.map((prop) => {
      const name = prop.key.name || prop.key.value;
      if (prop.value.type === "AssignmentPattern") {
        const defaultSrc = source.slice(prop.value.right.start, prop.value.right.end);
        return `${name} = ${defaultSrc}`;
      }
      return name;
    });
    if (p.type === "ArrayPattern") return p.elements.map((el) => el?.name ?? "_");
    return ["_"];
  }).flat();
}
function getJSXTagName(nameNode) {
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") {
    return getJSXTagName(nameNode.object) + "." + getJSXTagName(nameNode.property);
  }
  return "unknown";
}
function isHTMLTag(name) {
  return name.length > 0 && name[0] === name[0].toLowerCase();
}
function isMapCall(expr) {
  return expr.type === "CallExpression" && expr.callee.type === "MemberExpression" && expr.callee.property.name === "map" && expr.arguments.length === 1 && expr.arguments[0].type === "ArrowFunctionExpression";
}
function toExpression(source, expr) {
  return new Expression(getSource(source, expr), [], expr, source);
}
function processAttribute(source, attr) {
  const name = attr.name.type === "JSXIdentifier" ? attr.name.name : getSource(source, attr.name);
  if (attr.value === null) return { name, value: "" };
  if (attr.value.type === "Literal") return { name, value: String(attr.value.value) };
  if (attr.value.type === "JSXExpressionContainer") {
    const expr = attr.value.expression;
    if (expr.type === "Literal") return { name, value: String(expr.value) };
    return { name, value: toExpression(source, expr) };
  }
  return { name, value: "" };
}
function processJSXChildren(source, children) {
  const result = [];
  for (const child of children) {
    if (child.type === "JSXText") {
      const text = child.value.replace(/\n\s*/g, " ");
      const trimmed = text.trim();
      if (trimmed && !trimmed.startsWith("//")) result.push(new TextNode(text));
    } else if (child.type === "JSXExpressionContainer") {
      const expr = child.expression;
      if (expr.type === "JSXEmptyExpression") continue;
      if (isMapCall(expr)) {
        const arrowFn = expr.arguments[0];
        const itemVar = arrowFn.params[0]?.name ?? "item";
        const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
        const arrayExpr = toExpression(source, expr.callee.object);
        const keyExpr = extractKeyExpr(bodyNodes);
        result.push(new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr));
        continue;
      }
      if (expr.type === "LogicalExpression" && expr.operator === "&&") {
        const condExpr = toExpression(source, expr.left);
        const consequent = exprToIR(source, expr.right);
        result.push(new OpaqueDynamicRegion(condExpr, consequent));
        continue;
      }
      if (expr.type === "ConditionalExpression") {
        const condExpr = toExpression(source, expr.test);
        const consequent = exprToIR(source, expr.consequent);
        const alternate = exprToIR(source, expr.alternate);
        result.push(new OpaqueDynamicRegion(condExpr, consequent, alternate));
        continue;
      }
      if (expr.type === "MemberExpression" && !expr.computed && expr.object.type === "Identifier" && expr.object.name === "props" && expr.property.type === "Identifier" && expr.property.name === "children" || expr.type === "Identifier" && expr.name === "children") {
        result.push(new SlotNode());
        continue;
      }
      result.push(new DynamicBinding(toExpression(source, expr)));
    } else if (child.type === "JSXElement") {
      result.push(...processJSXElement(source, child));
    } else if (child.type === "JSXFragment") {
      for (const c of child.children) {
        result.push(...processJSXChildren(source, [c]));
      }
    }
  }
  return result;
}
function exprToIR(source, expr) {
  if (expr.type === "JSXElement") return processJSXElement(source, expr);
  if (expr.type === "JSXFragment") {
    const nodes = [];
    for (const c of expr.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (isMapCall(expr)) {
    const arrowFn = expr.arguments[0];
    const itemVar = arrowFn.params[0]?.name ?? "item";
    const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
    const arrayExpr = toExpression(source, expr.callee.object);
    const keyExpr = extractKeyExpr(bodyNodes);
    return [new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr)];
  }
  return [new DynamicBinding(toExpression(source, expr))];
}
function processJSXCallbackBody(source, body) {
  if (body.type === "JSXElement") return processJSXElement(source, body);
  if (body.type === "JSXFragment") {
    const nodes = [];
    for (const c of body.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (body.type === "ParenthesizedExpression") return exprToIR(source, body.expression);
  return exprToIR(source, body);
}
function processJSXElement(source, element) {
  const tagName = getJSXTagName(element.openingElement.name);
  const selfClosing = element.openingElement.selfClosing;
  if (tagName === "Head") {
    const children2 = selfClosing ? [] : processJSXChildren(source, element.children || []);
    return [new HeadBlock(children2)];
  }
  if (!isHTMLTag(tagName) && selfClosing) {
    const { props, spreadProps } = extractProps(source, element);
    return [new ComponentCall(tagName, props, [], spreadProps)];
  }
  if (!isHTMLTag(tagName)) {
    const { props, spreadProps } = extractProps(source, element);
    const children2 = processJSXChildren(source, element.children || []);
    return [new ComponentCall(tagName, props, children2, spreadProps)];
  }
  const attributes = element.openingElement.attributes.filter((attr) => attr.type !== "JSXSpreadAttribute").map((attr) => processAttribute(source, attr));
  const staticAttrs = [];
  const attrBindings = [];
  let keyExpr = null;
  for (const attr of attributes) {
    if (attr.name === "key") {
      keyExpr = typeof attr.value === "string" ? new Expression(JSON.stringify(attr.value)) : attr.value;
      continue;
    }
    if (attr.name === "ref") {
      attrBindings.push(new DynamicBinding(attr.value, "attribute", attr.name));
      continue;
    }
    if (typeof attr.value === "string") {
      staticAttrs.push({ name: attr.name, value: attr.value });
    } else {
      staticAttrs.push({ name: attr.name, value: "" });
      attrBindings.push(new DynamicBinding(attr.value, "attribute", attr.name));
    }
  }
  const children = selfClosing ? [] : processJSXChildren(source, element.children || []);
  const node = new StaticNode(tagName, staticAttrs, [...attrBindings, ...children], keyExpr);
  node.selfClosing = selfClosing;
  return [node];
}
function extractProps(source, element) {
  const props = [];
  const spreadProps = [];
  for (const attr of element.openingElement.attributes) {
    if (attr.type === "JSXSpreadAttribute") {
      spreadProps.push(toExpression(source, attr.argument));
    } else {
      props.push({
        name: attr.name.type === "JSXIdentifier" ? attr.name.name : getSource(source, attr.name),
        value: attr.value === null ? new Expression("true") : attr.value.type === "JSXExpressionContainer" ? toExpression(source, attr.value.expression) : new Expression(JSON.stringify(attr.value.value))
      });
    }
  }
  return { props, spreadProps };
}
function buildGuardChain(source, guardClauses, mainReturn) {
  const mainBody = [];
  if (mainReturn && mainReturn.argument) {
    if (mainReturn.argument.type === "JSXElement") {
      mainBody.push(...processJSXElement(source, mainReturn.argument));
    } else if (mainReturn.argument.type === "JSXFragment") {
      for (const c of mainReturn.argument.children) {
        mainBody.push(...processJSXChildren(source, [c]));
      }
    } else {
      mainBody.push(new DynamicBinding(toExpression(source, mainReturn.argument)));
    }
  }
  let currentAlternate = mainBody;
  for (let i = guardClauses.length - 1; i >= 0; i--) {
    const guard = guardClauses[i];
    const condExpr = toExpression(source, guard.test);
    const consequent = [];
    if (guard.consequent.type === "ReturnStatement" && guard.consequent.argument) {
      if (guard.consequent.argument.type === "JSXElement") {
        consequent.push(...processJSXElement(source, guard.consequent.argument));
      } else {
        consequent.push(new DynamicBinding(toExpression(source, guard.consequent.argument)));
      }
    }
    currentAlternate = [new OpaqueDynamicRegion(condExpr, consequent, currentAlternate)];
  }
  return currentAlternate;
}
function getComponentRefName(decl) {
  if (!isTrackDeclaration(decl)) return null;
  const pattern = decl.declarations[0].id;
  if (pattern.type === "ArrayPattern" && pattern.elements.length === 1) {
    const name = pattern.elements[0]?.name;
    if (name && name[0] === name[0].toUpperCase()) return name;
  }
  return null;
}
function hasJSXInSubtree(node) {
  if (!node) return false;
  if (node.type === "JSXElement" || node.type === "JSXExpressionContainer" || node.type === "JSXFragment") return true;
  if (node.type === "BlockStatement") return node.body.some(hasJSXInSubtree);
  if (node.type === "IfStatement") return hasJSXInSubtree(node.consequent) || hasJSXInSubtree(node.alternate);
  if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") return hasJSXInSubtree(node.body);
  if (node.type === "WhileStatement" || node.type === "DoWhileStatement") return hasJSXInSubtree(node.body);
  if (node.type === "SwitchStatement") return node.cases.some((c) => c.consequent?.some(hasJSXInSubtree));
  if (node.type === "TryStatement") return hasJSXInSubtree(node.block) || hasJSXInSubtree(node.handler) || hasJSXInSubtree(node.finalizer);
  if (node.type === "CatchClause") return hasJSXInSubtree(node.body);
  if (node.type === "LabeledStatement") return hasJSXInSubtree(node.body);
  if (node.type === "ReturnStatement") return hasJSXInSubtree(node.argument);
  return false;
}
function isGuardClause(node) {
  return node.type === "IfStatement" && node.consequent.type === "ReturnStatement" && hasJSXInSubtree(node.consequent);
}
function isStatementMode(bodyStmts) {
  if (bodyStmts.some((s) => s.type === "JSXElement" || s.type === "JSXExpressionContainer" || s.type === "JSXFragment")) return true;
  for (const stmt of bodyStmts) {
    if (stmt.type === "IfStatement" && !isGuardClause(stmt) && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === "ForOfStatement" && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === "ForStatement" && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === "ForInStatement" && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === "WhileStatement" && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === "DoWhileStatement" && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === "SwitchStatement" && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === "TryStatement" && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === "LabeledStatement" && hasJSXInSubtree(stmt)) return true;
  }
  return false;
}
function processBlockBody(source, block) {
  if (block.type === "BlockStatement") return processStatementModeBody(source, block.body);
  if (block.type === "JSXElement") return processJSXElement(source, block);
  if (block.type === "JSXFragment") {
    const nodes = [];
    for (const c of block.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (block.type === "IfStatement") return processIfStatement(source, block);
  if (block.type === "JSXExpressionContainer") {
    return [new DynamicBinding(toExpression(source, block.expression))];
  }
  const raw = getSource(source, block);
  if (raw) return [new RuntimeStatement(raw, block, source)];
  return [];
}
function processIfStatement(source, stmt) {
  const condExpr = toExpression(source, stmt.test);
  const consequent = processBlockBody(source, stmt.consequent);
  const alternate = stmt.alternate ? processBlockBody(source, stmt.alternate) : [];
  return [new OpaqueDynamicRegion(condExpr, consequent, alternate)];
}
function processForStatement(source, stmt) {
  if (stmt.type === "ForOfStatement") {
    const left = stmt.left;
    const itemVar = left.type === "VariableDeclaration" ? left.declarations[0]?.id?.name ?? "item" : left.name ?? "item";
    const arrayExpr = toExpression(source, stmt.right);
    const bodyTemplate = processBlockBody(source, stmt.body);
    return [new MapRegion(arrayExpr, itemVar, bodyTemplate)];
  }
  if (stmt.type === "ForInStatement") {
    const left = getSource(source, stmt.left);
    const objExpr = toExpression(source, stmt.right);
    const bodyTemplate = processBlockBody(source, stmt.body);
    return [new ForLoop(left, objExpr, "", bodyTemplate, "for-in")];
  }
  if (stmt.type === "ForStatement") {
    const init = stmt.init ? getSource(source, stmt.init) : "";
    const test = stmt.test ? toExpression(source, stmt.test) : new Expression("true");
    const update = stmt.update ? getSource(source, stmt.update) : "";
    const bodyTemplate = processBlockBody(source, stmt.body);
    return [new ForLoop(init, test, update, bodyTemplate, "for")];
  }
  return [];
}
function processWhileStatement(source, stmt) {
  const condition = toExpression(source, stmt.test);
  const bodyTemplate = processBlockBody(source, stmt.body);
  const isDoWhile = stmt.type === "DoWhileStatement";
  return [new WhileLoop(condition, bodyTemplate, isDoWhile)];
}
function processSwitchStatement(source, stmt) {
  const discriminant = toExpression(source, stmt.discriminant);
  const cases = stmt.cases.map((c) => ({
    test: c.test ? toExpression(source, c.test) : null,
    body: processStatementModeBody(source, c.consequent)
  }));
  return [new SwitchBlock(discriminant, cases)];
}
function processTryStatement(source, stmt) {
  const bodyTemplate = processBlockBody(source, stmt.block);
  const catchBody = stmt.handler ? processBlockBody(source, stmt.handler.body) : [];
  const catchParamName = stmt.handler?.param?.name ?? null;
  return [new TryCatch(bodyTemplate, catchBody, catchParamName)];
}
function processStatementModeBody(source, bodyStmts) {
  const nodes = [];
  for (const stmt of bodyStmts) {
    if (stmt.type === "JSXElement") {
      nodes.push(...processJSXElement(source, stmt));
    } else if (stmt.type === "JSXExpressionContainer") {
      if (stmt.expression.type === "JSXEmptyExpression") continue;
      if (isMapCall(stmt.expression)) {
        const arrowFn = stmt.expression.arguments[0];
        const itemVar = arrowFn.params[0]?.name ?? "item";
        const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
        const arrayExpr = toExpression(source, stmt.expression.callee.object);
        const keyExpr = extractKeyExpr(bodyNodes);
        nodes.push(new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr));
        continue;
      }
      nodes.push(new DynamicBinding(toExpression(source, stmt.expression)));
    } else if (stmt.type === "JSXFragment") {
      for (const c of stmt.children) {
        nodes.push(...processJSXChildren(source, [c]));
      }
    } else if (stmt.type === "VeskBlock") {
      const inner = processStatementModeBody(source, stmt.body);
      if (stmt.tag === "server") {
        nodes.push(new ServerBlock(inner));
      } else if (stmt.tag === "client") {
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
    } else if (stmt.type === "IfStatement") {
      nodes.push(...processIfStatement(source, stmt));
    } else if (stmt.type === "ForOfStatement") {
      nodes.push(...processForStatement(source, stmt));
    } else if (stmt.type === "WhileStatement" || stmt.type === "DoWhileStatement") {
      nodes.push(...processWhileStatement(source, stmt));
    } else if (stmt.type === "SwitchStatement") {
      nodes.push(...processSwitchStatement(source, stmt));
    } else if (stmt.type === "TryStatement") {
      nodes.push(...processTryStatement(source, stmt));
    } else if (stmt.type === "ReturnStatement") {
      if (stmt.argument) {
        nodes.push(...exprToIR(source, stmt.argument));
      }
    } else if (stmt.type === "LabeledStatement") {
      nodes.push(...processBlockBody(source, stmt.body));
    } else if (stmt.type === "ForInStatement") {
      nodes.push(...processForStatement(source, stmt));
    } else if (stmt.type === "ForStatement") {
      nodes.push(...processForStatement(source, stmt));
    } else if (stmt.type === "ClassDeclaration") {
      throw VeskError.classDecl();
    } else {
      const raw = getSource(source, stmt);
      if (raw) nodes.push(new RuntimeStatement(raw, stmt, source));
    }
  }
  return nodes;
}
function extractStyle(body) {
  const cssParts = [];
  const filtered = [];
  for (const node of body) {
    if (node instanceof StaticNode && node.tag === "style") {
      for (const child of node.children) {
        if (child instanceof TextNode) {
          cssParts.push(child.value);
        }
      }
    } else {
      filtered.push(node);
    }
  }
  return { body: filtered, css: cssParts.join("\n") || null };
}
function validateBlocks(compName, isClient, body) {
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
      validateBlocks(compName, isClient, node.children || []);
    }
  }
}
function processEnum(node, source, exported) {
  const name = node.id.name;
  const pairs = [];
  const reversePairs = [];
  let autoVal = 0;
  for (const member of node.members) {
    const key = member.id.name;
    let val;
    if (member.initializer) {
      val = getSource(source, member.initializer);
    } else {
      val = String(autoVal);
    }
    pairs.push(`${JSON.stringify(key)}: ${val}`);
    reversePairs.push(`${val}: ${JSON.stringify(key)}`);
    if (!member.initializer) autoVal++;
  }
  const allPairs = [...reversePairs, ...pairs].join(", ");
  const prefix = exported ? `export const ${name}` : `const ${name}`;
  return `${prefix} = { ${allPairs} };`;
}
function generateIR(ast, source) {
  const components = [];
  const imports = [];
  const importedNames = /* @__PURE__ */ new Set();
  let staticProps = null;
  let loadFn = null;
  const topLevelCode = [];
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      imports.push(getSource(source, node));
      for (const spec of node.specifiers) {
        if (spec.type === "ImportSpecifier") {
          importedNames.add(spec.local.name);
        }
      }
      continue;
    }
    if (node.type === "ExportNamedDeclaration" && node.declaration && !staticProps) {
      const decl = node.declaration;
      const fnName = decl.type === "FunctionDeclaration" ? decl.id?.name : decl.type === "VariableDeclaration" ? decl.declarations[0]?.id?.name : null;
      if (fnName === "getStaticProps") {
        staticProps = getSource(source, decl);
        continue;
      }
    }
    if (node.type === "ExportNamedDeclaration" && node.declaration && !loadFn) {
      const decl = node.declaration;
      const fnName = decl.type === "FunctionDeclaration" ? decl.id?.name : decl.type === "VariableDeclaration" ? decl.declarations[0]?.id?.name : null;
      if (fnName === "load") {
        loadFn = getSource(source, decl);
        continue;
      }
    }
    let inner = node;
    let exported = false;
    let defaultExport = false;
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      inner = node.declaration;
      exported = true;
    } else if (node.type === "ExportDefaultDeclaration" && node.declaration) {
      inner = node.declaration;
      exported = true;
      defaultExport = true;
    }
    if (inner.type === "ComponentDeclaration") {
    } else if (inner.type === "ClassDeclaration") {
      throw VeskError.classDecl();
    } else if (inner.type === "TSEnumDeclaration") {
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
      const comp = new ComponentIR(name, paramNames, body, { mode: "statement", exported, defaultExport, isClient: inner.client, isAsync: inner.async });
      comp.style = css;
      components.push(comp);
    } else {
      const guardClauses = [];
      let mainReturn = null;
      const preamble = [];
      for (const stmt of bodyStmts) {
        if (stmt.type === "VeskBlock") {
          const innerBody = processStatementModeBody(source, stmt.body);
          if (stmt.tag === "server") {
            preamble.push(new ServerBlock(innerBody));
          } else if (stmt.tag === "client") {
            preamble.push(new ClientBlock(innerBody));
          }
        } else if (stmt.type === "ReturnStatement") {
          mainReturn = stmt;
        } else if (isTrackDeclaration(stmt)) {
          const elements = stmt.declarations[0].id.elements;
          const trackName = elements[0]?.name;
          const rawName = elements.length > 1 ? elements[1]?.name : null;
          const init = getSource(source, stmt.declarations[0].init);
          if (trackName) preamble.push(new TrackDecl(trackName, init, rawName));
          const refName = getComponentRefName(stmt);
          if (refName) preamble.push(new ComponentRef(refName));
        } else if (stmt.type === "IfStatement" && !mainReturn && stmt.consequent.type !== "ThrowStatement") {
          guardClauses.push(stmt);
        } else if (stmt.type === "ClassDeclaration") {
          throw VeskError.classDecl();
        } else {
          const raw = getSource(source, stmt);
          if (raw) preamble.push(new RuntimeStatement(raw, stmt, source));
        }
      }
      const guardBody = buildGuardChain(source, guardClauses, mainReturn);
      const { body, css } = extractStyle([...preamble, ...guardBody]);
      validateBlocks(name, isClientComp, body);
      const comp = new ComponentIR(name, paramNames, body, { exported, defaultExport, isClient: inner.client, isAsync: inner.async });
      comp.style = css;
      components.push(comp);
    }
  }
  const autoImportable = [
    "useFetch",
    "useRouter",
    "useParams",
    "usePathname",
    "useSearchParams",
    "useNavigate",
    "useHead",
    "useTitle",
    "Form",
    "Field",
    "required",
    "email",
    "minLength",
    "maxLength",
    "pattern",
    "custom",
    "Link",
    "NavLink",
    "Outlet",
    "Image",
    "Portal",
    "Experiment"
  ];
  const usedFunctions = /* @__PURE__ */ new Set();
  for (const code of topLevelCode) {
    for (const fn of autoImportable) {
      if (code.includes(fn + "(")) usedFunctions.add(fn);
    }
  }
  function scanForAutoImport(nodes) {
    for (const node of nodes) {
      if (node instanceof RuntimeStatement && node.raw) {
        for (const fn of autoImportable) {
          if (node.raw.includes(fn + "(")) usedFunctions.add(fn);
        }
      }
      if (node instanceof ComponentCall) {
        if (autoImportable.includes(node.componentName)) {
          usedFunctions.add(node.componentName);
        }
        for (const prop of node.props) {
          if (prop.value && prop.value.raw) {
            for (const fn of autoImportable) {
              if (prop.value.raw.includes(fn + "(")) usedFunctions.add(fn);
            }
          }
        }
        scanForAutoImport(node.children);
      }
      if (node instanceof DynamicBinding && node.expression && node.expression.raw) {
        for (const fn of autoImportable) {
          if (node.expression.raw.includes(fn + "(")) usedFunctions.add(fn);
        }
      }
      if (node instanceof StaticNode || node instanceof ServerBlock || node instanceof ClientBlock || node instanceof HeadBlock) {
        scanForAutoImport(node.children);
      }
    }
  }
  scanForAutoImport(components.flatMap((c) => c.body));
  if (usedFunctions.size > 0) {
    const existing = /* @__PURE__ */ new Set();
    for (const imp of imports) {
      const match = imp.match(/import\s+\{([^}]+)\}\s+from\s+['"]@vesk\/runtime['"]/);
      if (match) {
        for (const n of match[1].split(",")) existing.add(n.trim().split(/\s+as\s+/).pop());
      }
    }
    const missing = [...usedFunctions].filter((f) => !existing.has(f));
    if (missing.length > 0) {
      imports.push(`import { ${missing.join(", ")} } from '@vesk/runtime';`);
    }
  }
  return new IRRoot(components, imports, importedNames, staticProps, loadFn, topLevelCode);
}
export {
  generateIR
};
