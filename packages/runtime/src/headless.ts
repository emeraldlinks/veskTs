/**
 * Headless component primitives — Show, For, Switch/Match.
 * Thin wrappers that work on both server and client; SSR renders directly,
 * client is reactive via the parent's effect system (props.when is read via
 * normal prop passing, so include them inside a reactive context or use
 * `effect` inside if you need fine-grained updates).
 */

export interface ShowProps {
  when: unknown;
  children?: unknown;
  fallback?: unknown;
}

export function Show(props: ShowProps): unknown {
  return props.when ? props.children : props.fallback ?? null;
}

export interface ForProps<T> {
  each: readonly T[] | null | undefined;
  children: (item: T, index: number) => unknown;
  fallback?: unknown;
}

export function For<T>(props: ForProps<T>): unknown {
  const list = props.each;
  if (!list || list.length === 0) return props.fallback ?? null;
  // `children` is a render function: (item, index) => VNode
  // In .vsk, usage is <For each={items}>{(item, i) => <li>{item}</li>}</For>
  // At runtime, `props.children` is the function.
  const fn = props.children as unknown as (item: T, index: number) => unknown;
  if (typeof fn !== 'function') return null;
  // Preserve keyed reconciliation? For now, simple map.
  // The caller can use `key` on the returned element if needed.
  return (list as readonly T[]).map((item, idx) => fn(item, idx));
}

export interface SwitchProps {
  children?: unknown;
  fallback?: unknown;
}

export function Switch(props: SwitchProps): unknown {
  const children = props.children as unknown as unknown[] | unknown;
  const list = Array.isArray(children) ? children : children != null ? [children] : [];
  for (const child of list) {
    // Each child is expected to be a Match element's rendered output.
    // Match returns its children when `when` is truthy, otherwise null.
    // So Switch just returns the first non-null/defined child.
    if (child != null && child !== false && child !== '') return child;
  }
  return props.fallback ?? null;
}

export interface MatchProps {
  when: unknown;
  children?: unknown;
}

export function Match(props: MatchProps): unknown {
  return props.when ? props.children : null;
}
