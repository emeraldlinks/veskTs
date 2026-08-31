/**
 * @file types — single source of truth for lucide-vesk public types.
 * Mirrors lucide-react's LucideProps but adapted for Vesk (no React, no ForwardRef).
 * Fully typed, covers every SVG attribute via index signature + explicit common props.
 */

export type IconNode = Array<[tag: string, attrs: Record<string, string>]>;
export type SVGElementType = "circle" | "ellipse" | "g" | "line" | "path" | "polygon" | "polyline" | "rect";

/**
 * Common SVG presentation attributes that appear on Lucide icons.
 * We list them explicitly for IDE autocomplete; `[key: string]: unknown` allows any other SVG attr.
 */
export interface SVGProps {
  // geometry
  width?: string | number;
  height?: string | number;
  viewBox?: string;
  xmlns?: string;
  // presentation
  fill?: string;
  stroke?: string;
  "stroke-width"?: string | number;
  strokeWidth?: string | number;
  "stroke-linecap"?: string;
  strokeLinecap?: string;
  "stroke-linejoin"?: string;
  strokeLinejoin?: string;
  "stroke-dasharray"?: string;
  "stroke-dashoffset"?: string;
  opacity?: string | number;
  // a11y / global
  id?: string;
  class?: string;
  className?: string;
  style?: string;
  role?: string;
  title?: string;
  "aria-hidden"?: string | boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  // allow data-*, aria-*, etc.
  [key: `data-${string}`]: unknown;
  [key: `aria-${string}`]: unknown;
}

/**
 * Props for every Lucide icon in Vesk — identical shape to lucide-react's LucideProps
 * except React-specific `ref` is optional callback and `children` is Component.
 *
 * - `size` controls both width and height (default 24)
 * - `color` controls stroke (default currentColor)
 * - `strokeWidth` controls stroke-width (default 2)
 * - `absoluteStrokeWidth` recalculates strokeWidth relative to size (lucide-react parity)
 * - `class` / `className` and `style` are passed through to the root <svg>
 * - any other SVG attribute is allowed and forwarded
 *
 * The root svg always includes `lucide` and `lucide-{kebab-name}` classes via mergeClasses,
 * matching lucide-react's class handling. Never scoped — no style tag is emitted.
 */
export interface LucideProps extends SVGProps {
  /** Icon size in pixels (applied to width and height). Default 24. */
  size?: string | number;
  /** Stroke color. Default currentColor. */
  color?: string;
  /** Stroke width. Default 2. */
  strokeWidth?: string | number;
  /** When true, strokeWidth is scaled as `strokeWidth * 24 / size`. */
  absoluteStrokeWidth?: boolean;
  /** Extra class for the <svg> (merged with `lucide` and `lucide-{name}`). */
  className?: string;
  /** Alias for className — both are merged. */
  class?: string;
  /** Inline style for the <svg>. */
  style?: string;
  /** Optional <title> for a11y. When absent and no aria prop, aria-hidden="true" is set. */
  title?: string;
  /** Children are appended after the iconNode (same as lucide-react). */
  children?: unknown;
  /** Ref callback — receives the SVGSVGElement after mount (client only). */
  ref?: ((el: SVGSVGElement | null) => void) | null;
  // catch-all for any SVG attribute or event handler (onClick etc. — excluded from SSR HTML by Vesk)
  [key: string]: unknown;
}

/**
 * A Lucide icon component — callable as `<House size={24} />` in .vsk or `House({size:24})` in TS.
 * Returns an SVG string on the server and an SVGSVGElement on the client.
 * Never scoped — no style is emitted and the SVG is unstyled except for Lucide defaults.
 */
export type LucideIcon = ((props?: LucideProps) => string | SVGElement | SVGSVGElement | null) & {
  displayName?: string;
  __iconNode?: IconNode;
};

export type LucideIconWithNode = LucideIcon & {
  __iconNode: IconNode;
};
