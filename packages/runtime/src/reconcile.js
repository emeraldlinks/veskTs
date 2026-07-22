export function reconcile(anchor, endAnchor, items, keyFn, createItem) {
  const parent = anchor.parentNode;
  const map = new Map();

  for (const item of items) {
    const key = keyFn(item);
    const marker = document.createComment('k:' + key);
    const effs = [];
    parent.insertBefore(marker, endAnchor);
    createItem(item, effs);
    map.set(key, { marker, effs });
  }

  return (newItems) => {
    const newKeys = newItems.map(keyFn);
    const newSet = new Set(newKeys);

    for (const [key, { marker, effs }] of map) {
      if (!newSet.has(key)) {
        removeRange(marker, endAnchor);
        marker.remove();
        for (const e of effs) e.destroy();
        map.delete(key);
      }
    }

    let ref = endAnchor;
    for (let i = newKeys.length - 1; i >= 0; i--) {
      const key = newKeys[i];
      let entry = map.get(key);
      if (entry) {
        if (entry.marker.nextSibling !== ref) {
          moveBefore(entry.marker, endAnchor, ref);
        }
        ref = entry.marker;
      } else {
        const marker = document.createComment('k:' + key);
        const effs = [];
        parent.insertBefore(marker, ref);
        createItem(newItems[i], effs);
        map.set(key, { marker, effs });
        ref = marker;
      }
    }
  };
}

function removeRange(start, end) {
  let n = start.nextSibling;
  while (n && n !== end && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith('k:'))) {
    const next = n.nextSibling;
    n.remove();
    n = next;
  }
}

function moveBefore(marker, endAnchor, ref) {
  const nodes = [];
  let n = marker.nextSibling;
  while (n && n !== endAnchor && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith('k:'))) {
    nodes.push(n);
    n = n.nextSibling;
  }
  const parent = marker.parentNode;
  parent.insertBefore(marker, ref);
  for (const node of nodes) parent.insertBefore(node, ref);
}
