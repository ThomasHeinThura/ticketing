import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApiKeyKind } from "../../../apps/api/src/api-key/repository";
import type { Executor } from "../../../apps/api/src/database/executor";

const logs = vi.hoisted(() => ({ logTaskDesk: vi.fn() }));
vi.mock("../../../apps/api/src/instance/observability/runtime", () => logs);
function executor(capabilities: unknown) {
  const limit = vi.fn().mockResolvedValue([
    {
      workspaceId: "workspace",
      personId: null,
      isMcp: false,
      ipAllowlist: null,
      rateLimitPerMinute: 100,
      disabledAt: null,
      capabilities,
    },
  ]);
  return {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  } as unknown as Executor;
}
describe("AK-12 stored capability handling", () => {
  beforeEach(() => vi.clearAllMocks());
  it("logs unknown stored names without echoing storage, and grants only registered names", async () => {
    const key = await loadApiKeyKind(
      "key",
      executor([
        "workspace:read",
        "future:administrator",
        "untrusted-secret-shaped-value",
      ]),
    );
    expect(key.capabilities).toEqual(["workspace:read"]);
    expect(logs.logTaskDesk).toHaveBeenCalledExactlyOnceWith({
      module: "auth",
      message: "auth.unknown_key_capability",
      level: "warn",
      result: "degraded",
    });
  });
  it("does not expand unknown strings or wildcard-like names", async () => {
    expect(
      (
        await loadApiKeyKind(
          "key",
          executor(["*", "workspace:*", "future:read"]),
        )
      ).capabilities,
    ).toEqual([]);
    expect(logs.logTaskDesk).toHaveBeenCalledTimes(1);
  });
  it("preserves known stored subsets and denies malformed storage", async () => {
    expect(
      (await loadApiKeyKind("key", executor(["workspace:read"]))).capabilities,
    ).toEqual(["workspace:read"]);
    expect(
      (await loadApiKeyKind("key", executor(["workspace:read", 3])))
        .capabilities,
    ).toBeNull();
    expect(
      (await loadApiKeyKind("key", executor({ wildcard: true }))).capabilities,
    ).toBeNull();
    expect(logs.logTaskDesk).not.toHaveBeenCalled();
  });
});
