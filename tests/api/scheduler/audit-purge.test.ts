import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  prerequisites: vi.fn(),
  bounds: vi.fn(),
  cutoff: vi.fn(),
  purgePrefix: vi.fn(),
  append: vi.fn(),
}));
vi.mock("../../../apps/api/src/audit/purge.repository", () => ({
  auditPurgePrerequisitesPresent: m.prerequisites,
  fenceLegalHolds: vi.fn(async () => {
    m.calls.push("fence");
  }),
  readAuditPurgeBounds: m.bounds,
  readAuditPurgeCutoff: m.cutoff,
  purgeAuditPrefix: m.purgePrefix,
}));
vi.mock("../../../apps/api/src/audit/repository", () => ({
  lockAuditChain: vi.fn(async () => {
    m.calls.push("lock");
  }),
}));
vi.mock("../../../apps/api/src/audit/audit-writer", () => ({
  appendAuditLog: m.append,
}));

import {
  planAuditPurge,
  runAuditPurge,
} from "../../../apps/api/src/audit/purge";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";
import { AUDIT_PURGE_LEASE_MS } from "../../../apps/api/src/scheduler/audit-purge";

const executor = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ tx: true }),
  ),
} as never;

const RESULT = {
  anchorId: "anchor-1",
  purgedCount: 3,
  firstPurgedCreatedAt: "2025-01-01T00:00:00.000000Z",
  purgedThroughAt: "2025-01-03T00:00:00.000000Z",
};

beforeEach(() => {
  m.calls.length = 0;
  for (const fn of [
    m.prerequisites,
    m.bounds,
    m.cutoff,
    m.purgePrefix,
    m.append,
  ])
    fn.mockReset();
  m.prerequisites.mockResolvedValue({ anchorTable: true, purgeFunction: true });
  m.purgePrefix.mockImplementation(async () => {
    m.calls.push("purge");
    return RESULT;
  });
  m.append.mockImplementation(async () => {
    m.calls.push("audit");
  });
});

afterEach(() => shutdownScheduler());

describe("audit-purge schedule", () => {
  it("registers audit-purge daily at 03:00 with a 30 minute lease", () => {
    initializeScheduler();
    expect(registeredJobByName("audit-purge")?.getPattern()).toBe("0 3 * * *");
    expect(AUDIT_PURGE_LEASE_MS).toBe(30 * 60 * 1000);
  });

  it("keeps outbox-drain on its 30 second cadence", () => {
    initializeScheduler();
    expect(registeredJobByName("outbox-drain")?.getPattern()).toBe(
      "*/30 * * * * *",
    );
  });
});

describe("contiguous-prefix eligibility", () => {
  it("purges nothing from an empty log", () => {
    expect(
      planAuditPurge({ headSeq: null, firstBlockedSeq: null, capSeq: null }),
    ).toBeNull();
  });

  it("never deletes the chain head even when every row is past retention and unheld", () => {
    expect(
      planAuditPurge({ headSeq: 10n, firstBlockedSeq: null, capSeq: null }),
    ).toBe(10n);
  });

  it("stops at the first row that is inside retention or held, even if older rows follow it", () => {
    expect(
      planAuditPurge({ headSeq: 10n, firstBlockedSeq: 4n, capSeq: null }),
    ).toBe(4n);
  });

  it("purges nothing when the oldest row is blocked", () => {
    expect(
      planAuditPurge({ headSeq: 10n, firstBlockedSeq: 1n, capSeq: null }),
    ).toBe(1n);
  });

  it("caps one run's prefix", () => {
    expect(
      planAuditPurge({ headSeq: 100n, firstBlockedSeq: 50n, capSeq: 20n }),
    ).toBe(20n);
  });
});

describe("runAuditPurge", () => {
  it("deletes nothing while the anchor table or purge function is not migrated", async () => {
    m.prerequisites.mockResolvedValue({
      anchorTable: false,
      purgeFunction: true,
    });
    await expect(runAuditPurge({ executor })).resolves.toEqual({
      status: "skipped",
      reason: "prerequisites_missing",
      degraded: true,
    });
    expect(m.bounds).not.toHaveBeenCalled();
    expect(m.purgePrefix).not.toHaveBeenCalled();
  });

  it("is idempotent: a rerun with nothing past retention calls no purge and writes no audit row", async () => {
    m.bounds.mockResolvedValue({
      headSeq: 5n,
      firstBlockedSeq: 1n,
      capSeq: null,
    });
    m.cutoff.mockResolvedValue(null);
    await expect(runAuditPurge({ executor })).resolves.toEqual({
      status: "nothing_to_purge",
      degraded: false,
    });
    expect(m.purgePrefix).not.toHaveBeenCalled();
    expect(m.append).not.toHaveBeenCalled();
  });

  it("locks the chain, fences holds, supplies only the cut-off seq to the purge, then audits itself", async () => {
    m.bounds.mockResolvedValue({
      headSeq: 10n,
      firstBlockedSeq: 4n,
      capSeq: null,
    });
    m.cutoff.mockResolvedValue(3n);
    const outcome = await runAuditPurge({ executor, retention: "12 months" });
    expect(outcome).toMatchObject({
      status: "purged",
      anchorId: "anchor-1",
      purgedCount: 3,
    });
    expect(m.calls).toEqual(["lock", "fence", "purge", "audit"]);
    expect(m.cutoff).toHaveBeenCalledWith(expect.anything(), 4n);
    expect(m.purgePrefix).toHaveBeenCalledWith(expect.anything(), 3n);
    expect(m.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "audit.purged",
        actorType: "system",
        actorId: null,
        entityId: "anchor-1",
        after: expect.objectContaining({ purgedCount: 3 }),
      }),
    );
  });

  it("propagates a database refusal (e.g. inside the retention floor) and writes no audit row", async () => {
    m.bounds.mockResolvedValue({
      headSeq: 10n,
      firstBlockedSeq: null,
      capSeq: null,
    });
    m.cutoff.mockResolvedValue(9n);
    m.purgePrefix.mockRejectedValue(new Error("retention floor"));
    await expect(runAuditPurge({ executor })).rejects.toThrow(
      "retention floor",
    );
    expect(m.append).not.toHaveBeenCalled();
  });
});
