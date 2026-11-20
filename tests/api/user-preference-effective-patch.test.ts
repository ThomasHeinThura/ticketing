import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  identityFor,
  ORGANISATION_ID,
  PROJECT_ID,
  WORKSPACE_ID,
} from "../../tests/permissions/matrix-fixture";

const mocks = vi.hoisted(() => ({
  addresses: vi.fn(),
  rows: vi.fn(),
  upsert: vi.fn(),
  audit: vi.fn(),
  notify: vi.fn(),
  lock: vi.fn(),
  projectReach: vi.fn(),
}));

vi.mock("../../apps/api/src/database", () => ({
  default: {
    transaction: async (run: (tx: object) => Promise<unknown>) => run({}),
  },
}));
vi.mock("../../apps/api/src/user-preference/repository", () => ({
  listOwnSettingAddresses: mocks.addresses,
  listOwnSettingRows: mocks.rows,
  upsertOwnSettingRow: mocks.upsert,
  lockOwnSettingsWrites: mocks.lock,
  deleteOwnSettingRow: vi.fn(),
  listLiveProjectReachFacts: mocks.projectReach,
}));
vi.mock("../../apps/api/src/project/hierarchy.repository", () => ({
  loadAncestorIdsByProject: vi.fn(async () => new Map()),
  loadOwnerTeamIdsByProject: vi.fn(async () => new Map()),
}));
vi.mock("../../apps/api/src/events/audit-savepoint", () => ({
  appendAuditSavepoint: mocks.audit,
}));
vi.mock(
  "../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    notifyCurrentInstanceAdminsOfAuditFailure: mocks.notify,
  }),
);

import { patchOwnSettings } from "../../apps/api/src/user-preference/service";

describe("effective persisted preference changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addresses.mockResolvedValue([
      { scope: "global", scopeId: null, key: "density", value: "compact" },
    ]);
    mocks.rows.mockResolvedValue([
      { scope: "global", scopeId: null, key: "density", value: "compact" },
    ]);
    mocks.upsert.mockResolvedValue({ personId: "person-matrix" });
    mocks.audit.mockResolvedValue(false);
  });

  it("returns an identical PATCH without touching timestamp or audit history", async () => {
    const result = await patchOwnSettings(
      identityFor("owner"),
      { density: "compact" },
      {} as never,
    );
    expect(result).toEqual({ settings: { density: "compact" } });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("writes and audits an effective replacement once", async () => {
    mocks.rows.mockResolvedValue([
      { scope: "global", scopeId: null, key: "density", value: "comfortable" },
    ]);
    const result = await patchOwnSettings(
      identityFor("owner"),
      { density: "comfortable" },
      {} as never,
    );
    expect(result).toEqual({ settings: { density: "comfortable" } });
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "user_preference.updated",
        after: { changedFields: ["density"], projectIds: [] },
      }),
    );
  });

  it("refuses an unchanged project value if reach was lost before the locked read", async () => {
    mocks.addresses.mockResolvedValue([
      {
        scope: "project",
        scopeId: PROJECT_ID,
        key: "layout",
        value: "board",
      },
    ]);
    mocks.projectReach
      .mockResolvedValueOnce([
        {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organisationId: ORGANISATION_ID,
        },
      ])
      .mockResolvedValueOnce([]);
    await expect(
      patchOwnSettings(
        identityFor("instance_admin"),
        { [`layout.${PROJECT_ID}`]: "board" },
        {} as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
