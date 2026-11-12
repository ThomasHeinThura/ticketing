import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("../../../apps/api/src/auth/repository", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/api/src/auth/repository")
  >()),
  completeFirstUserSetup: vi.fn(async () => {
    calls.order.push("marker");
  }),
}));

vi.mock(
  "../../../apps/api/src/utils/seed-internal-organisation",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../apps/api/src/utils/seed-internal-organisation")
    >()),
    ensureInternalOrganisation: vi.fn(async () => {
      calls.order.push("seed-rows");
      throw new Error("stop after the first seed write");
    }),
  }),
);

import { seedCore } from "../../../apps/api/scripts/seed-uat-users";
import { completeFirstUserSetup } from "../../../apps/api/src/auth/repository";

// Seeded accounts never go through first sign-up. Without the setup marker every staff session
// on a database seeded only by the UAT seed answers 403 mfa_enrollment_required. Unit-level; the
// seed's effect on real rows is covered by tests/api-integration/uat-seed.test.ts.
describe("UAT seed marks first-run setup complete", () => {
  it("writes the marker through the seed transaction before it writes any account", async () => {
    const tx = {} as Parameters<typeof seedCore>[0];
    await expect(seedCore(tx, new Date())).rejects.toThrow(
      "stop after the first seed write",
    );
    expect(completeFirstUserSetup).toHaveBeenCalledTimes(1);
    expect(completeFirstUserSetup).toHaveBeenCalledWith(tx);
    expect(calls.order).toEqual(["marker", "seed-rows"]);
  });
});
