import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const apiEntry = readFileSync(
  fileURLToPath(new URL("../../../apps/api/src/index.ts", import.meta.url)),
  "utf8",
);

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
      expect(logTaskDesk).toHaveBeenCalledWith({
        module: "http",
        message: "http.lifecycle_failure",
        level: "error",
        result: "failed",
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      await server.close();
      logTaskDesk.mockClear();
    }
  });

  it.each(["callback error", "synchronous throw"] as const)(
    "redacts HTTP close %s and closeAllConnections failures",
    async (failureMode) => {
      const sensitiveError = Object.assign(
        new Error("socket path=/private/runtime-token"),
        { code: "EIO" },
      );
      const app = new Hono();
      const server = createNodeServer(
        app as unknown as Parameters<typeof createNodeServer>[0],
        0,
        { shutdownAdapter: async () => {}, forceAdapter: vi.fn() },
      );
      await new Promise<void>((resolve) =>
        server.server.once("listening", resolve),
      );

      const rawServer = server.server as unknown as {
        close: (callback?: (error?: Error) => void) => unknown;
        closeAllConnections: () => void;
      };
      const originalClose = rawServer.close.bind(server.server);
      const originalCloseAll = rawServer.closeAllConnections.bind(
        server.server,
      );
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      logTaskDesk.mockClear();
      Reflect.set(rawServer, "closeAllConnections", () => {
        throw sensitiveError;
      });
      Reflect.set(rawServer, "close", (callback?: (error?: Error) => void) => {
        if (failureMode === "synchronous throw") throw sensitiveError;
        callback?.(sensitiveError);
        return server.server;
      });

      try {
        await expect(server.close()).resolves.toBe("forced");
        expect(logTaskDesk).toHaveBeenCalledWith({
          module: "http",
          message: "http.lifecycle_failure",
          level: "error",
          result: "failed",
        });
        expect(logTaskDesk.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        Reflect.set(rawServer, "close", originalClose);
        Reflect.set(rawServer, "closeAllConnections", originalCloseAll);
        if (server.server.listening) {
          await new Promise<void>((resolve, reject) => {
            originalClose((error) => (error ? reject(error) : resolve()));
          });
        }
        await server.close();
        consoleError.mockRestore();
      }
    },
  );

  it("keeps raw console error calls out of the API entry failure paths", () => {
    expect(apiEntry).not.toContain("console.error");
  });
});
