import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  resolvePort,
  resolveStaticRoot,
} from "../../apps/api/src/index";

describe("resolvePort", () => {
  it("uses the documented default when TASKDESK_PORT is unset", () => {
    expect(resolvePort(undefined)).toEqual({ port: 5173, invalid: false });
  });

  it("accepts a valid port", () => {
    expect(resolvePort("8080")).toEqual({ port: 8080, invalid: false });
  });

  it("accepts the boundary port 65535", () => {
    expect(resolvePort("65535")).toEqual({ port: 65535, invalid: false });
  });

  it("accepts the boundary port 1", () => {
    expect(resolvePort("1")).toEqual({ port: 1, invalid: false });
  });

  it("falls back and flags invalid for 0", () => {
    expect(resolvePort("0")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a negative number", () => {
    expect(resolvePort("-1")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a port above 65535", () => {
    expect(resolvePort("65536")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a very large number", () => {
    expect(resolvePort("4294967296")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a non-numeric string", () => {
    expect(resolvePort("not-a-port")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for an empty string", () => {
    expect(resolvePort("")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a float", () => {
    expect(resolvePort("5173.5")).toEqual({ port: 5173, invalid: true });
  });

  it("does not flag invalid when the raw value already equals the default", () => {
    expect(resolvePort("5173")).toEqual({ port: 5173, invalid: false });
  });
});

describe("resolveStaticRoot", () => {
  it("returns undefined when no candidate contains an index.html", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "taskdesk-static-empty-"));
    try {
      expect(
        resolveStaticRoot([
          join(tmpdir(), "taskdesk-definitely-does-not-exist"),
          emptyDir,
        ]),
      ).toBeUndefined();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("returns the first candidate that is a real build", () => {
    const buildDir = mkdtempSync(join(tmpdir(), "taskdesk-static-build-"));
    try {
      writeFileSync(join(buildDir, "index.html"), "<!doctype html>");
      expect(
        resolveStaticRoot([
          join(tmpdir(), "taskdesk-definitely-does-not-exist"),
          buildDir,
        ]),
      ).toBe(buildDir);
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });
});

describe("static file serving", () => {
  let staticRoot: string;

  beforeAll(() => {
    // A throwaway fixture standing in for `apps/web/dist`, so these tests
    // are deterministic regardless of whether the real web app has been
    // built in this environment.
    staticRoot = mkdtempSync(join(tmpdir(), "taskdesk-static-serving-"));
    mkdirSync(join(staticRoot, "assets"), { recursive: true });
    writeFileSync(
      join(staticRoot, "index.html"),
      "<!doctype html><title>index-marker</title>",
    );
    writeFileSync(
      join(staticRoot, "assets", "app.js"),
      "console.log('asset-marker');",
    );
  });

  afterAll(() => {
    rmSync(staticRoot, { recursive: true, force: true });
  });

  it("serves a real static asset with a reasonable content-type", async () => {
    const { app } = createApp({ staticRoot });

    const response = await app.request("/assets/app.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    await expect(response.text()).resolves.toContain("asset-marker");
  });

  it("falls back to index.html for an unmatched non-API route", async () => {
    const { app } = createApp({ staticRoot });

    const response = await app.request("/projects/some-project-id");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("index-marker");
  });

  it("never falls back to index.html for an unmatched API-prefixed route", async () => {
    const { app } = createApp({ staticRoot });

    const response = await app.request("/api/this-route-does-not-exist");

    // The app-wide `/api/*` guard (apps/api/src/index.ts's `api.use("*", ...)`)
    // authenticates before routing can even decide "not found", so an
    // unauthenticated request to an unmatched API path 401s rather than
    // 404ing — verified against the real app rather than assumed. Either
    // way, the important thing this proves is what did NOT happen: the
    // static-serving fallback never touched this request.
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).not.toContain("text/html");
    await expect(response.text()).resolves.not.toContain("index-marker");
  });

  it("404s a genuinely missing asset instead of serving index.html", async () => {
    const { app } = createApp({ staticRoot });

    const response = await app.request("/assets/does-not-exist.js");

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain("index-marker");
  });

  it("skips static serving gracefully when no build is found, without crashing", async () => {
    const missingRoot = join(tmpdir(), "taskdesk-static-missing-build");

    const { app } = createApp({ staticRoot: missingRoot });

    const response = await app.request("/projects/some-project-id");

    // No build found -> no SPA fallback was ever wired -> ordinary 404,
    // exactly the pre-existing behavior for an unmatched route.
    expect(response.status).toBe(404);
  });
});
