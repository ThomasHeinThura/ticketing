import { describe, expect, it } from "vitest";
import { WORKSPACE_LABEL_NAME_LOCK_NAMESPACE } from "../../apps/api/src/label/label-name-lock";
import { COLUMN_SEED_LOCK_NAMESPACE } from "../../apps/api/src/migrations/column-migration";

describe("label advisory-lock namespace", () => {
  it("uses a distinct namespace from column seeding", () => {
    expect(WORKSPACE_LABEL_NAME_LOCK_NAMESPACE).not.toBe(
      COLUMN_SEED_LOCK_NAMESPACE,
    );
  });
});
