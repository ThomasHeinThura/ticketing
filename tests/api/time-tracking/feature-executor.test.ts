import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveProjectFeatures = vi.hoisted(() => vi.fn());
const listWorkspaceFeatures = vi.hoisted(() => vi.fn());

vi.mock("../../../apps/api/src/database", () => ({ default: {}, schema: {} }));
vi.mock("../../../apps/api/src/database/schema-p5-agile", () => ({
  cycleTable: {},
  moduleTable: {},
}));
vi.mock("../../../apps/api/src/feature-flag/repository", () => ({
  listWorkspaceFeatures,
  projectsWithFeature: vi.fn(),
  resolveProjectFeatures,
}));

import {
  assertTrackingEnabledForProject,
  TIME_TRACKING_FEATURE_KEY,
  trackingFeatureEnabled,
} from "../../../apps/api/src/time-tracking/feature";

const tx = { tag: "tx" } as never;

beforeEach(() => {
  resolveProjectFeatures.mockReset();
  listWorkspaceFeatures.mockReset();
});

describe("tracking feature lookup", () => {
  it("runs the project lookup on the executor it is given", async () => {
    resolveProjectFeatures.mockResolvedValue([
      { key: TIME_TRACKING_FEATURE_KEY, enabled: true },
    ]);
    await assertTrackingEnabledForProject(
      "ws",
      "p1",
      tx,
      TIME_TRACKING_FEATURE_KEY,
    );
    expect(resolveProjectFeatures).toHaveBeenCalledWith("p1", "ws", tx);
  });

  it("refuses with 409 only when the flag is off", async () => {
    resolveProjectFeatures.mockResolvedValue([
      { key: TIME_TRACKING_FEATURE_KEY, enabled: false },
    ]);
    await expect(
      assertTrackingEnabledForProject(
        "ws",
        "p1",
        tx,
        TIME_TRACKING_FEATURE_KEY,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("lets a failing lookup propagate instead of reporting the flag off", async () => {
    resolveProjectFeatures.mockRejectedValue(new Error("pool timeout"));
    await expect(
      trackingFeatureEnabled(TIME_TRACKING_FEATURE_KEY, "ws", "p1", tx),
    ).rejects.toThrow("pool timeout");
  });
});
