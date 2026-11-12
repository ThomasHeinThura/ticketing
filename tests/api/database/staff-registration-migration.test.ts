import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const drizzle = resolve(import.meta.dirname, "../../../apps/api/drizzle");
const snapshot = (number: string) =>
  JSON.parse(
    readFileSync(resolve(drizzle, `meta/${number}_snapshot.json`), "utf8"),
  );

describe("staff registration follows notification provider step-up", () => {
  it("preserves every train table and adds only the default-closed setting", () => {
    const before = snapshot("0219");
    const after = snapshot("0220");
    expect(after.prevId).toBe(before.id);
    expect(after.id).not.toBe(before.id);
    const column =
      after.tables["public.instance_setting"].columns
        .staff_self_registration_enabled;
    expect(column).toMatchObject({
      type: "boolean",
      notNull: true,
      default: false,
    });
    delete after.tables["public.instance_setting"].columns
      .staff_self_registration_enabled;
    expect(after.tables).toEqual(before.tables);
    expect(
      after.tables["public.step_up_confirmation"].checkConstraints
        .step_up_operation_route.value,
    ).toContain("notification_provider_save");
  });

  it("changes only registration and leaves the SES constraint in force", () => {
    const sql = readFileSync(
      resolve(drizzle, "0220_staff_self_registration.sql"),
      "utf8",
    );
    expect(sql.trim()).toBe(
      'ALTER TABLE "instance_setting" ADD COLUMN "staff_self_registration_enabled" boolean DEFAULT false NOT NULL;',
    );
  });
});
