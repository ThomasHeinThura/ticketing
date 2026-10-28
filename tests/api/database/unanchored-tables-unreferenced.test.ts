/**
 * N2 forward item (formerly "open forward items after 0120"): `custom_field_type_visibility` and
 * `custom_field_value` carried no `workspace_id`, so the database could not stop a cross-tenant
 * reference. They were kept out of runtime code until anchored. Migration 0139 anchors both: this
 * test now guards the anchor itself (column NOT NULL, composite same-workspace foreign keys to the
 * field, and to the work item type / work item / project they reference), and it is why runtime
 * code may use the tables.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const MIGRATION = read(
  "../../../apps/api/drizzle/0139_custom_field_tenant_anchor.sql",
);
const DECLARATIONS = read("../../../apps/api/src/database/migration-schema.ts");

describe("N2 forward item: custom field tables are tenant anchored (0139)", () => {
  it("adds a backfilled NOT NULL workspace_id to both tables", () => {
    for (const table of [
      "custom_field_type_visibility",
      "custom_field_value",
    ]) {
      expect(MIGRATION).toContain(
        `ALTER TABLE "${table}" ADD COLUMN "workspace_id" text`,
      );
      expect(MIGRATION).toContain(
        `ALTER TABLE "${table}" ALTER COLUMN "workspace_id" SET NOT NULL`,
      );
      expect(MIGRATION).toMatch(
        new RegExp(`UPDATE "${table}" SET "workspace_id"`),
      );
    }
  });

  it("pins every reference to the same workspace with composite foreign keys", () => {
    for (const constraint of [
      "custom_field_type_visibility_workspace_field_fk",
      "custom_field_type_visibility_workspace_type_fk",
      "custom_field_value_workspace_field_fk",
      "custom_field_value_workspace_work_item_fk",
      "custom_field_value_workspace_project_fk",
    ]) {
      expect(MIGRATION).toContain(
        `ADD CONSTRAINT "${constraint}" FOREIGN KEY ("workspace_id"`,
      );
      expect(DECLARATIONS).toContain(`name: "${constraint}"`);
    }
  });

  it("drops the single-column foreign keys the composites replace", () => {
    for (const constraint of [
      "custom_field_type_visibility_custom_field_id_custom_field_id_fk",
      "custom_field_type_visibility_work_item_type_id_work_item_type_i",
      "custom_field_value_custom_field_id_custom_field_id_fk",
      "custom_field_value_project_id_project_id_fk",
    ]) {
      expect(MIGRATION).toContain(`DROP CONSTRAINT "${constraint}"`);
      expect(DECLARATIONS).not.toContain(`name: "${constraint}"`);
    }
  });
});
