import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch }));

import requestTaskDeletion from "./delete-task";

beforeEach(() => apiFetch.mockReset());

describe("requestTaskDeletion", () => {
  it("uses the work-item route and returns the pending action, never the legacy task route", async () => {
    apiFetch.mockResolvedValue(
      Response.json({ pendingActionId: "pa-9" }, { status: 202 }),
    );

    await expect(requestTaskDeletion("PROJ-9")).resolves.toEqual({
      pendingActionId: "pa-9",
    });
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/work-items/PROJ-9"),
      { method: "DELETE" },
    );
  });
});
