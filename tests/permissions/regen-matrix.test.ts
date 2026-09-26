import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";
import { capabilityGrid, routeGrid } from "./matrix-fixture";

/**
 * Fixture regeneration, run through vitest so the same module aliases apply as the
 * suite that consumes the fixture. Deliberately a plain `it` that no-ops unless
 * `REGEN_MATRIX=1` — never `.skip`/`.only` (check:skips), so a normal suite run keeps
 * asserting the fixture it just didn't touch:
 *
 *   REGEN_MATRIX=1 bunx --bun vitest run regen-matrix --config vitest.permissions.config.ts
 */
describe("matrix fixture regeneration", () => {
  it("rewrites matrix.fixture.json only when REGEN_MATRIX=1", async () => {
    if (process.env.REGEN_MATRIX !== "1") {
      // Ordinary runs assert nothing here — matrix.test.ts owns the assertion.
      expect(true).toBe(true);
      return;
    }
    const routes = routeGrid(await loadPolicyRegistry());
    const out = { capabilities: capabilityGrid(), routes };
    writeFileSync(
      fileURLToPath(new URL("./matrix.fixture.json", import.meta.url)),
      // TAB-indented, matching the file's established format — spaces would
      // rewrite all 4,300 lines and destroy the fixture diff's review signal.
      `${JSON.stringify(out, null, "\t")}\n`,
    );
    expect(Object.keys(routes).length).toBeGreaterThan(0);
  }, 120_000);
});
