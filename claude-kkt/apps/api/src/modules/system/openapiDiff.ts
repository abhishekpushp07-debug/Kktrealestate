/**
 * OpenAPI compatibility diff (docs/VERSIONING.md). Compares the committed snapshot (docs/openapi/v1.json) with the document the code
 * generates now and classifies every difference:
 *
 * Breaking (fails CI):
 *  - a path or an operation was removed (unless it was `deprecated` with an `x-sunset` date that has passed: a retirement, reported as
 *    a notice), or an operation lost its success status;
 *  - a response property was removed (clients may read it), changed type, or stopped being required (clients may rely on its presence);
 *  - a request property / parameter became required, or a new required one appeared;
 *  - a request property was removed (request schemas are strict: old clients still sending it would get 400) or changed type;
 *  - an enum value was removed (request: old clients send it; response: old clients switch on it), or a free request value became an
 *    enum;
 *  - a request bound tightened (maxLength/maximum/maxItems lowered or added, minLength/minimum/minItems raised or added).
 *
 * Additive (allowed within v1): new paths/operations, new optional request properties/parameters, new response properties, new enum
 * values in requests; new enum values in responses are reported as notices (clients must tolerate unknown values).
 */

type Json = Record<string, unknown>;

/** Result of a compatibility diff. */
export interface OpenApiDiff {
  breaking: string[];
  additive: string[];
  notices: string[];
}

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Resolves `$ref` against the document (`#/components/...`) or the schema root (`#/$defs/...`, `#/definitions/...`). */
function resolver(doc: Json) {
  return function resolve(node: unknown, root: unknown, seen: Set<unknown> = new Set()): Json | null {
    if (!isObj(node)) return null;
    const ref = node["$ref"];
    if (typeof ref !== "string") return node;
    if (seen.has(ref)) return null;
    seen.add(ref);
    const parts = ref.replace(/^#\//, "").split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let base: unknown = ref.startsWith("#/components/") ? doc : root;
    for (const p of parts) base = isObj(base) ? base[p] : undefined;
    return resolve(base, root, seen);
  };
}

/** Flattened view of a schema: property paths with type, requiredness and enum values. */
interface Shape {
  /** path → info; "" is the root. */
  nodes: Map<string, { types: Set<string>; required: boolean; enumValues: Set<string> | null; bounds: Record<string, number | null> }>;
}

/** Validation bounds of a node (request tightening is breaking). */
type Bounds = Partial<Record<(typeof UPPER_BOUNDS)[number] | (typeof LOWER_BOUNDS)[number], number>>;
const UPPER_BOUNDS = ["maxLength", "maximum", "exclusiveMaximum", "maxItems"] as const;
const LOWER_BOUNDS = ["minLength", "minimum", "exclusiveMinimum", "minItems"] as const;

const BOUND_APPLIES_TO: Record<keyof Bounds, readonly string[]> = {
  maxLength: ["string"], minLength: ["string"],
  maximum: ["number", "integer"], minimum: ["number", "integer"], exclusiveMaximum: ["number", "integer"], exclusiveMinimum: ["number", "integer"],
  maxItems: ["array"], minItems: ["array"],
};

/**
 * Merges the bounds of one (branch) schema into a node. Only branches whose type the keyword applies to count (`maxLength` of the string
 * branch of `string | null`); a union is as permissive as its loosest applicable branch, and a branch without the keyword is unbounded
 * (`null`). Untyped wrappers (`anyOf` containers) contribute nothing.
 */
function mergeBounds(into: Record<string, number | null>, s: Json, types: Set<string>): void {
  for (const k of [...UPPER_BOUNDS, ...LOWER_BOUNDS]) {
    if (!BOUND_APPLIES_TO[k].some((t) => types.has(t))) continue;
    const v = typeof s[k] === "number" ? (s[k] as number) : null;
    if (!(k in into)) into[k] = v;
    else if (into[k] === null || v === null) into[k] = null;
    else into[k] = (UPPER_BOUNDS as readonly string[]).includes(k) ? Math.max(into[k]!, v) : Math.min(into[k]!, v);
  }
}

/** The effective (non-null) bounds of a node. */
function boundsOf(raw: Record<string, number | null>): Bounds {
  const b: Bounds = {};
  for (const [k, v] of Object.entries(raw)) if (v !== null) b[k as keyof Bounds] = v;
  return b;
}

function typesOf(s: Json): Set<string> {
  const t = s["type"];
  const out = new Set<string>();
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) for (const x of t) out.add(String(x));
  if (s["const"] !== undefined && out.size === 0) out.add(typeof s["const"]);
  return out;
}

