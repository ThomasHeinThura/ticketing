import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  identity: vi.fn(),
  append: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../../../apps/api/src/database", async (original) => ({
  ...(await original<typeof import("../../../apps/api/src/database")>()),
  default: { transaction: mocks.transaction },
}));
vi.mock("../../../apps/api/src/permissions/resolve-identity", () => ({
  resolveIdentity: mocks.identity,
}));
vi.mock("../../../apps/api/src/events/audit-savepoint", () => ({
  appendAuditSavepoint: mocks.append,
}));
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({ notifyCurrentInstanceAdminsOfAuditFailure: mocks.notify }),
);

import { appendPersonalNotificationAudit } from "../../../apps/api/src/audit/notification-settings";
import { saveQuietHours } from "../../../apps/api/src/notification-preferences/quiet-hours";

const actor = {
  actorId: "user-1",
  actorType: "person" as const,
  traceId: "trace-1",
};
const audit = { actor, personId: "person-1" };

function transaction(before: {
  start: string | null;
  end: string | null;
  timezone: string | null;
}) {
  const selected = {
    from: () => selected,
    where: () => selected,
    for: () => selected,
    limit: async () => [before],
  };
  const update = { set: () => update, where: async () => [{ id: "person-1" }] };
  const tx = { select: () => selected, update: vi.fn(() => update) };
  mocks.transaction.mockImplementation(
    async (run: (value: unknown) => unknown) => run(tx),
  );
  return tx;
}

describe("personal notification audit producers", () => {
  beforeEach(() => {
    mocks.identity
      .mockReset()
      .mockResolvedValue({ side: "staff", personId: "person-1" });
    mocks.append.mockReset().mockResolvedValue(false);
    mocks.notify.mockReset();
    mocks.transaction.mockReset();
  });

  it("records only closed category markers and skips an effective no-op", async () => {
    const tx = transaction({ start: null, end: null, timezone: null });
    await saveQuietHours("user-1", null, audit);
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(await appendPersonalNotificationAudit(tx as never, audit, [])).toBe(
      false,
    );
    expect(mocks.append).not.toHaveBeenCalled();

    await saveQuietHours(
      "user-1",
      { start: "22:00", end: "07:00", timezone: "UTC" },
      audit,
    );
    expect(mocks.append).toHaveBeenCalledWith(tx, {
      ...actor,
      workspaceId: null,
      action: "notification.settings_updated",
      entityType: "notification_preference",
      entityId: "person-1",
      after: { changedCategories: ["quietHours"] },
    });
  });

  it("does not report a successful save if the in-transaction audit step throws", async () => {
    transaction({ start: null, end: null, timezone: null });
    mocks.append.mockRejectedValueOnce(new Error("transaction aborted"));
    await expect(
      saveQuietHours(
        "user-1",
        { start: "22:00", end: "07:00", timezone: "UTC" },
        audit,
      ),
    ).rejects.toThrow("transaction aborted");
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
