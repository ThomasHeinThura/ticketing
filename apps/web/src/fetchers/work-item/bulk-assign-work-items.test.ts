import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({
  client: { "work-items": { bulk: { $post: post } } },
}));

import bulkAssignWorkItems, {
  bulkWorkItemsOperation,
  requestBulkWorkItemDeletion,
} from "./bulk-assign-work-items";

const selection = { workspaceId: "ws", workItemKeys: ["HELP-4", "HELP-5"] };
beforeEach(() => post.mockReset());
describe("bulk deletion intent", () => {
  it("returns a pending reference rather than reporting selected items deleted", async () => {
    post.mockResolvedValue(
      Response.json({ pendingActionId: "pa-1" }, { status: 202 }),
    );
    await expect(requestBulkWorkItemDeletion(selection)).resolves.toEqual({
      kind: "pending",
      pendingActionId: "pa-1",
    });
    expect(post).toHaveBeenCalledWith({
      json: { ...selection, operation: "delete" },
    });
  });
  it("preserves all-ineligible results without creating a confirmation", async () => {
    const result = {
      succeeded: [],
      failed: [{ id: "HELP-4", reason: "Work item not found" }],
    };
    post.mockResolvedValue(Response.json(result));
    await expect(requestBulkWorkItemDeletion(selection)).resolves.toEqual({
      kind: "result",
      result,
    });
  });
  it.each([{}, { pendingActionId: "" }, { pendingActionId: 1 }])(
    "rejects malformed pending references %j",
    async (body) => {
      post.mockResolvedValue(Response.json(body, { status: 202 }));
      await expect(requestBulkWorkItemDeletion(selection)).rejects.toThrow(
        "Missing pending action reference",
      );
    },
  );
  it("does not treat a pending response as an executed normal bulk operation", async () => {
    post.mockResolvedValue(
      Response.json({ pendingActionId: "pa-1" }, { status: 202 }),
    );
    await expect(
      bulkWorkItemsOperation({ ...selection, operation: "archive" }),
    ).rejects.toMatchObject({ status: 202 });
  });
  it("reopens the requester's existing pending action on a repeated request", async () => {
    post.mockResolvedValue(
      new Response("pending_approval: pa-existing", { status: 409 }),
    );
    await expect(requestBulkWorkItemDeletion(selection)).resolves.toEqual({
      kind: "pending",
      pendingActionId: "pa-existing",
    });
  });
  it.each([403, 404, 409])("preserves refusal %s", async (status) => {
    post.mockResolvedValue(Response.json({}, { status }));
    await expect(requestBulkWorkItemDeletion(selection)).rejects.toMatchObject({
      status,
    });
  });
});

describe("canonical bulk additive contracts", () => {
  it.each([
    { operation: "add_label" as const, labelId: "label-1" },
    { operation: "remove_label" as const, labelId: "label-1" },
    { operation: "set_due_date" as const, dueDate: "2026-10-31T00:00:00.000Z" },
    { operation: "set_due_date" as const, dueDate: null },
  ])("forwards %j without legacy task status aliases", async (operation) => {
    post.mockResolvedValue(
      Response.json({ succeeded: ["HELP-4"], failed: [] }),
    );
    await bulkWorkItemsOperation({ ...selection, ...operation });
    expect(post).toHaveBeenCalledWith({ json: { ...selection, ...operation } });
  });
  it("preserves every observed current holder for confirmed assignment CAS", async () => {
    post.mockResolvedValue(
      Response.json({ succeeded: ["HELP-4"], failed: [] }),
    );
    const expectedCurrentAssigneeIds = {
      "HELP-4": "person-old",
      "HELP-5": null,
    };
    await bulkAssignWorkItems({
      ...selection,
      assigneeId: "person-new",
      expectedCurrentAssigneeIds,
    });
    expect(post).toHaveBeenCalledWith({
      json: {
        ...selection,
        operation: "assign",
        assigneeId: "person-new",
        expectedCurrentAssigneeIds,
      },
    });
  });
});
