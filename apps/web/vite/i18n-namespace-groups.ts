import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import {
  DEFERRED_NAMESPACE_ALLOWLIST,
  WORK_ROUTE_I18N_NAMESPACES,
} from "../src/lib/i18n/work-route-namespaces";

const PREFIX = "virtual:taskdesk-i18n/";
const RESOLVED_PREFIX = `\0${PREFIX}`;
const LOCALE_FILE = /^([A-Za-z]{2,3}-[A-Za-z]{2,4})\.json$/u;

export type I18nNamespaceGroup = "slim" | "rest";

/** Splits one locale catalog into the first-paint group and everything else. */
export function splitI18nNamespaces(
  catalog: Record<string, unknown>,
  slimNamespaces: readonly string[] = WORK_ROUTE_I18N_NAMESPACES,
) {
  const slim: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [namespace, value] of Object.entries(catalog)) {
    (slimNamespaces.includes(namespace) ? slim : rest)[namespace] = value;
  }
  return { slim, rest };
}

/**
 * Namespaces a source file refers to: any `"ns:key"` string literal (covers `t(...)`, key tables
 * and `i18n.t(...)`), `useTranslation("ns")` / `useTranslation(["a", "b"])` and `{ ns: ... }`
 * options. `known` limits matches to real catalog namespaces.
 */
export function referencedNamespaces(
  source: string,
  known: readonly string[],
): Set<string> {
  const found = new Set<string>();
  const keep = (name: string | undefined) => {
    if (name && known.includes(name)) found.add(name);
  };
  for (const match of source.matchAll(/["'`]([A-Za-z]+):[A-Za-z_][\w.]*/g))
    keep(match[1]);
  for (const match of source.matchAll(
    /useTranslation\(\s*(\[[^\]]*\]|["'][^"']*["'])/g,
  ))
    for (const name of match[1].matchAll(/["']([A-Za-z]+)["']/g)) keep(name[1]);
  for (const match of source.matchAll(/\bns:\s*(\[[^\]]*\]|["'][^"']*["'])/g))
    for (const name of match[1].matchAll(/["']([A-Za-z]+)["']/g)) keep(name[1]);
  return found;
}

/**
 * First-paint modules (path -> source) that refer to a namespace outside the first-paint group
 * and are not on the reviewed allowlist. Each entry is a screen that could paint raw keys
 * before the deferred group lands.
 */
export function findDeferredNamespaceUsers(
  modules: ReadonlyMap<string, string>,
  known: readonly string[],
  {
    slim = WORK_ROUTE_I18N_NAMESPACES,
    allowed = DEFERRED_NAMESPACE_ALLOWLIST,
  }: {
    slim?: readonly string[];
    allowed?: Readonly<Record<string, readonly string[]>>;
  } = {},
) {
  const violations: { file: string; namespace: string }[] = [];
  for (const [file, source] of modules) {
    for (const namespace of referencedNamespaces(source, known)) {
      if (slim.includes(namespace)) continue;
      const entry = Object.entries(allowed).find(([suffix]) =>
        file.endsWith(suffix),
      );
      if (entry?.[1].includes(namespace)) continue;
      violations.push({ file, namespace });
    }
  }
  return violations;
}

function listLocales(i18nDir: string) {
  return readdirSync(i18nDir)
    .map((file) => LOCALE_FILE.exec(file)?.[1])
    .filter((locale): locale is string => locale !== undefined)
    .sort();
}

/**
 * Serves each locale catalog as two virtual modules, `slim-<locale>` and `rest-<locale>`, plus
 * a loader table per group. The catalog files stay the single source of truth, so
 * `check:i18n` and the translation workflow are untouched.
 */
export function i18nNamespaceGroups({
  i18nDir,
  groupedEntry = true,
}: {
  i18nDir: string;
  /**
   * False for a build whose entry never loads grouped catalogs (the portal): the loader tables
   * are empty, so no per-locale group chunks are emitted for it.
   */
  groupedEntry?: boolean;
}): Plugin {
  const isGroupModule = (id: string) => id.startsWith(RESOLVED_PREFIX);

  return {
    name: "taskdesk:i18n-namespace-groups",
    resolveId(source) {
      return source.startsWith(PREFIX) ? `\0${source}` : undefined;
    },
    load(id) {
      if (!isGroupModule(id)) return undefined;
      const name = id.slice(RESOLVED_PREFIX.length);
      const loaders = /^loaders-(slim|rest)$/u.exec(name);
      if (loaders && !groupedEntry) return "export default {};\n";
      if (loaders) {
        const group = loaders[1];
        const entries = listLocales(i18nDir).map(
          (locale) =>
            `  ${JSON.stringify(locale)}: () => import(${JSON.stringify(`${PREFIX}${group}-${locale}`)}),`,
        );
        return `export default {\n${entries.join("\n")}\n};\n`;
      }
      const group = /^(slim|rest)-([A-Za-z]{2,3}-[A-Za-z]{2,4})$/u.exec(name);
      if (!group) return undefined;
      const [, kind, locale] = group;
      const file = path.join(i18nDir, `${locale}.json`);
      this.addWatchFile(file);
      const parts = splitI18nNamespaces(JSON.parse(readFileSync(file, "utf8")));
      const body = JSON.stringify(
        JSON.stringify(parts[kind as I18nNamespaceGroup]),
      );
      return `export default JSON.parse(${body});\n`;
    },
    configureServer(server) {
      server.watcher.on("change", (file) => {
        if (path.dirname(file) !== i18nDir || !file.endsWith(".json")) return;
        for (const mod of server.moduleGraph.idToModuleMap.values())
          if (isGroupModule(mod.id ?? ""))
            server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}
