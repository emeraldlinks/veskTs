/**
 * @vesk-qr/test-app/api/qr — Server route that generates QR SVG variants.
 *
 * Query params:
 *   variant: shape-square | shape-small-square | shape-rounded-square |
 *            shape-micro-square | shape-circle | shape-rectangle |
 *            shape-combination | preset-architectural | preset-minimal |
 *            preset-technical | preset-micro | preset-structural |
 *            preset-monochrome | ec-L | ec-M | ec-Q | ec-H |
 *            custom-colors | monochrome
 *   data: payload to encode (default: https://cofoundr.ng/variants)
 *   seed: deterministic seed (default: 42)
 *   size: output size in px (default: 240)
 *
 * Returns SVG markup string with content-type image/svg+xml.
 */

import { CofoundrMatrix } from "vesk-qr"

const VARIANT_CONFIG: Record<string, {
  style?: Record<string, unknown>
  colors?: Record<string, string>
  options?: Record<string, unknown>
}> = {
  "shape-square": {
    style: { preset: "architectural", module: "square", connectors: true, microDetails: true },
    options: { seed: 42 },
  },
  "shape-small-square": {
    style: { preset: "architectural", module: "small-square", connectors: true, microDetails: true },
    options: { seed: 42 },
  },
  "shape-rounded-square": {
    style: { preset: "architectural", module: "rounded-square", connectors: true, microDetails: true },
    options: { seed: 42 },
  },
  "shape-micro-square": {
    style: { preset: "architectural", module: "micro-square", connectors: true, microDetails: true },
    options: { seed: 42 },
  },
  "shape-circle": {
    style: { preset: "architectural", module: "circle", connectors: true, microDetails: true },
    options: { seed: 42 },
  },
  "shape-rectangle": {
    style: { preset: "architectural", module: "rectangle", connectors: true, microDetails: true },
    options: { seed: 42 },
  },
  "shape-combination": {
    style: { preset: "architectural", module: "combination", connectors: true, microDetails: true },
    options: { seed: 42 },
  },
  "preset-architectural": {
    style: { preset: "architectural" },
    options: { seed: 42 },
  },
  "preset-minimal": {
    style: { preset: "architectural-minimal" },
    options: { seed: 42 },
  },
  "preset-technical": {
    style: { preset: "architectural-technical" },
    options: { seed: 42 },
  },
  "preset-micro": {
    style: { preset: "architectural-micro" },
    options: { seed: 42 },
  },
  "preset-structural": {
    style: { preset: "architectural-structural" },
    options: { seed: 42 },
  },
  "preset-monochrome": {
    style: { preset: "architectural-monochrome" },
    options: { seed: 42 },
  },
  "ec-L": { options: { errorCorrection: "L", seed: 42 } },
  "ec-M": { options: { errorCorrection: "M", seed: 42 } },
  "ec-Q": { options: { errorCorrection: "Q", seed: 42 } },
  "ec-H": { options: { errorCorrection: "H", seed: 42 } },
  "custom-colors": {
    style: { preset: "architectural" },
    colors: { foreground: "#FF6B35", background: "#2C3E50" },
    options: { seed: 42 },
  },
  monochrome: {
    style: { preset: "architectural-monochrome" },
    options: { seed: 42 },
  },
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const variant = searchParams.get("variant") || "shape-rounded-square"
  const data = searchParams.get("data") || "https://cofoundr.ng/variants"
  const seed = Number(searchParams.get("seed") || 42)
  const size = Number(searchParams.get("size") || 240)

  const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG["shape-rounded-square"]

  const qr = await CofoundrMatrix.generate({
    data,
    style: config.style,
    colors: config.colors,
    options: { ...config.options, seed, size },
  })

  const svg = qr.toSVG()

  return new Response(svg, {
    headers: { "content-type": "image/svg+xml" },
  })
}