function flatten(schema: unknown, resolve: ReturnType<typeof resolver>): Shape {
  const shape: Shape = { nodes: new Map() };
  const root = schema;
  const visit = (node: unknown, path: string, required: boolean, depth: number, stack: Set<Json>) => {
    const s = resolve(node, root);
    if (!s || depth > 12 || stack.has(s)) return;
    const next = new Set(stack).add(s);
    const existing = shape.nodes.get(path);
    const types = typesOf(s);
    const en = Array.isArray(s["enum"]) ? new Set((s["enum"] as unknown[]).map((v) => JSON.stringify(v))) : s["const"] !== undefined ? new Set([JSON.stringify(s["const"])]) : null;
    if (existing) {
      for (const t of types) existing.types.add(t);
      existing.required = existing.required && required;
      if (en) existing.enumValues = existing.enumValues ? new Set([...existing.enumValues, ...en]) : en;
      mergeBounds(existing.bounds, s, types);
    } else {
      const bounds: Record<string, number | null> = {};
      mergeBounds(bounds, s, types);
      shape.nodes.set(path, { types, required, enumValues: en, bounds });
    }
    for (const key of ["anyOf", "oneOf", "allOf"] as const) {
      const branches = s[key];
      if (Array.isArray(branches)) for (const b of branches) visit(b, path, required, depth + 1, next);
    }
    const props = s["properties"];
    if (isObj(props)) {
      const req = new Set(Array.isArray(s["required"]) ? (s["required"] as string[]) : []);
      for (const [name, child] of Object.entries(props)) visit(child, path ? `${path}.${name}` : name, req.has(name), depth + 1, next);
    }
    if (s["items"] !== undefined) visit(s["items"], `${path}[]`, true, depth + 1, next);
    if (isObj(s["additionalProperties"])) visit(s["additionalProperties"], `${path}{}`, false, depth + 1, next);
  };
  visit(schema, "", true, 0, new Set());
  return shape;
}

interface Operation {
  key: string;
  op: Json;
}

function operations(doc: Json): Map<string, Operation> {
  const out = new Map<string, Operation>();
  const paths = isObj(doc["paths"]) ? doc["paths"] : {};
  for (const [p, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    for (const m of METHODS) {
      const op = item[m];
      if (isObj(op)) out.set(`${m.toUpperCase()} ${p}`, { key: `${m.toUpperCase()} ${p}`, op: { ...op, parameters: [...(Array.isArray(item["parameters"]) ? item["parameters"] : []), ...(Array.isArray(op["parameters"]) ? op["parameters"] : [])] } });
    }
  }
  return out;
}

function jsonSchemaOf(content: unknown): unknown {
  if (!isObj(content)) return undefined;
  const json = content["application/json"] ?? Object.values(content)[0];
  return isObj(json) ? json["schema"] : undefined;
}

function successResponses(op: Json): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const responses = isObj(op["responses"]) ? op["responses"] : {};
  for (const [status, r] of Object.entries(responses)) {
    if (!/^2\d\d$/.test(status) || !isObj(r)) continue;
    out.set(status, jsonSchemaOf(r["content"]));
  }
  return out;
}

