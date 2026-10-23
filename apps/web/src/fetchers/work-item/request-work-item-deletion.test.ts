import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch }));

import requestWorkItemDeletion from "./request-work-item-deletion";

beforeEach(() => apiFetch.mockReset());
describe("work item deletion intent", () => {
  it("requires a durable pending action and never treats direct deletion as success", async () => {
    apiFetch.mockResolvedValue(
      Response.json({ key: "HELP-4", deletedAt: "now" }),
    );
    await expect(requestWorkItemDeletion("HELP-4")).rejects.toMatchObject({
      status: 200,
    });
    apiFetch.mockResolvedValue(
      Response.json({ pendingActionId: "pa-4" }, { status: 202 }),
    );
    await expect(requestWorkItemDeletion("HELP-4")).resolves.toEqual({
      pendingActionId: "pa-4",
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/work-items/HELP-4"),
      { method: "DELETE" },
    );
  });
  it.each([{}, { pendingActionId: "" }, { pendingActionId: 1 }])(
    "rejects a malformed accepted response %j",
    async (body) => {
      apiFetch.mockResolvedValue(Response.json(body, { status: 202 }));
      await expect(requestWorkItemDeletion("HELP-4")).rejects.toThrow(
        "Missing pending action reference",
      );
    },
  );
  it.each([403, 404, 409])("preserves server refusal %s", async (status) => {
    apiFetch.mockResolvedValue(Response.json({}, { status }));
    await expect(requestWorkItemDeletion("HELP-4")).rejects.toMatchObject({
      status,
    });
  });
  it("reopens the requester's existing pending action on a repeated request", async () => {
    apiFetch.mockResolvedValue(
      new Response("pending_approval: pa-existing", { status: 409 }),
    );
    await expect(requestWorkItemDeletion("HELP-4")).resolves.toEqual({
      pendingActionId: "pa-existing",
    });
  });
});
