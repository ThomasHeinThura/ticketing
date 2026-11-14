import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/api/src/database", () => ({
  default: { transaction: (run: (tx: unknown) => unknown) => run({ execute }) },
}));

import { suggestDuplicatesForQueueRows } from "../../../apps/api/src/intake/duplicate-suggestions";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  execute.mockReset();
});

it("sends the UTC cutoff as a parameter cast to a naive timestamp in a non-UTC timezone", async () => {
  vi.stubEnv("TZ", "Asia/Yangon");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
  execute.mockResolvedValue({ rows: [] });
  await suggestDuplicatesForQueueRows(
    "workspace",
    [{ ref: "one", summary: "Example", organisationId: "org" }],
    ["project"],
  );
  const query = new PgDialect().sqlToQuery(execute.mock.calls[1]?.[0]);
  const index = query.params.indexOf("2026-08-16T12:00:00.000Z");
  expect(index).toBeGreaterThanOrEqual(0);
  expect(query.sql).toContain(`wi.created_at > $${index + 1}::timestamp`);
  expect(query.params.some((value) => value instanceof Date)).toBe(false);
});
