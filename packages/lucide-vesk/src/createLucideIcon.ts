/**
 * createLucideIcon — mirrors lucide-react's createLucideIcon but for Vesk.
 * Returns a Vesk-compatible icon component with the same props and class handling.
 * Never scoped — no style tag.
 */

import Icon from "./Icon.js";
import { mergeClasses } from "./utils.js";
import type { IconNode, LucideIcon, LucideProps } from "./types.js";

export function createLucideIcon(iconName: string, iconNode: IconNode): LucideIcon {
  // `iconName` is already kebab-case (`"terminal"`, `"arrow-left"`): the
  // generator emits it that way and every icon in the package comes from that
  // generator. It used to be run through `toKebabCase(iconName)` here, which
  // was a no-op for every generated icon and shipped a 40-line character loop
  // to prove it.
  const kebab = iconName;
  const Component = ((props: LucideProps = {}, _registry?: Map<string, unknown>, walker?: unknown) => {
    const { className, class: cls, ...rest } = props as LucideProps & { className?: string; class?: string };
    // lucide-react merges `lucide-${kebab}` and `lucide-${iconName}` (original name is already kebab, but keep parity)
    const nameClasses = mergeClasses(`lucide-${kebab}`, `lucide-${iconName}`);
    const merged = mergeClasses(nameClasses, className as string, cls as string);
    return (Icon as unknown as (p: unknown, r?: unknown, w?: unknown) => unknown)(
      {
        ...rest,
        className: merged,
        iconNode,
      } as unknown as LucideProps & { iconNode: IconNode },
      _registry as Map<string, unknown>,
      walker as never,
    ) as string | SVGElement;
  }) as LucideIcon;

  // No displayName: it was `toPascalCase(iconName)`, which shipped the Pascal
  // and camel transforms (~1.6 KB of utils) purely to label a function for
  // DevTools. Nothing in Vesk reads it — there is no DevTools component tree —
  // and it is optional on the `LucideIcon` type. The Pascal name is also
  // already the binding name at every import site.
  Component.__iconNode = iconNode;
  return Component;
}

export default createLucideIcon;
