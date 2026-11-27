import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findDeferredNamespaceUsers } from "./i18n-namespace-groups";

const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];
const TYPE_ONLY_IMPORT =
  /\b(?:import|export)\s+type\b[^;]*?\bfrom\s*["'][^"']+["']/g;
const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

/**
 * Resolves a relative or `@/` import to a source file under `srcDir`; undefined for packages and
 * anything that is not application source.
 */
export function resolveSourceImport(
  srcDir: string,
  fromFile: string,
  specifier: string,
): string | undefined {
  const base = specifier.startsWith("@/")
    ? path.join(srcDir, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : undefined;
  if (!base) return undefined;
  const clean = base.split("?")[0];
  for (const candidate of [clean, ...EXTENSIONS.map((ext) => clean + ext)])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return undefined;
}

/** `void import("x")` only warms the module cache (hover/idle preload); nothing renders from it. */
const PRELOAD_ONLY_IMPORT = /\bvoid\s+import\(\s*["'][^"']+["']\s*\)/g;

/** Every static and dynamic import specifier a module can render from. */
export function importSpecifiers(source: string): string[] {
  return [
    ...source
      .replace(TYPE_ONLY_IMPORT, "")
      .replace(PRELOAD_ONLY_IMPORT, "")
      .matchAll(IMPORT_SPECIFIER),
  ].map((match) => match[1]);
}

const BOUNDARY_TAG = /<(\/?)(?:Work|Deferred)?[A-Za-z]*NamespaceBoundary\b/g;

/** End index (exclusive) of the JSX tag starting at `start`, skipping `{...}` and strings. */
function tagEnd(source: string, start: number): number {
  let depth = 0;
  let quote = "";
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return i + 1;
  }
  return source.length;
}

export type BoundaryElement = {
  /** Start and end of the opening tag, and of the closing tag. */
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
};

/** Every namespace boundary element with children (self-closing boundaries protect nothing). */
export function findBoundaryElements(source: string): BoundaryElement[] {
  const stack: { openStart: number; openEnd: number }[] = [];
  const elements: BoundaryElement[] = [];
  for (const match of source.matchAll(BOUNDARY_TAG)) {
    const start = match.index ?? 0;
    const end = tagEnd(source, start);
    if (match[1]) {
      const open = stack.pop();
      if (open) elements.push({ ...open, closeStart: start, closeEnd: end });
    } else if (!source.slice(start, end).endsWith("/>")) {
      stack.push({ openStart: start, openEnd: end });
    }
  }
  return elements;
}

/** Local names the module binds to the component imported from `specifier`. */
function boundNames(source: string, specifier: string): string[] {
  const quoted = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names: string[] = [];
  const statics = new RegExp(
    `\\bimport\\s+(?!type\\b)([^;]*?)\\s+from\\s*["']${quoted}["']`,
    "g",
  );
  for (const match of source.matchAll(statics)) {
    const clause = match[1];
    const def = /^([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
    if (def) names.push(def);
    for (const item of /\{([^}]*)\}/.exec(clause)?.[1].split(",") ?? []) {
      const name = item
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop();
      if (name && !/^type\s/.test(item.trim())) names.push(name);
    }
  }
  const dynamics = new RegExp(
    `([A-Za-z_$][\\w$]*)\\s*=\\s*lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*["']${quoted}["']`,
    "g",
  );
  for (const match of source.matchAll(dynamics)) names.push(match[1]);
  return names;
}

/**
 * True when the module renders the component it imports from `specifier` at least once and every
 * such JSX element is a descendant of a namespace boundary element. A boundary elsewhere in the
 * file, an empty boundary, or one that only carries the component in its `fallback` protects
 * nothing. Unknown bindings count as unprotected.
 */
export function isContainedInBoundary(
  source: string,
  specifier: string,
): boolean {
  const names = boundNames(source, specifier);
  if (names.length === 0) return false;
  const boundaries = findBoundaryElements(source);
  let uses = 0;
  for (const name of names) {
    for (const match of source.matchAll(
      new RegExp(`<${name}(?![\\w$.])`, "g"),
    )) {
      uses += 1;
      const at = match.index ?? 0;
      if (!boundaries.some((b) => at >= b.openEnd && at < b.closeStart))
        return false;
    }
  }
  return uses > 0;
}

/**
 * Modules reachable from `roots` by static AND dynamic imports without passing a namespace
 * boundary. An edge into a module listed in `gated` is a boundary only when every JSX use of
 * the imported component sits inside a namespace boundary element of the importer; traversal
 * stops there. Route modules other than the roots and the generated route tree are not
 * followed: they render only after navigation, which the root route gates on the deferred group.
 */
export function collectUngatedRenderModules({
  srcDir,
  roots,
  gated,
  read = (file) => readFileSync(file, "utf8"),
}: {
  srcDir: string;
  roots: readonly string[];
  gated: readonly string[];
  read?: (file: string) => string;
}): Map<string, string> {
  const rootSet = new Set(roots.map((root) => path.join(srcDir, root)));
  const isGated = (file: string) =>
    gated.some((suffix) => file.replaceAll("\\", "/").endsWith(suffix));
  const modules = new Map<string, string>();
  const visit = (file: string) => {
    if (modules.has(file)) return;
    const source = read(file);
    modules.set(file, source);
    for (const specifier of importSpecifiers(source)) {
      const target = resolveSourceImport(srcDir, file, specifier);
      if (!target || modules.has(target)) continue;
      const normalized = target.replaceAll("\\", "/");
      if (/\.test\.tsx?$/.test(normalized)) continue;
      if (normalized.includes("/routeTree.")) continue;
      if (normalized.includes("/src/routes/") && !rootSet.has(target)) continue;
      if (isGated(target) && isContainedInBoundary(source, specifier)) continue;
      visit(target);
    }
  };
  for (const root of rootSet) visit(root);
  return modules;
}

/** Deferred-namespace reads reachable on the work route and shell without a boundary. */
export function findUngatedDeferredReads(options: {
  srcDir: string;
  roots: readonly string[];
  gated: readonly string[];
  known: readonly string[];
  /** Only these namespaces are reported; the others predate the split. */
  only: readonly string[];
  read?: (file: string) => string;
}) {
  return findDeferredNamespaceUsers(
    collectUngatedRenderModules(options),
    options.known,
  ).filter((violation) => options.only.includes(violation.namespace));
}
