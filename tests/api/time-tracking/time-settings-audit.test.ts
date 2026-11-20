import type { ResolvedIdentity } from "@taskdesk/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), auditTime: vi.fn() }));
vi.mock("../../../apps/api/src/database", async (original) => ({
  ...(await original<typeof import("../../../apps/api/src/database")>()),
  default: { transaction: mocks.transaction },
}));
vi.mock("../../../apps/api/src/time-tracking/audit", () => ({
  auditTime: mocks.auditTime,
}));

import {
  projectTable,
  workspaceTable,
} from "../../../apps/api/src/database/schema";
import { updateTimeSettings } from "../../../apps/api/src/time-tracking/repository";

const identity = {
  side: "staff",
  userId: "user-1",
  personId: "person-1",
  organisationId: "organisation-1",
  portal: "agent",
  credential: "session",
  memberships: [],
  teamIds: [],
  reach: { kind: "membership" },
  authority: [],
} as ResolvedIdentity;
const actor = {
  userId: "user-1",
  actorType: "person" as const,
  auditOrigin: "mcp" as const,
};

function fakeTransaction() {
  const stored = { days: 30, billable: true };
  mocks.transaction.mockImplementation(
    async (run: (tx: unknown) => Promise<unknown>) => {
      const pending = { ...stored };
      const tx = {
        select: () => {
          let table: unknown;
          const query = {
            from(value: unknown) {
              table = value;
              return query;
            },
            innerJoin() {
              return query;
            },
            where() {
              return query;
            },
            for: async () =>
              table === workspaceTable
                ? [{ days: pending.days }]
                : table === projectTable
                  ? [{ id: "project-1", defaultBillable: pending.billable }]
                  : [],
          };
          return query;
        },
        update: (table: unknown) => ({
          set: (value: {
            timeEntryBackdateLimitDays?: number;
            defaultBillable?: boolean;
          }) => ({
            where: async () => {
              if (
                table === workspaceTable &&
                value.timeEntryBackdateLimitDays !== undefined
              )
                pending.days = value.timeEntryBackdateLimitDays;
              if (table === projectTable && value.defaultBillable !== undefined)
                pending.billable = value.defaultBillable;
            },
          }),
        }),
      };
      const result = await run(tx);
      Object.assign(stored, pending);
      return result;
    },
  );
  return stored;
}

describe("time settings audit split", () => {
  beforeEach(() => {
    mocks.transaction.mockReset();
    mocks.auditTime.mockReset().mockResolvedValue(undefined);
  });

  it("writes two scoped rows in one transaction and keeps MCP origin", async () => {
    const stored = fakeTransaction();
    await updateTimeSettings({
      identity,
      workspaceId: "workspace-1",
      backdateLimitDays: 5,
      project: { id: "project-1", defaultBillable: false },
      actor,
    });
    expect(stored).toEqual({ days: 5, billable: false });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.auditTime).toHaveBeenCalledTimes(2);
    expect(mocks.auditTime.mock.calls.map(([, row]) => row)).toEqual([
      {
        action: "time_settings.updated",
        workspaceId: "workspace-1",
        projectId: null,
        entityType: "workspace",
        entityId: "workspace-1",
        actor,
        after: {
          operation: "workspace_time_settings_split_v1",
          backdateLimitDays: { from: 30, to: 5 },
        },
      },
      {
        action: "time_settings.updated",
        workspaceId: "workspace-1",
        projectId: "project-1",
        entityType: "project",
        entityId: "project-1",
        actor,
        after: {
          operation: "project_time_settings_split_v1",
          projectDefaultBillable: {
            projectId: "project-1",
            from: true,
            to: false,
          },
        },
      },
    ]);
  });

  it("writes only submitted scopes, including same-value submissions", async () => {
    fakeTransaction();
    await updateTimeSettings({
      identity,
      workspaceId: "workspace-1",
      backdateLimitDays: 30,
      actor,
    });
    expect(mocks.auditTime).toHaveBeenCalledTimes(1);
    expect(mocks.auditTime.mock.calls[0]?.[1]).toMatchObject({
      entityType: "workspace",
      projectId: null,
      after: { backdateLimitDays: { from: 30, to: 30 } },
    });
    mocks.auditTime.mockClear();
    await updateTimeSettings({
      identity,
      workspaceId: "workspace-1",
      project: { id: "project-1", defaultBillable: true },
      actor,
    });
    expect(mocks.auditTime).toHaveBeenCalledTimes(1);
    expect(mocks.auditTime.mock.calls[0]?.[1]).toMatchObject({
      entityType: "project",
      projectId: "project-1",
      after: {
        projectDefaultBillable: {
          projectId: "project-1",
          from: true,
          to: true,
        },
      },
    });
  });

  it("rolls both updates back when the second audit append fails", async () => {
    const stored = fakeTransaction();
    mocks.auditTime
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("audit failure"));
    await expect(
      updateTimeSettings({
        identity,
        workspaceId: "workspace-1",
        backdateLimitDays: 5,
        project: { id: "project-1", defaultBillable: false },
        actor,
      }),
    ).rejects.toThrow("audit failure");
    expect(stored).toEqual({ days: 30, billable: true });
    expect(mocks.auditTime).toHaveBeenCalledTimes(2);
  });
});
