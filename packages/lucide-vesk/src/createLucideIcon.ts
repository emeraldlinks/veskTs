/**
 * createLucideIcon — mirrors lucide-react's createLucideIcon but for Vesk.
 * Returns a Vesk-compatible icon component with the same props and class handling.
 * Never scoped — no style tag.
 */

import Icon from "./Icon.js";
import { toKebabCase, toPascalCase, mergeClasses } from "./utils.js";
import type { IconNode, LucideIcon, LucideProps } from "./types.js";

export function createLucideIcon(iconName: string, iconNode: IconNode): LucideIcon {
  const Component = ((props: LucideProps = {}, _registry?: Map<string, unknown>, walker?: unknown) => {
    const { className, class: cls, ...rest } = props as LucideProps & { className?: string; class?: string };
    const kebab = toKebabCase(iconName);
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

  Component.displayName = toPascalCase(iconName);
  Component.__iconNode = iconNode;
  return Component;
}

export default createLucideIcon;
