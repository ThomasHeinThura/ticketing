import { describe, expect, it } from "vitest";
import { seedCore } from "../../../apps/api/scripts/seed-uat-users";

describe("UAT seed requires verified first-run setup", () => {
  it("refuses before any insert when the setup marker is unset", async () => {
    const tx = {
      select: () => ({
        from: () => ({ where: async () => [{ setupCompletedAt: null }] }),
      }),
    };
    await expect(
      seedCore(tx as unknown as Parameters<typeof seedCore>[0], new Date()),
    ).rejects.toThrow("Complete first-administrator setup");
  });
});
