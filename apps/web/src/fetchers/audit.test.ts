import { afterEach, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch }));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://agent.invalid/api${path}`,
}));

import { getInstanceAudit } from "./audit";

afterEach(() => vi.clearAllMocks());
it("loads the real instance audit URL with one API prefix and encoded filters", async () => {
  apiFetch.mockResolvedValue(new Response(JSON.stringify({ rows: [] })));
  await expect(
    getInstanceAudit({ action: "submission.accepted", limit: 50 }),
  ).resolves.toEqual({ rows: [] });
  expect(apiFetch.mock.calls[0][0]).toBe(
    "https://agent.invalid/api/instance/audit?limit=50&action=submission.accepted",
  );
});
