/**
 * Immutable nested updates for tracked values.
 *
 * `track()` holds ONE cell per declaration, so a nested field write has no
 * ergonomic spelling today:
 *
 *   set(store, { ...store, user: { ...store.user, name: 'Grace' } })
 *
 * Three levels of spread per keystroke, repeated at every site. These helpers
 * remove that without touching `track()`'s API — nothing here changes how a
 * cell is created, read or written; it only gives you a cheaper way to build the
 * next value:
 *
 *   set(store, updateIn(get(store), ['user', 'name'], 'Grace'))
 *
 * The compiler can also rewrite a plain assignment (`store.user.name = …`) into
 * exactly that, which is why these are shaped as (value, path, next) rather than
 * as something clever.
 *
 * Immutability is deliberate: the compiler's dependency tracking compares cell
 * identity, so mutating in place would leave `get()` returning the same object
 * with no notification — a silent no-op that reads as "the UI is broken".
 */

export type Path = Array<string | number>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/**
 * A new value with `path` set to `next`. Arrays are copied by index; every other
 * level is a plain object spread. Returns the ORIGINAL value when the path does
 * not exist, so a write to a missing branch is a visible no-op rather than a
 * crash mid-render.
 */
export function setIn<T>(value: T, path: Path, next: unknown): T {
  if (path.length === 0) return next as T;
  const [key, ...rest] = path;
  // Writing into a branch that does not exist would otherwise create
  // `{ missing: undefined }` — a visible shape change that looks like data. An
  // absent branch means the write has nothing to address, so it is inert.
  const container = Array.isArray(value)
    ? value
    : isObject(value)
      ? value
      : null;
  if (container === null) return value;
  const current = Array.isArray(container)
    ? container[typeof key === 'number' ? key : Number(key)]
    : container[String(key)];
  if (rest.length > 0 && current === undefined) return value;
  if (Array.isArray(value)) {
    const index = typeof key === 'number' ? key : Number(key);
    if (!Number.isInteger(index) || index < 0) return value;
    const copy = value.slice();
    copy[index] = rest.length === 0 ? next : setIn(value[index], rest, next);
    return copy as unknown as T;
  }
  if (!isObject(value)) return value;
  const copy: Record<string, unknown> = { ...value };
  copy[String(key)] = rest.length === 0 ? next : setIn((value as Record<string, unknown>)[String(key)], rest, next);
  return copy as unknown as T;
}

/** `setIn` with a function of the current value at that path. */
export function updateIn<T>(value: T, path: Path, fn: (current: unknown) => unknown): T {
  if (path.length === 0) return fn(value) as unknown as T;
  const [key, ...rest] = path;
  // Update the CHILD, then place it back at this segment: recursing with the
  // shorter path and re-setting the full path would splice a container into a
  // leaf. Recursing with the same path would not terminate.
  const child = getIn(value, [key]);
  const next = rest.length === 0 ? fn(child) : updateIn(child, rest, fn);
  return setIn(value, [key], next);
}

/** Read a nested value. Plain read — nothing here subscribes. */
export function getIn(value: unknown, path: Path): unknown {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = typeof key === 'number' ? key : Number(key);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!isObject(current)) return undefined;
    current = current[String(key)];
  }
  return current;
}

/**
 * The path a member expression addresses, as far as it is statically known:
 * `store.user.name` -> `['user', 'name']`, `store.items[0].done` ->
 * `['items', 0, 'done']`. Returns null at the first dynamic hop (`store[key]`),
 * because the compiler must not guess a key that changes at runtime.
 */
export function pathOf(node: unknown): Path | null {
  const path: Path = [];
  let current = node as Record<string, unknown>;
  for (;;) {
    if (!current || typeof current !== 'object') return null;
    if (current.type === 'MemberExpression') {
      if (current.computed) {
        const prop = current.property as Record<string, unknown>;
        if (prop?.type !== 'Literal') return null;
        const value = (prop as { value?: unknown }).value;
        if (typeof value === 'number' && Number.isInteger(value)) path.push(value);
        else if (typeof value === 'string' || typeof value === 'boolean') path.push(String(value));
        else return null;
      } else {
        const prop = current.property as Record<string, unknown>;
        if (prop?.type !== 'Identifier') return null;
        path.push(String(prop.name));
      }
      current = current.object as Record<string, unknown>;
      continue;
    }
    if (current.type === 'Identifier') return path.reverse();
    return null;
  }
}