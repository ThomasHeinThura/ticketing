import { describe, expect, it } from "vitest";
import {
  findDeferredNamespaceUsers,
  referencedNamespaces,
} from "../../../vite/i18n-namespace-groups";

const KNOWN = ["common", "navigation", "workItems", "settings", "tasks"];

describe("referencedNamespaces", () => {
  it("finds every way a source file names a namespace", () => {
    const source = `
      t("settings:profile.title");
      i18n.t('tasks:status.open');
      const key = \`navigation:page.home\`;
      const table = { label: "workItems:list.heading" };
      useTranslation("tasks");
      useTranslation(["common", "settings"]);
      i18n.t("title", { ns: "settings" });
      other("notANamespace:foo.bar");
      const url = "http://example.com:8080/path";
    `;
    expect([...referencedNamespaces(source, KNOWN)].sort()).toEqual([
      "common",
      "navigation",
      "settings",
      "tasks",
      "workItems",
    ]);
  });

  it("ignores text that only looks like a key", () => {
    expect(
      referencedNamespaces('const a = "note: remember this.";', KNOWN).size,
    ).toBe(0);
  });
});

describe("findDeferredNamespaceUsers", () => {
  const slim = ["common", "navigation", "workItems"];

  it("passes when first-paint modules use only first-paint namespaces", () => {
    const modules = new Map([
      ["/src/a.tsx", 't("workItems:list.heading"); useTranslation("common");'],
    ]);
    expect(findDeferredNamespaceUsers(modules, KNOWN, { slim })).toEqual([]);
  });

  it("flags a first-paint module that uses a deferred namespace, in any form", () => {
    for (const source of [
      't("settings:profile.title")',
      'useTranslation("settings")',
      'useTranslation(["common", "tasks"])',
      'i18n.t("x", { ns: "settings" })',
    ]) {
      const modules = new Map([["/src/components/panel.tsx", source]]);
      const violations = findDeferredNamespaceUsers(modules, KNOWN, { slim });
      expect(violations, source).toHaveLength(1);
      expect(violations[0].file).toBe("/src/components/panel.tsx");
    }
  });

  it("flags a module that loses its first-paint namespace", () => {
    const modules = new Map([["/src/a.tsx", 't("workItems:list.heading")']]);
    expect(
      findDeferredNamespaceUsers(modules, KNOWN, { slim: ["common"] }),
    ).toEqual([{ file: "/src/a.tsx", namespace: "workItems" }]);
  });

  it("accepts only the namespaces an allowlist entry names", () => {
    const modules = new Map([
      ["/src/components/panel.tsx", 't("settings:a.b"); t("tasks:c.d");'],
    ]);
    expect(
      findDeferredNamespaceUsers(modules, KNOWN, {
        slim,
        allowed: { "components/panel.tsx": ["settings"] },
      }),
    ).toEqual([{ file: "/src/components/panel.tsx", namespace: "tasks" }]);
  });
});
