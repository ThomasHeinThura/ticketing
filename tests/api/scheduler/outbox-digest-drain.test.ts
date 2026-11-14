import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  seal: vi.fn(),
  digest: vi.fn(),
  owned: vi.fn(),
  parent: vi.fn(),
  child: vi.fn(),
  p4: vi.fn(),
}));
vi.mock("../../../apps/api/src/notification/digest-seal", () => ({
  sealDueDigestGroups: mocks.seal,
}));
vi.mock("../../../apps/api/src/notification/digest-delivery", () => ({
  processNextNotificationDigest: mocks.digest,
}));
vi.mock("../../../apps/api/src/scheduler/leader-lock", () => ({
  assertJobExecutionOwned: mocks.owned,
  withJobLease: async (_name: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("../../../apps/api/src/events/outbox-consumer", () => ({
  processNextParentEvent: mocks.parent,
}));
vi.mock("../../../apps/api/src/notification/immediate-runtime", () => ({
  immediateNotificationRuntime: () => ({}),
}));
vi.mock("../../../apps/api/src/notification/outbox-drain", () => ({
  processNextNotificationDelivery: mocks.child,
}));
vi.mock("../../../apps/api/src/scheduler/outbox-drain-p4", () => ({
  drainP4Consumers: mocks.p4,
}));

import { drainNotificationDigests } from "../../../apps/api/src/scheduler/notification-digest";
import { drainOutbox } from "../../../apps/api/src/scheduler/outbox-drain";

beforeEach(() => {
  mocks.seal.mockReset().mockResolvedValue(30);
  mocks.digest.mockReset();
  mocks.owned.mockReset().mockResolvedValue(undefined);
  mocks.parent.mockReset().mockResolvedValue({ kind: "idle" });
  mocks.child.mockReset().mockResolvedValue({ kind: "idle" });
  mocks.p4
    .mockReset()
    .mockResolvedValue({ webhooks: null, automations: null, degraded: false });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("outbox digest drain", () => {
  it("seals and delivers 30 groups in one outbox run", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.digest.mockImplementation(async () => {
      now += 10;
      return mocks.digest.mock.calls.length <= 30
        ? { kind: "claimed", outcome: "delivered" }
        : { kind: "idle" };
    });
    const outcome = await drainOutbox();
    expect(outcome.digests).toEqual({
      sealed: 30,
      processed: 30,
      delivered: 30,
      deferred: 0,
      retry: 0,
      degraded: false,
    });
    expect(now).toBeLessThan(30_000);
    expect(mocks.seal).toHaveBeenCalledOnce();
  });

  it("stops claiming at the digest budget", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.digest.mockImplementation(async () => {
      now += 100;
      return { kind: "claimed", outcome: "delivered" };
    });
    const outcome = await drainNotificationDigests({ budgetMs: 200 });
    expect(outcome).toMatchObject({
      processed: 2,
      delivered: 2,
      degraded: false,
    });
    expect(mocks.digest).toHaveBeenCalledTimes(2);
  });

  it("reports a retry as degraded", async () => {
    mocks.digest
      .mockResolvedValueOnce({ kind: "claimed", outcome: "retry" })
      .mockResolvedValue({ kind: "idle" });
    const outcome = await drainOutbox();
    expect(outcome.digests).toMatchObject({
      processed: 1,
      retry: 1,
      degraded: true,
    });
    expect(outcome.degraded).toBe(true);
    expect(
      JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string),
    ).toMatchObject({
      job: "outbox-drain",
      outcome: "degraded",
      digests: { retry: 1, degraded: true },
    });
  });

  it("reserves time for all drain steps under sustained backlog", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.digest.mockImplementation(async () => {
      now += 1_000;
      return { kind: "claimed", outcome: "delivered" };
    });
    mocks.parent.mockImplementation(async () => {
      now += 1_000;
      return { kind: "delivered" };
    });
    mocks.child.mockImplementation(async () => {
      now += 1_000;
      return { kind: "delivered" };
    });
    mocks.p4.mockImplementation(async () => {
      now += 13_000;
      return { webhooks: null, automations: null, degraded: false };
    });
    const outcome = await drainOutbox();
    expect(outcome.digests.processed).toBe(10);
    expect(outcome.parents.processed).toBe(5);
    expect(outcome.children.processed).toBe(1);
    expect(mocks.p4).toHaveBeenCalledOnce();
    expect(now).toBe(29_000);
  });

  it("reports a sealing or claim failure as degraded", async () => {
    mocks.seal.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await drainNotificationDigests()).toMatchObject({
      sealed: 0,
      processed: 0,
      degraded: true,
    });
    expect(mocks.digest).not.toHaveBeenCalled();
    mocks.digest.mockRejectedValueOnce(new Error("claim failed"));
    expect(await drainNotificationDigests()).toMatchObject({
      sealed: 30,
      processed: 0,
      degraded: true,
    });
  });

  it("stops before a claim when the job reservation is lost", async () => {
    mocks.owned.mockRejectedValueOnce(new Error("reservation lost"));
    await expect(drainNotificationDigests()).rejects.toThrow(
      "reservation lost",
    );
    expect(mocks.digest).not.toHaveBeenCalled();
  });
});
