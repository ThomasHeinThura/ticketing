import { describe, expect, it } from "vitest";
import { entityHistoryRow } from "../../../apps/api/src/audit/settings-history";

const at = "2026-11-17T00:00:00.000Z";

function history(
  selector: "workspace" | "project",
  entityType: string,
  entityId: string,
  after: unknown,
) {
  return entityHistoryRow(
    {
      createdAt: at,
      actorType: "person",
      action: "time_settings.updated",
      entityType,
      entityId,
      workspaceId: selector === "workspace" ? entityId : "ws-1",
      projectId: selector === "project" ? entityId : null,
      after,
    },
    "Ada",
    selector,
  );
}

describe("closed future time settings history", () => {
  it("marks only a distinct, valid workspace backdating change", () => {
    const row = history("workspace", "workspace", "ws-1", {
      operation: "workspace_time_settings_split_v1",
      backdateLimitDays: { from: 30, to: 5 },
      origin: "mcp",
    });
    expect(row.changedFields).toEqual(["backdateLimitDays"]);
    expect(JSON.stringify(row)).not.toContain("30");
    expect(JSON.stringify(row)).not.toContain("ws-1");
    expect(
      history("workspace", "workspace", "ws-1", {
        operation: "workspace_time_settings_split_v1",
        backdateLimitDays: { from: 5, to: 5 },
      }).changedFields,
    ).toEqual([]);
  });

  it("marks only a distinct, valid project billable change bound to its target", () => {
    const row = history("project", "project", "pr-1", {
      operation: "project_time_settings_split_v1",
      projectDefaultBillable: { projectId: "pr-1", from: true, to: false },
    });
    expect(row.changedFields).toEqual(["projectDefaultBillable"]);
    expect(JSON.stringify(row)).not.toContain("pr-1");
    expect(JSON.stringify(row)).not.toContain("false");
    expect(
      history("project", "project", "pr-1", {
        operation: "project_time_settings_split_v1",
        projectDefaultBillable: { projectId: "pr-1", from: true, to: true },
      }).changedFields,
    ).toEqual([]);
  });

  it("does not interpret legacy, malformed, or cross-scoped payloads as changed fields", () => {
    const payloads: ["workspace" | "project", string, string, unknown][] = [
      [
        "workspace",
        "workspace",
        "ws-1",
        { backdateLimitDays: { from: 1, to: 2 } },
      ],
      [
        "workspace",
        "workspace",
        "ws-1",
        {
          operation: "project_time_settings_split_v1",
          backdateLimitDays: { from: 1, to: 2 },
        },
      ],
      [
        "project",
        "workspace",
        "pr-1",
        {
          operation: "project_time_settings_split_v1",
          projectDefaultBillable: { projectId: "pr-1", from: true, to: false },
        },
      ],
      [
        "workspace",
        "project",
        "ws-1",
        {
          operation: "workspace_time_settings_split_v1",
          backdateLimitDays: { from: 1, to: 2 },
        },
      ],
      [
        "workspace",
        "workspace",
        "ws-1",
        {
          operation: "workspace_time_settings_split_v1",
          backdateLimitDays: { from: -1, to: 2 },
        },
      ],
      [
        "workspace",
        "workspace",
        "ws-1",
        {
          operation: "workspace_time_settings_split_v1",
          backdateLimitDays: { from: 1, to: 3651 },
        },
      ],
      [
        "workspace",
        "workspace",
        "ws-1",
        {
          operation: "workspace_time_settings_split_v1",
          backdateLimitDays: { from: null, to: 2 },
        },
      ],
      [
        "project",
        "project",
        "pr-1",
        {
          operation: "project_time_settings_split_v1",
          projectDefaultBillable: { projectId: "pr-2", from: true, to: false },
        },
      ],
      [
        "project",
        "project",
        "pr-1",
        {
          operation: "project_time_settings_split_v1",
          projectDefaultBillable: {
            projectId: "pr-1",
            from: "true",
            to: false,
          },
        },
      ],
      [
        "project",
        "project",
        "pr-1",
        {
          operation: "project_time_settings_split_v1",
          projectDefaultBillable: { projectId: "pr-1", from: true, to: null },
        },
      ],
      [
        "workspace",
        "workspace",
        "ws-1",
        {
          operation: "workspace_time_settings_split_v1",
          backdateLimitDays: { from: 1, to: 2 },
          projectDefaultBillable: { projectId: "pr-1", from: true, to: false },
        },
      ],
      [
        "project",
        "project",
        "pr-1",
        {
          operation: "project_time_settings_split_v1",
          backdateLimitDays: { from: 1, to: 2 },
          projectDefaultBillable: { projectId: "pr-1", from: true, to: false },
        },
      ],
    ];
    for (const [selector, type, id, after] of payloads) {
      expect(history(selector, type, id, after).changedFields).toEqual([]);
    }
  });

  it("requires the row's exact workspace or project audit scope", () => {
    const workspaceAfter = {
      operation: "workspace_time_settings_split_v1",
      backdateLimitDays: { from: 1, to: 2 },
    };
    const projectAfter = {
      operation: "project_time_settings_split_v1",
      projectDefaultBillable: { projectId: "pr-1", from: true, to: false },
    };
    const row = (
      entityType: string,
      entityId: string,
      workspaceId: string | null,
      projectId: string | null,
      after: unknown,
    ) =>
      entityHistoryRow(
        {
          createdAt: at,
          actorType: "person",
          action: "time_settings.updated",
          entityType,
          entityId,
          workspaceId,
          projectId,
          after,
        },
        "Ada",
        entityType === "workspace" ? "workspace" : "project",
      );
    expect(
      row("workspace", "ws-1", "ws-2", null, workspaceAfter).changedFields,
    ).toEqual([]);
    expect(
      row("workspace", "ws-1", "ws-1", "pr-1", workspaceAfter).changedFields,
    ).toEqual([]);
    expect(
      row("project", "pr-1", "ws-1", "pr-2", projectAfter).changedFields,
    ).toEqual([]);
    expect(
      row("project", "pr-1", null, "pr-1", projectAfter).changedFields,
    ).toEqual([]);
  });
});
