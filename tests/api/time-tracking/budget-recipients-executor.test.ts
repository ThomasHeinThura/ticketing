import { beforeEach, describe, expect, it, vi } from "vitest";

const trackingFeatureEnabled = vi.hoisted(() => vi.fn());
const project = vi.hoisted(() => ({
  managerId: "mgr",
  organisationId: "org",
  archivedAt: null,
  deletedAt: null,
}));

vi.mock("../../../apps/api/src/time-tracking/feature", () => ({
  COST_TRACKING_FEATURE_KEY: "feature.cost_tracking",
  trackingFeatureEnabled,
}));
vi.mock("../../../apps/api/src/database/schema", () => ({
  projectTable: {},
}));
vi.mock("../../../apps/api/src/database/schema-p5-time", () => ({
  budgetTable: {},
  budgetThresholdNoticeTable: {},
}));
vi.mock("../../../apps/api/src/events/outbox", () => ({}));
vi.mock("../../../apps/api/src/notification/fanout", () => ({
  enqueueNotificationEvent: vi.fn(),
}));
vi.mock("../../../apps/api/src/notification/fanout.repository", () => ({
  configuredMentionChannels: vi.fn(async () => []),
}));
vi.mock("../../../apps/api/src/notification/repository", () => ({
  findNotificationPerson: vi.fn(async () => ({
    active: true,
    userId: "u",
    side: "staff",
  })),
}));
vi.mock("../../../apps/api/src/permissions/resolve-identity", () => ({
  resolveIdentity: vi.fn(async () => ({ personId: "mgr" })),
}));
vi.mock("../../../apps/api/src/utils/project-ancestry", () => ({
  projectAncestryFor: vi.fn(async () => []),
  projectOwnerTeamFor: vi.fn(async () => null),
}));
vi.mock("@taskdesk/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/permissions")>()),
  can: () => true,
  reaches: () => true,
}));

import { budgetThresholdRecipients } from "../../../apps/api/src/time-tracking/budget-notify";

const chain = {
  from: () => chain,
  where: () => chain,
  limit: async () => [project],
};
const tx = { select: () => chain } as never;

beforeEach(() => trackingFeatureEnabled.mockReset());

describe("budgetThresholdRecipients", () => {
  it("checks the cost-tracking flag on the entry's own transaction", async () => {
    trackingFeatureEnabled.mockResolvedValue(true);
    const out = await budgetThresholdRecipients(tx, {
      kind: "budget.threshold_reached",
      scope: { workspaceId: "ws", projectId: "p1" },
      payload: { threshold: 80 },
    });
    expect(out).toHaveLength(1);
    expect(trackingFeatureEnabled).toHaveBeenCalledWith(
      "feature.cost_tracking",
      "ws",
      "p1",
      tx,
    );
  });
});
