import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileNamespaces, missingKeysInSource } from "../i18n/literal-keys.mjs";

const reference = {
  common: { actions: { save: "Save" }, items_one: "{{count}} item" },
  workItems: {
    list: { columnKey: "Key", priority: { high: "High" } },
  },
};

describe("i18n literal key check", () => {
  it("reads namespaces from useTranslation, defaulting to common", () => {
    assert.deepEqual(
      [
        ...fileNamespaces(
          'useTranslation(); useTranslation(["workItems", "x"])',
        ),
      ],
      ["common", "workItems", "x"],
    );
  });

  it("accepts existing prefixed, unprefixed and plural keys", () => {
    const source = `
      const { t } = useTranslation("workItems");
      t("list.columnKey");
      t("common:actions.save");
      t("common:items", { count: 2 });
    `;
    assert.deepEqual(missingKeysInSource(source, reference), []);
  });

  it("reports a missing key even when the call has a defaultValue", () => {
    const source = `const { t } = useTranslation();
t("workItems:list.columns.key");
t("actions.refresh", { defaultValue: "Refresh" });`;
    assert.deepEqual(missingKeysInSource(source, reference), [
      { line: 2, key: "workItems:list.columns.key" },
      { line: 3, key: "common:actions.refresh" },
    ]);
  });

  it("treats an object node as missing, since t() cannot render it", () => {
    const source = 'useTranslation("workItems"); t("list.priority");';
    assert.deepEqual(missingKeysInSource(source, reference), [
      { line: 1, key: "workItems:list.priority" },
    ]);
  });

  it("skips calls it cannot resolve statically", () => {
    const source = `
      useTranslation();
      t(\`workItems:priority.\${p}\`);
      i18n.t("nowhere.key");
      instance.t("customer.request", { ns: "term" });
      t("nowhere.key", { ns: "term" });
    `;
    assert.deepEqual(missingKeysInSource(source, reference), []);
  });

  it("skips unprefixed keys in a file with no useTranslation", () => {
    assert.deepEqual(
      missingKeysInSource('export const f = (t) => t("nowhere");', reference),
      [],
    );
  });
});
