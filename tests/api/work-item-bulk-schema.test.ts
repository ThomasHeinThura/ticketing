import { describe, expect, it } from "vitest";
import { bulkWorkItemsBody } from "../../apps/api/src/work-item/schema";

const base = { workspaceId: "ws", workItemKeys: ["HELP-1", "HELP-2"] };
describe("bulk persistence input contracts", () => {
  it("retains optional unassigned-only assignment and exact nullable holder capture", () => {
    expect(
      bulkWorkItemsBody.safeParse({
        ...base,
        operation: "assign",
        assigneeId: "person",
      }).success,
    ).toBe(true);
    expect(
      bulkWorkItemsBody.parse({
        ...base,
        operation: "assign",
        assigneeId: "person",
        expectedCurrentAssigneeIds: { "HELP-1": null, "HELP-2": "old" },
      }).expectedCurrentAssigneeIds,
    ).toEqual({ "HELP-1": null, "HELP-2": "old" });
  });
  it.each([
    {},
    { "HELP-1": null },
    { "HELP-1": null, "HELP-2": "old", "HELP-3": null },
    JSON.parse('{"HELP-1":null,"HELP-2":null,"__proto__":null}'),
    { "HELP-1": null, "HELP-2": null, constructor: "person" },
  ])(
    "refuses incomplete, extra, or prototype holder maps %j",
    (expectedCurrentAssigneeIds) => {
      expect(
        bulkWorkItemsBody.safeParse({
          ...base,
          operation: "assign",
          assigneeId: "person",
          expectedCurrentAssigneeIds,
        }).success,
      ).toBe(false);
    },
  );
  it.each(["add_label", "remove_label"])(
    "requires a bounded explicit catalogue target for %s",
    (operation) => {
      expect(bulkWorkItemsBody.safeParse({ ...base, operation }).success).toBe(
        false,
      );
      expect(
        bulkWorkItemsBody.safeParse({
          ...base,
          operation,
          labelId: "catalogue",
        }).success,
      ).toBe(true);
      expect(
        bulkWorkItemsBody.safeParse({
          ...base,
          operation,
          labelId: "bad\u0000id",
        }).success,
      ).toBe(false);
    },
  );
  it("parses exact instants or explicit clear for due dates", () => {
    expect(
      bulkWorkItemsBody.parse({
        ...base,
        operation: "set_due_date",
        dueDate: "2026-10-29T10:30:00+06:30",
      }).dueDate,
    ).toEqual(new Date("2026-10-29T04:00:00Z"));
    expect(
      bulkWorkItemsBody.parse({
        ...base,
        operation: "set_due_date",
        dueDate: null,
      }).dueDate,
    ).toBeNull();
  });
  it.each([
    undefined,
    false,
    0,
    "2026-02-31T00:00:00Z",
    "2026-10-29",
    "1899-12-31T23:59:59Z",
    "9999-12-31T23:59:59-14:00",
  ])("rejects unsafe due date %j", (dueDate) => {
    expect(
      bulkWorkItemsBody.safeParse({
        ...base,
        operation: "set_due_date",
        dueDate,
      }).success,
    ).toBe(false);
  });
});
