import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "src");
const ui = path.resolve(root, "../../packages/ui/src");
const uiExports = new Map<string, string>();
for (const match of readFileSync(path.join(ui, "index.ts"), "utf8").matchAll(
  /export\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g,
)) {
  const file = [
    `${path.join(ui, match[2])}.tsx`,
    `${path.join(ui, match[2])}.ts`,
  ].find(existsSync);
  if (!file) continue;
  for (const item of match[1].split(",")) {
    const name = item
      .trim()
      .split(/\s+as\s+/)
      .at(-1);
    if (name) uiExports.set(name, file);
  }
}
for (const match of readFileSync(path.join(ui, "index.ts"), "utf8").matchAll(
  /export \* from "([^"]+)"/g,
)) {
  const file = [
    `${path.join(ui, match[1])}.tsx`,
    `${path.join(ui, match[1])}.ts`,
  ].find(existsSync);
  if (!file) continue;
  const text = readFileSync(file, "utf8");
  for (const named of text.matchAll(
    /export\s+(?:function|const|class)\s+(\w+)/g,
  ))
    uiExports.set(named[1], file);
  for (const block of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const item of block[1].split(",")) {
      const name = item
        .trim()
        .split(/\s+as\s+/)
        .at(-1);
      if (name) uiExports.set(name, file);
    }
  }
}
const resolveModule = (base: string) =>
  [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ].find((file) => existsSync(file) && /\.[cm]?[jt]sx?$/.test(file));

describe("portal stylesheet coverage", () => {
  it("keeps every statically named portal import, including lazy screens, in the CSS scan", () => {
    const css = readFileSync(path.join(source, "portal.css"), "utf8");
    const excluded = [...css.matchAll(/@source not "([^"]+)"/g)].map((match) =>
      path.resolve(source, match[1]),
    );
    const seen = new Set<string>();
    const invalid: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      if (
        excluded.some(
          (prefix) => file === prefix || file.startsWith(prefix + path.sep),
        )
      )
        invalid.push(file);
      const code = readFileSync(file, "utf8").replace(
        /import\s+type\b[\s\S]*?from\s*["'][^"']+["'];?/g,
        "",
      );
      for (const named of code.matchAll(
        /import\s*\{([^}]+)\}\s*from\s*["']@taskdesk\/ui["']/g,
      )) {
        for (const item of named[1].split(",")) {
          const symbol = item.trim().split(/\s+as\s+/)[0];
          if (!symbol || symbol.startsWith("type ")) continue;
          const target = uiExports.get(symbol);
          expect(target, `UI export ${symbol}`).toBeDefined();
          if (target) visit(target);
        }
      }
      for (const match of code.matchAll(
        /(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/g,
      )) {
        const specifier = match[1];
        const base = specifier.startsWith("@/")
          ? path.join(source, specifier.slice(2))
          : specifier.startsWith(".")
            ? path.resolve(path.dirname(file), specifier)
            : undefined;
        if (!base) continue;
        const target = resolveModule(base);
        if (target) visit(target);
      }
    };
    visit(path.join(root, "portal/main.tsx"));
    expect(invalid).toEqual([]);
    expect(seen.size).toBeGreaterThan(100);
  });
});
