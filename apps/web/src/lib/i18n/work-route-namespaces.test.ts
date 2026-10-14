import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splitI18nNamespaces } from "../../../vite/i18n-namespace-groups";
import {
  WORK_LIST_PATH_PATTERN,
  WORK_ROUTE_I18N_NAMESPACES,
} from "./work-route-namespaces";

const i18nDir = path.resolve(__dirname, "../../../../../i18n");
const locales = readdirSync(i18nDir).filter((file) =>
  /^[A-Za-z]{2,3}-[A-Za-z]{2,4}\.json$/u.test(file),
);

describe("work route namespace groups", () => {
  it("names only namespaces that exist in every locale catalog", () => {
    expect(locales.length).toBeGreaterThan(1);
    for (const file of locales) {
      const catalog = JSON.parse(
        readFileSync(path.join(i18nDir, file), "utf8"),
      );
      for (const namespace of WORK_ROUTE_I18N_NAMESPACES)
        expect(Object.keys(catalog), `${file} ${namespace}`).toContain(
          namespace,
        );
    }
  });

  it("keeps every namespace the work route paints with in the first-paint group", () => {
    // A quick unit-level check; the build also fails for any module in the work route's real
    // first-paint chunks (`findDeferredNamespaceUsers` in vite.config.ts), which is the guard that
    // does not depend on this hand-kept list.
    // The route, its panel, list, loading state, selection and create controls, and the
    // sidebar it renders inside. A namespace used here but missing from the first-paint group
    // would show raw keys on the primary screen until the deferred group lands.
    const srcDir = path.resolve(__dirname, "../..");
    const files = [
      "routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx",
      "components/work-item/work-items-panel.tsx",
      "components/work-item/work-item-list.tsx",
      "components/work-item/work-item-list-loading.tsx",
      "components/work-item/work-item-selection-toggle.tsx",
      "components/work-item/work-item-create-trigger.tsx",
      "components/work-item/work-item-create-dialog-shell.tsx",
      "components/app-sidebar.tsx",
      "components/nav-main.tsx",
      "components/nav-projects.tsx",
    ];
    const used = new Set<string>();
    for (const file of files) {
      const source = readFileSync(path.join(srcDir, file), "utf8");
      for (const match of source.matchAll(/\bt\(\s*["'`]([A-Za-z]+):/g))
        used.add(match[1]);
    }
    expect(used.has("workItems")).toBe(true);
    for (const namespace of used)
      expect(WORK_ROUTE_I18N_NAMESPACES as readonly string[]).toContain(
        namespace,
      );
  });

  it("splits a catalog into disjoint groups that together hold every namespace", () => {
    for (const file of locales) {
      const catalog = JSON.parse(
        readFileSync(path.join(i18nDir, file), "utf8"),
      );
      const { slim, rest } = splitI18nNamespaces(catalog);
      expect(Object.keys(slim).sort()).toEqual(
        [...WORK_ROUTE_I18N_NAMESPACES].sort(),
      );
      expect(Object.keys(slim).filter((key) => key in rest)).toEqual([]);
      expect({ ...slim, ...rest }).toEqual(catalog);
    }
  });

  it("matches the work-list route only", () => {
    expect(WORK_LIST_PATH_PATTERN.test("/agent/projects/WLP/work")).toBe(true);
    expect(WORK_LIST_PATH_PATTERN.test("/agent/projects/WLP/work/")).toBe(true);
    expect(WORK_LIST_PATH_PATTERN.test("/agent/projects/WLP/board")).toBe(
      false,
    );
    expect(WORK_LIST_PATH_PATTERN.test("/dashboard")).toBe(false);
  });
});
