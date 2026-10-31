import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { auth } from "../../apps/api/src/auth";
import { getDatabasePool } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";

// Issue #704: the real app refuses an oversize anonymous /api/auth/* body before Better Auth (or
// the database) sees it. Unit-level; no database.
describe("issue #704: app-wide /api body limit in createApp()", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "taskdesk-body-limit-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>x</title>");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup() {
    const { app } = createApp({ staticRoot: root, portalStaticRoot: root });
    const query = vi
      .spyOn(getDatabasePool(), "query")
      .mockRejectedValue(
        new Error("An oversize body must not reach the database."),
      );
    const handler = vi
      .spyOn(auth, "handler")
      .mockResolvedValue(new Response("null", { status: 200 }));
    return { app, query, handler };
  }

  it("answers an oversize declared /api/auth/* body with a plain-text 413 and never calls Better Auth", async () => {
    const { app, query, handler } = setup();
    const size = 64 * 1024 + 1;
    const response = await app.request(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          host: "localhost:5173",
          "content-type": "application/json",
          "content-length": String(size),
        },
        body: "x".repeat(size),
      }),
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload too large");
    // Registered inside the host guard, so the 413 carries the API security headers.
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(handler).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("cuts off an oversize chunked /api/auth/* body when Better Auth reads it", async () => {
    const { app, query, handler } = setup();
    vi.spyOn(auth.api, "getSession").mockResolvedValue(null);
    // Like Better Auth, the mocked handler reads the JSON body.
    handler.mockImplementation(async (request: Request) => {
      await request.json();
      return new Response("null", { status: 200 });
    });
    const response = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { host: "localhost:5173", "content-type": "application/json" },
      // A string body has no Content-Length header here, so the limiter counts the stream.
      body: `{"email":"${"a".repeat(70 * 1024)}"}`,
    });
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload too large");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });

  it("never reads a chunked body to an authenticated route without a session (401, 0 bytes pulled)", async () => {
    const { app } = setup();
    vi.spyOn(auth.api, "getSession").mockResolvedValue(null);
    let pulled = 0;
    const chunk = new Uint8Array(256 * 1024);
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulled >= 50 * 1024 * 1024) return controller.close();
          pulled += chunk.byteLength;
          controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 },
    );
    const response = await app.request(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        headers: { host: "localhost:5173", "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(401);
    expect(pulled).toBe(0);
  });

  it("hands a chunked /api/auth/* body under the limit to Better Auth intact", async () => {
    const { app, handler } = setup();
    vi.spyOn(auth.api, "getSession").mockResolvedValue(null);
    let received = "";
    handler.mockImplementation(async (request: Request) => {
      received = await request.text();
      return new Response("null", { status: 200 });
    });
    const payload = JSON.stringify({
      email: "someone@example.test",
      password: "p".repeat(60 * 1024),
    });
    const response = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { host: "localhost:5173", "content-type": "application/json" },
      // No Content-Length: the limiter counts and re-buffers the stream.
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(received).toBe(payload);
  });
});
