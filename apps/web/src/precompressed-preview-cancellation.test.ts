import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  get,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreviewServer } from "vite";
import { expect, it, vi } from "vitest";
import { precompressedAssets } from "../vite.config";

const fault = vi.hoisted(() => ({
  enabled: false,
  reject: undefined as undefined | ((reason: Error) => void),
}));
vi.mock("../../api/src/static/precompressed-assets", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../api/src/static/precompressed-assets")
    >();
  return {
    ...actual,
    servePrecompressedAsset: (
      ...args: Parameters<typeof actual.servePrecompressedAsset>
    ) =>
      fault.enabled
        ? new Promise<never>((_resolve, reject) => {
            fault.reject = reject;
          })
        : actual.servePrecompressedAsset(...args),
  };
});

it("survives a disconnected asset client and serves the next request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "taskdesk-preview-cancel-"));
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets/large.js"), randomBytes(8 * 1024 * 1024));
  let middleware!: (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ) => void;
  const plugin = precompressedAssets(dir);
  const configure = plugin.configurePreviewServer;
  if (typeof configure !== "function")
    throw new Error("Expected preview middleware");
  configure.call(
    {} as ThisParameterType<typeof configure>,
    {
      middlewares: {
        use(handler: typeof middleware) {
          middleware = handler;
        },
      },
    } as unknown as PreviewServer,
  );
  const server = createServer((req, res) =>
    middleware(req, res, (error) => {
      res.statusCode = error ? 500 : 404;
      res.end();
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  const url = `http://127.0.0.1:${address.port}/assets/large.js`;
  try {
    // The server has received the request; the filesystem read may or may not have
    // finished by the time the disconnect reaches it.
    const received = once(server, "request");
    const early = get(url);
    early.on("error", () => {});
    await received;
    early.destroy();
    await new Promise<void>((resolve, reject) => {
      const req = get(url, (response) => {
        response.once("data", () => {
          response.destroy();
          resolve();
        });
        response.on("error", () => {});
      });
      req.on("error", reject);
    });
    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(8 * 1024 * 1024));
    const next = await fetch(url);
    expect(next.status).toBe(200);
    expect((await next.arrayBuffer()).byteLength).toBe(8 * 1024 * 1024);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(dir, { recursive: true, force: true });
  }
});

it("forwards unexpected read errors even after a client closes", async () => {
  fault.enabled = true;
  const forwarded = vi.fn();
  let middleware!: (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ) => void;
  const configure = precompressedAssets("/unused").configurePreviewServer;
  if (typeof configure !== "function")
    throw new Error("Expected preview middleware");
  configure.call(
    {} as ThisParameterType<typeof configure>,
    {
      middlewares: {
        use(handler: typeof middleware) {
          middleware = handler;
        },
      },
    } as unknown as PreviewServer,
  );
  const server = createServer((req, res) => middleware(req, res, forwarded));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  try {
    const received = once(server, "request");
    const client = get(`http://127.0.0.1:${address.port}/assets/test.js`);
    client.on("error", () => {});
    const [, response] = (await received) as [IncomingMessage, ServerResponse];
    client.destroy();
    await once(response, "close");
    const error = Object.assign(new Error("read failed"), { code: "EIO" });
    if (!fault.reject) throw new Error("Expected pending read");
    fault.reject(error);
    await vi.waitFor(() => expect(forwarded).toHaveBeenCalledWith(error));
  } finally {
    fault.enabled = false;
    fault.reject = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
