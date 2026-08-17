/**
 * Attaches comments (collected via acorn's `onComment`) to AST nodes so the
 * printer can emit them. Comments are attached as `leadingComments` /
 * `trailingComments` on statement-list items and block bodies; anything that
 * falls outside a statement list is attached to the innermost containing node
 * as `innerComments`.
 */

function isNode(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.type === 'string' &&
    typeof value.start === 'number'
  );
}

function sameLine(a, b) {
  return a.loc && b.loc && a.loc.end.line === b.loc.start.line;
}

/** Statement/child lists where comments between members matter. */
function childArrays(node) {
  const lists = [];
  if (!isNode(node)) return lists;
  switch (node.type) {
    case 'Program':
      lists.push(node.body);
      break;
    case 'BlockStatement':
      lists.push(node.body);
      break;
    case 'SwitchCase':
      lists.push(node.consequent);
      break;
    case 'ClassBody':
      lists.push(node.body);
      break;
    case 'TSInterfaceBody':
      lists.push(node.body);
      break;
    case 'JSXElement':
    case 'JSXFragment':
      lists.push(node.children || []);
      break;
    case 'TSTypeLiteral':
      lists.push(node.members || node.body || []);
      break;
  }
  return lists;
}

function collectNodes(node, out) {
  if (!isNode(node)) return;
  out.push(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) collectNodes(item, out);
    } else if (isNode(value)) {
      collectNodes(value, out);
    }
  }
}

function findInnermostContainer(ast, pos) {
  let best = null;
  const nodes = [];
  collectNodes(ast, nodes);
  for (const n of nodes) {
    if (n.start <= pos && pos <= n.end) {
      if (!best || n.end - n.start < best.end - best.start) best = n;
    }
  }
  return best;
}

/**
 * Recursively distributes comments into statement/child lists, then falls back
 * to attaching unhandled comments as innerComments of their container.
 */
export function attachComments(ast, comments) {
  if (!comments || comments.length === 0) return;
  const remaining = comments.slice().sort((a, b) => a.start - b.start);

  const processList = (children) => {
    if (!Array.isArray(children) || children.length === 0) return;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      let idx = -1;
      for (let j = 0; j < children.length; j++) {
        if (children[j].start >= c.end) { idx = j; break; }
      }
      if (idx === -1) {
        // Comment after the last child — attach as a trailing comment if it
        // starts on the same line as the previous child.
        const last = children[children.length - 1];
        if (last && sameLine(last, c)) {
          (last.trailingComments ||= []).push(c);
          remaining.splice(i, 1);
          i--;
        }
        continue;
      }
      const child = children[idx];
      const prev = idx > 0 ? children[idx - 1] : null;
      if (prev && sameLine(prev, c)) {
        (prev.trailingComments ||= []).push(c);
        remaining.splice(i, 1);
        i--;
      } else {
        (child.leadingComments ||= []).push(c);
        remaining.splice(i, 1);
        i--;
      }
    }
  };

  const walk = (node) => {
    if (!isNode(node)) return;
    // Recurse into children first so comments that live inside a nested
    // statement list are claimed by the deepest list before an enclosing
    // list (Program/block body) can snap them up as leading comments.
    for (const key of Object.keys(node)) {
      if (['loc', 'range', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      } else if (isNode(value)) {
        walk(value);
      }
    }
    for (const list of childArrays(node)) processList(list);
  };

  walk(ast);

  // Any comment still unplaced is attached as an inner comment of the smallest
  // node that contains it.
  for (const c of remaining) {
    const container = findInnermostContainer(ast, c.start);
    if (container) (container.innerComments ||= []).push(c);
  }
}
