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

/** The shared boundary every gated surface is rendered inside. */
const BOUNDARY_RENDER = /<(?:Work|Deferred)?[A-Za-z]*NamespaceBoundary\b/;

/**
 * Modules reachable from `roots` by static AND dynamic imports without passing a namespace
 * boundary. An edge into a module listed in `gated` is a boundary when the importing module
 * renders the shared namespace boundary; traversal stops there. Route modules other than the
 * roots and the generated route tree are not followed: they render only after navigation, which
 * the root route gates on the deferred group.
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
    const rendersBoundary = BOUNDARY_RENDER.test(source);
    for (const specifier of importSpecifiers(source)) {
      const target = resolveSourceImport(srcDir, file, specifier);
      if (!target || modules.has(target)) continue;
      const normalized = target.replaceAll("\\", "/");
      if (/\.test\.tsx?$/.test(normalized)) continue;
      if (normalized.includes("/routeTree.")) continue;
      if (normalized.includes("/src/routes/") && !rootSet.has(target)) continue;
      if (rendersBoundary && isGated(target)) continue;
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
