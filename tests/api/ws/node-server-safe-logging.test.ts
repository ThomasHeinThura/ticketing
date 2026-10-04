import { afterEach, describe, expect, it, vi } from "vitest";

const { logTaskDesk } = vi.hoisted(() => ({ logTaskDesk: vi.fn() }));
vi.mock(
  "../../../apps/api/src/instance/observability/runtime",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../apps/api/src/instance/observability/runtime")
      >();
    return { ...actual, logTaskDesk };
  },
);

import { Hono } from "hono";
import { createNodeServer } from "../../../apps/api/src/index";

describe("Node websocket shutdown logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs adapter shutdown rejection without its error contents", async () => {
    const sensitiveError = new Error("redis password=must-not-appear");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const app = new Hono();
    const server = createNodeServer(
      app as unknown as Parameters<typeof createNodeServer>[0],
      0,
      {
        shutdownAdapter: () => Promise.reject(sensitiveError),
        forceAdapter: vi.fn(),
      },
    );

    try {
      await new Promise<void>((resolve) =>
        server.server.once("listening", resolve),
      );
      await expect(server.close()).resolves.toBe("forced");
      expect(logTaskDesk).toHaveBeenCalledWith({
        module: "realtime",
        message: "realtime.failure",
        level: "error",
        result: "failed",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "Forcing API shutdown: WebSocket adapter shutdown failed",
      );
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
        "must-not-appear",
      );
    } finally {
      await server.close();
      logTaskDesk.mockClear();
    }
  });
});
