/**
 * Utilities — mirrors lucide-react's shared/src/utils but never uses regex for parsing.
 * toKebabCase / toPascalCase are character-loop implementations (no regex) per repo rule.
 * mergeClasses and hasA11yProp are identical behaviour to lucide-react.
 */

export function toKebabCase(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    const code = ch.charCodeAt(0);
    const isUpper = code >= 65 && code <= 90;
    if (isUpper) {
      if (i !== 0) out += "-";
      out += String.fromCharCode(code + 32);
    } else if (ch === "_" || ch === " ") {
      out += "-";
    } else {
      out += ch;
    }
  }
  // collapse "--" -> "-" and lower is already
  let collapsed = "";
  let lastWasDash = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    if (c === "-") {
      if (!lastWasDash) collapsed += "-";
      lastWasDash = true;
    } else {
      collapsed += c.toLowerCase();
      lastWasDash = false;
    }
  }
  // trim leading/trailing -
  let s = 0;
  let e = collapsed.length;
  while (s < e && collapsed[s] === "-") s++;
  while (e > s && collapsed[e - 1] === "-") e--;
  return collapsed.slice(s, e);
}

export function toCamelCase(value: string): string {
  let out = "";
  let capNext = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "-" || ch === "_" || ch === " ") {
      capNext = true;
      continue;
    }
    if (i === 0) {
      out += ch.toLowerCase();
      capNext = false;
      continue;
    }
    if (capNext) {
      out += ch.toUpperCase();
      capNext = false;
    } else {
      out += ch;
    }
  }
  return out;
}

export function toPascalCase(value: string): string {
  const camel = toCamelCase(value);
  if (camel.length === 0) return "";
  return camel[0]!.toUpperCase() + camel.slice(1);
}

export function mergeClasses(...classes: Array<string | undefined | null | false>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of classes) {
    if (!c) continue;
    const t = c.trim();
    if (t === "") continue;
    // split by spaces to de-dupe tokens
    const parts = t.split(" ");
    for (const p of parts) {
      const tok = p.trim();
      if (tok === "" || seen.has(tok)) continue;
      seen.add(tok);
      out.push(tok);
    }
  }
  return out.join(" ");
}

export function hasA11yProp(props: Record<string, unknown>): boolean {
  for (const key in props) {
    if (key.length >= 5 && key[0] === "a" && key.startsWith("aria-")) return true;
    if (key === "role" || key === "title") return true;
  }
  return false;
}