function requestShape(op: Json, resolve: ReturnType<typeof resolver>): Shape {
  const shape: Shape = { nodes: new Map() };
  const body = isObj(op["requestBody"]) ? jsonSchemaOf(op["requestBody"]["content"]) : undefined;
  if (body !== undefined) {
    const bodyRequired = isObj(op["requestBody"]) && op["requestBody"]["required"] === true;
    for (const [p, n] of flatten(body, resolve).nodes) shape.nodes.set(p ? `body.${p}` : "body", { ...n, required: p ? n.required : bodyRequired });
  }
  for (const raw of (op["parameters"] as unknown[]) ?? []) {
    const prm = resolve(raw, raw);
    if (!prm || typeof prm["name"] !== "string") continue;
    const base = `${String(prm["in"])}:${String(prm["name"])}`;
    const flat = flatten(prm["schema"] ?? {}, resolve);
    for (const [p, n] of flat.nodes) shape.nodes.set(p ? `${base}.${p}` : base, { ...n, required: p ? n.required : prm["required"] === true });
  }
  return shape;
}

/** True when `path` is a strict descendant of a node that is missing in `shape` (report only the topmost removal). */
function parentMissing(path: string, shape: Shape): boolean {
  const parts = path.split(/(?=\.|\[\]|\{\})/);
  let prefix = "";
  for (let i = 0; i < parts.length - 1; i++) {
    prefix += parts[i];
    if (!shape.nodes.has(prefix)) return true;
  }
  return false;
}

function typeChanged(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const norm = (s: Set<string>) => new Set([...s].map((t) => (t === "integer" ? "number" : t)));
  const na = norm(a);
  const nb = norm(b);
  // widening (e.g. string → [string, null] in a response is breaking for strict readers; in a request it is additive) is handled by the caller
  return ![...na].every((t) => nb.has(t)) || ![...nb].every((t) => na.has(t));
}

/** Request bounds that got stricter between base and current (old clients may send values the new schema rejects). */
function tightenedBounds(b: Bounds, c: Bounds): string[] {
  const out: string[] = [];
  for (const k of UPPER_BOUNDS) if (c[k] !== undefined && (b[k] === undefined || c[k]! < b[k]!)) out.push(`${k} ${b[k] ?? "none"} → ${c[k]}`);
  for (const k of LOWER_BOUNDS) if (c[k] !== undefined && (b[k] === undefined || c[k]! > b[k]!)) out.push(`${k} ${b[k] ?? "none"} → ${c[k]}`);
  return out;
}

/** Options of {@link diffOpenApi}. */
export interface DiffOptions {
  /** "Today" for sunset checks (default: now). */
  now?: Date;
}

