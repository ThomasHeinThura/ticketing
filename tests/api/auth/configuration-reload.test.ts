import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  reloadAuthConfiguration: vi.fn<() => Promise<boolean>>(),
  publishAuthReload: vi.fn<() => Promise<void>>(),
  logTaskDesk: vi.fn(),
}));

vi.mock("../../../apps/api/src/auth", () => ({
  reloadAuthConfiguration: mocks.reloadAuthConfiguration,
}));
vi.mock("../../../apps/api/src/ws", () => ({
  publishAuthReload: mocks.publishAuthReload,
}));
vi.mock("../../../apps/api/src/instance/observability/runtime", () => ({
  logTaskDesk: mocks.logTaskDesk,
}));

import { publishCommittedAuthConfigurationReload } from "../../../apps/api/src/auth/configuration-reload";

describe("committed auth configuration reload hint", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.reloadAuthConfiguration.mockReset();
    mocks.publishAuthReload.mockReset();
    mocks.logTaskDesk.mockReset();
    mocks.reloadAuthConfiguration.mockImplementation(async () => {
      mocks.calls.push("reload");
      return true;
    });
    mocks.publishAuthReload.mockImplementation(async () => {
      mocks.calls.push("publish");
    });
  });

  it("refreshes this replica before publishing the payload-free peer hint", async () => {
    await expect(
      publishCommittedAuthConfigurationReload(),
    ).resolves.toBeUndefined();
    expect(mocks.calls).toEqual(["reload", "publish"]);
    expect(mocks.logTaskDesk).not.toHaveBeenCalled();
  });

  it("still publishes after a local rebuild failure and logs no failure detail", async () => {
    mocks.reloadAuthConfiguration.mockImplementationOnce(async () => {
      mocks.calls.push("reload");
      throw new Error("provider secret must not be logged");
    });

    await expect(
      publishCommittedAuthConfigurationReload(),
    ).resolves.toBeUndefined();
    expect(mocks.calls).toEqual(["reload", "publish"]);
    expect(mocks.logTaskDesk).toHaveBeenCalledWith({
      module: "auth",
      message: "auth.failure",
      level: "error",
      result: "failed",
    });
    expect(JSON.stringify(mocks.logTaskDesk.mock.calls)).not.toContain(
      "provider secret",
    );
  });

  it("keeps a committed write successful when the reload publisher fails", async () => {
    mocks.publishAuthReload.mockImplementationOnce(async () => {
      mocks.calls.push("publish");
      throw new Error("redis password must not be logged");
    });

    await expect(
      publishCommittedAuthConfigurationReload(),
    ).resolves.toBeUndefined();
    expect(mocks.calls).toEqual(["reload", "publish"]);
    expect(mocks.logTaskDesk).toHaveBeenCalledWith({
      module: "auth",
      message: "auth.failure",
      level: "error",
      result: "failed",
    });
    expect(JSON.stringify(mocks.logTaskDesk.mock.calls)).not.toContain(
      "redis password",
    );
  });
});
