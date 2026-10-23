import { describe, expect, it } from "vitest";
import type { WorkItemRow } from "@/types/work-item";
import {
  canonicalTaskItemStats,
  workItemKaneoView,
  workItemProjectSlug,
} from "./work-item-kaneo-view";

const item = {
  id: "wi-1",
  key: "SERVICE-DESK-12",
  number: 12,
  projectId: "project-1",
  title: "Restore access",
  stateId: "state-1",
  priority: "high",
  assigneeId: "person-7",
  assigneeName: "Thomas Example",
  position: "9999999999.0000000001",
  description: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Access request" }],
      },
    ],
  },
  dueDate: null,
  startDate: null,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  version: 4,
  workspaceId: "workspace-1",
  typeId: "type-1",
  requesterId: null,
  parentId: null,
  customerVisibility: "private",
  archivedAt: null,
  deletedAt: null,
  stateName: "Open",
  stateCategory: "unstarted",
  unavailableFields: [],
} satisfies WorkItemRow;

describe("Kaneo work-item presentation", () => {
  it("retains canonical identity and assignment without confusing a person with a user or rounding rank", () => {
    const view = workItemKaneoView(item);
    expect(view).toMatchObject({
      id: "wi-1",
      status: "state-1",
      userId: null,
      assigneeId: "person-7",
      assigneeName: "Thomas Example",
      position: null,
      version: 4,
      description: "Access request",
    });
    expect(item.position).toBe("9999999999.0000000001");
    expect(view.labels).toBeUndefined();
    expect(view.taskItemStats).toEqual({ total: 0, completed: 0 });
    expect(view.externalLinks).toBeUndefined();
  });
  it("uses the permanent key prefix, including hyphens, for Kaneo's item number", () => {
    expect(workItemProjectSlug(item)).toBe("SERVICE-DESK");
  });
});

describe("canonical checklist projection", () => {
  it("retains real catalogue labels and counts nested checked nodes without counting prose or code examples", () => {
    const description = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "- [x] prose example" }],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "- [ ] code example" }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                { type: "paragraph" },
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: false },
                      content: [{ type: "paragraph" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    };
    const labels = [
      { id: "label-1", name: "Access", color: "var(--color-primary)" },
    ];
    const view = workItemKaneoView({ ...item, description, labels });
    expect(view.labels).toEqual(labels);
    expect(view.labels).not.toBe(labels);
    expect(view.taskItemStats).toEqual({ total: 3, completed: 1 });
    expect(labels).toEqual([
      { id: "label-1", name: "Access", color: "var(--color-primary)" },
    ]);
  });
  it("preserves existing Markdown fence rules", () => {
    expect(
      canonicalTaskItemStats("- [x] Real\n```md\n- [ ] Example\n```"),
    ).toEqual({ total: 1, completed: 1 });
  });
  it.each([
    { type: "doc", content: [{ type: "taskItem", attrs: { checked: true } }] },
    {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: "false" } }],
        },
      ],
    },
    { type: "doc", content: "invalid" },
    { type: "unknown" },
  ])(
    "does not manufacture counts for malformed rich text %j",
    (description) => {
      expect(canonicalTaskItemStats(description)).toBeNull();
    },
  );
  it("bounds oversized and cyclic rich text instead of hanging or inventing a partial count", () => {
    const cyclic: Record<string, unknown> = { type: "doc" };
    cyclic.content = [cyclic];
    expect(canonicalTaskItemStats(cyclic)).toBeNull();
    expect(
      canonicalTaskItemStats({
        type: "doc",
        content: Array.from({ length: 10001 }, () => ({ type: "paragraph" })),
      }),
    ).toBeNull();
  });
});