/** Compares two OpenAPI documents (base = committed snapshot, current = generated now). */
export function diffOpenApi(base: Json, current: Json, opts: DiffOptions = {}): OpenApiDiff {
  const out: OpenApiDiff = { breaking: [], additive: [], notices: [] };
  const rb = resolver(base);
  const rc = resolver(current);
  const ob = operations(base);
  const oc = operations(current);
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);

  for (const [key, { op }] of ob) {
    if (oc.has(key)) continue;
    const sunset = typeof op["x-sunset"] === "string" ? op["x-sunset"] : null;
    if (op["deprecated"] === true && sunset !== null && sunset <= today) out.notices.push(`${key}: retired (deprecated, sunset ${sunset})`);
    else out.breaking.push(`${key}: operation removed${op["deprecated"] === true && sunset ? ` before its sunset ${sunset}` : ""}`);
  }
  for (const [key] of oc) if (!ob.has(key)) out.additive.push(`${key}: operation added`);

  for (const [key, { op: bop }] of ob) {
    const cur = oc.get(key);
    if (!cur) continue;
    const cop = cur.op;

    // responses
    const br = successResponses(bop);
    const cr = successResponses(cop);
    for (const [status, bSchema] of br) {
      if (!cr.has(status)) {
        out.breaking.push(`${key}: success response ${status} removed`);
        continue;
      }
      const bs = flatten(bSchema, rb);
      const cs = flatten(cr.get(status), rc);
      for (const [path, bn] of bs.nodes) {
        const label = path || "(body)";
        const cn = cs.nodes.get(path);
        if (!cn) {
          if (!parentMissing(path, cs)) out.breaking.push(`${key}: response ${status} property "${label}" removed`);
          continue;
        }
        if (bn.required && !cn.required && path !== "") out.breaking.push(`${key}: response ${status} property "${label}" is no longer required`);
        if (typeChanged(bn.types, cn.types)) {
          const widenedToNull = [...bn.types].every((t) => cn.types.has(t));
          (widenedToNull ? out.notices : out.breaking).push(`${key}: response ${status} property "${label}" type ${[...bn.types].join("|")} → ${[...cn.types].join("|")}`);
        }
        if (bn.enumValues && cn.enumValues) {
          const removed = [...bn.enumValues].filter((v) => !cn.enumValues!.has(v));
          const added = [...cn.enumValues].filter((v) => !bn.enumValues!.has(v));
          if (removed.length) out.breaking.push(`${key}: response ${status} property "${label}" enum values removed: ${removed.join(", ")}`);
          if (added.length) out.notices.push(`${key}: response ${status} property "${label}" enum values added: ${added.join(", ")}`);
        }
      }
      for (const [path] of cs.nodes) if (!bs.nodes.has(path) && !parentMissing(path, bs)) out.additive.push(`${key}: response ${status} property "${path || "(body)"}" added`);
    }

    // requests
    const bq = requestShape(bop, rb);
    const cq = requestShape(cop, rc);
    for (const [path, cn] of cq.nodes) {
      const bn = bq.nodes.get(path);
      if (!bn) {
        // only the topmost new node counts: required fields inside a new optional object do not affect old clients
        if (parentMissing(path, bq)) continue;
        if (cn.required) out.breaking.push(`${key}: request "${path}" added as required`);
        else out.additive.push(`${key}: request "${path}" added (optional)`);
        continue;
      }
      if (cn.required && !bn.required) out.breaking.push(`${key}: request "${path}" became required`);
      if (typeChanged(bn.types, cn.types)) {
        const widened = [...bn.types].every((t) => cn.types.has(t));
        (widened ? out.additive : out.breaking).push(`${key}: request "${path}" type ${[...bn.types].join("|")} → ${[...cn.types].join("|")}`);
      }
      if (bn.enumValues && cn.enumValues) {
        const removed = [...bn.enumValues].filter((v) => !cn.enumValues!.has(v));
        const added = [...cn.enumValues].filter((v) => !bn.enumValues!.has(v));
        if (removed.length) out.breaking.push(`${key}: request "${path}" enum values removed: ${removed.join(", ")}`);
        if (added.length) out.additive.push(`${key}: request "${path}" enum values added: ${added.join(", ")}`);
      } else if (!bn.enumValues && cn.enumValues) {
        out.breaking.push(`${key}: request "${path}" restricted to enum values ${[...cn.enumValues].join(", ")}`);
      }
      const tightened = tightenedBounds(boundsOf(bn.bounds), boundsOf(cn.bounds));
      if (tightened.length) out.breaking.push(`${key}: request "${path}" bounds tightened: ${tightened.join(", ")}`);
    }
    for (const [path] of bq.nodes) {
      if (cq.nodes.has(path) || parentMissing(path, cq)) continue;
      out.breaking.push(`${key}: request "${path}" removed (strict request schemas reject it from old clients)`);
    }
  }
  return out;
}

/** Human-readable report of a diff. */
export function formatDiff(d: OpenApiDiff): string {
  const section = (title: string, items: string[]) => (items.length ? `${title} (${items.length}):\n${items.map((i) => `  - ${i}`).join("\n")}` : `${title}: none`);
  return [section("BREAKING", d.breaking), section("Additive", d.additive), section("Notices", d.notices)].join("\n");
}
