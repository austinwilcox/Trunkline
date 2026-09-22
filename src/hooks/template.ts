/**
 * Minimal `{{ var | filter }}` template renderer.
 *
 * Purpose-built for hook command templates so we avoid a full Jinja2 engine.
 * v1 supports:
 *   - `{{ name }}` variable substitution
 *   - dotted access: `{{ vars.port }}`
 *   - filters: `{{ branch | sanitize }}`
 *   - filter arguments: `{{ branch | codename(2) }}` (arg parsing only for now)
 *
 * Conditionals/loops are intentionally out of scope for v1.
 */

export type TemplateContext = Record<string, unknown>;

export type Filter = (input: unknown, args: string[]) => string;

/** Built-in filters. Extend as commands need them. */
export const FILTERS: Record<string, Filter> = {
  sanitize: (v) => String(v).replaceAll("/", "-").replaceAll("\\", "-"),
  hash: (v) => hash3(String(v)),
  hash_port: (v) => String(10000 + (hashInt(String(v)) % 10000)),
  dirname: (v) => {
    const s = String(v).replace(/\/+$/, "");
    const i = s.lastIndexOf("/");
    return i <= 0 ? (i === 0 ? "/" : s) : s.slice(0, i);
  },
  basename: (v) => {
    const s = String(v).replace(/\/+$/, "");
    const i = s.lastIndexOf("/");
    return i === -1 ? s : s.slice(i + 1);
  },
  sanitize_hash: (v) => {
    const s = String(v);
    const safe = s.replaceAll("/", "-").replaceAll("\\", "-");
    return safe === s ? s : `${safe}-${hash3(s)}`;
  },
};

const PLACEHOLDER = /\{\{\s*(.*?)\s*\}\}/g;

export function render(template: string, ctx: TemplateContext): string {
  return template.replace(PLACEHOLDER, (_m, expr: string) => {
    return evalExpr(expr, ctx);
  });
}

function evalExpr(expr: string, ctx: TemplateContext): string {
  const [head, ...filterParts] = expr.split("|").map((s) => s.trim());
  let value = lookup(head, ctx);

  for (const part of filterParts) {
    const { name, args } = parseFilter(part);
    const filter = FILTERS[name];
    if (!filter) {
      throw new Error(`Unknown template filter: '${name}'`);
    }
    value = filter(value, args);
  }

  if (value === undefined || value === null) {
    throw new Error(`Undefined template variable: '${head}'`);
  }
  return String(value);
}

function lookup(path: string, ctx: TemplateContext): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, ctx);
}

function parseFilter(part: string): { name: string; args: string[] } {
  const m = part.match(/^(\w+)\s*(?:\((.*)\))?$/);
  if (!m) throw new Error(`Invalid filter syntax: '${part}'`);
  const name = m[1];
  const args = m[2]
    ? m[2].split(",").map((a) => a.trim().replace(/^['"]|['"]$/g, ""))
    : [];
  return { name, args };
}

// --- hashing helpers ---

function hashInt(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function hash3(s: string): string {
  return hashInt(s).toString(36).slice(0, 3).padStart(3, "0");
}
