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
