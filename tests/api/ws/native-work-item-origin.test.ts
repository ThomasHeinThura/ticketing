import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ outbox: vi.fn(), broadcast: vi.fn() }));
vi.mock("../../../apps/api/src/events/outbox", () => ({
  enqueueOutboxEvent: mocks.outbox,
}));
vi.mock("../../../apps/api/src/notification/fanout", () => ({
  enqueueNotificationEvent: vi.fn(),
}));
vi.mock("../../../apps/api/src/ws", () => ({
  broadcastNativeWorkItemHint: mocks.broadcast,
}));

import { eventContext } from "../../../apps/api/src/events";
import {
  publishRankHint,
  publishWorkItemHint,
  recordWorkItemEvent,
} from "../../../apps/api/src/work-item/native-event";
import { publishRelationHints } from "../../../apps/api/src/work-item-relation/service";

const input = {
  kind: "work_item.updated" as const,
  workItemId: "item-1",
  key: "WI-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  actorId: "person-1",
  actorType: "person" as const,
  payload: {},
  customerVisible: false,
};

describe("native hint origin", () => {
  beforeEach(() => vi.clearAllMocks());
  it("keeps relation creation origin private and leaves approval hints unattributed", async () => {
    const endpoints = [
      {
        id: "item-1",
        key: "WI-1",
        projectId: "project-1",
        workspaceId: "workspace-1",
      },
    ];
    await publishRelationHints(endpoints, {
      userId: "person-1",
      windowId: "tab-1",
    });
    expect(mocks.broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initiator: { userId: "person-1", windowId: "tab-1" },
      }),
    );
    await publishRelationHints(endpoints);
    expect(mocks.broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ initiator: undefined }),
    );
  });
  it("attributes a browser re-rank and leaves a system re-rank unattributed", async () => {
    await eventContext.run(
      {
        initiatorId: "legacy",
        nativeInitiator: { userId: "person-1", windowId: "tab-1" },
      },
      () => publishRankHint({ key: "WI-1", projectId: "project-1" }),
    );
    expect(mocks.broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initiator: { userId: "person-1", windowId: "tab-1" },
      }),
    );
    await publishRankHint({ key: "WI-1", projectId: "project-1" });
    expect(mocks.broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ initiator: undefined }),
    );
  });
  it("carries the authenticated browser origin from the recorded person's event", async () => {
    const event = await eventContext.run(
      {
        initiatorId: "legacy",
        nativeInitiator: { userId: "person-1", windowId: "tab-1" },
      },
      () => recordWorkItemEvent({} as never, input),
    );
    await publishWorkItemHint(event, input);
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        initiator: { userId: "person-1", windowId: "tab-1" },
      }),
    );
  });
  it.each(["system", "automation", "api_key"] as const)(
    "does not attribute %s events to the browser",
    async (actorType) => {
      const event = await eventContext.run(
        {
          initiatorId: "legacy",
          nativeInitiator: { userId: "person-1", windowId: "tab-1" },
        },
        () => recordWorkItemEvent({} as never, { ...input, actorType }),
      );
      await publishWorkItemHint(event, input);
      expect(mocks.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ initiator: undefined }),
      );
    },
  );
  it("does not attribute another person's event to the browser", async () => {
    const event = await eventContext.run(
      {
        initiatorId: "legacy",
        nativeInitiator: { userId: "person-2", windowId: "tab-1" },
      },
      () => recordWorkItemEvent({} as never, input),
    );
    await publishWorkItemHint(event, input);
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ initiator: undefined }),
    );
  });
  it("does not attribute imported events to the browser", async () => {
    const event = await eventContext.run(
      {
        initiatorId: "legacy",
        nativeInitiator: { userId: "person-1", windowId: "tab-1" },
      },
      () =>
        recordWorkItemEvent({} as never, {
          ...input,
          payload: { source: "import" },
        }),
    );
    await publishWorkItemHint(event, input);
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ initiator: undefined }),
    );
  });
});
