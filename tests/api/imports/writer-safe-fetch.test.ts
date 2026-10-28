import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { safeDownload } from "../../../apps/api/src/imports/writer/safe-fetch";

let server: http.Server;
let base = "";
const dev = { NODE_ENV: "development" };

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === "/ok") {
      response.setHeader("content-type", "image/png");
      response.end(Buffer.from([1, 2, 3, 4]));
    } else if (request.url === "/redirect") {
      response.statusCode = 302;
      response.setHeader("location", "/ok");
      response.end();
    } else if (request.url === "/echo-auth") {
      response.end(String(request.headers.authorization ?? "none"));
    } else if (request.url === "/same-host-redirect") {
      response.statusCode = 302;
      response.setHeader("location", "/echo-auth");
      response.end();
    } else if (request.url === "/other-host-redirect") {
      response.statusCode = 302;
      response.setHeader(
        "location",
        `http://localhost:${(server.address() as AddressInfo).port}/echo-auth`,
      );
      response.end();
    } else if (request.url === "/missing") {
      response.statusCode = 404;
      response.end("no");
    } else if (request.url === "/big") {
      response.end(Buffer.alloc(5000, 1));
    } else if (request.url === "/chunked-big") {
      response.write(Buffer.alloc(3000, 1));
      setTimeout(() => response.end(Buffer.alloc(3000, 1)), 20);
    } else if (request.url === "/hang") {
      response.write("x");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("safeDownload (guarded egress for import attachments)", () => {
  it("downloads within the byte cap", async () => {
    const result = await safeDownload(`${base}/ok`, {
      maxBytes: 100,
      env: dev,
    });
    expect(result).toMatchObject({ ok: true, contentType: "image/png" });
    if (result.ok) expect([...result.bytes]).toEqual([1, 2, 3, 4]);
  });

  it("never follows redirects and fails on a non-2xx status", async () => {
    expect(
      await safeDownload(`${base}/redirect`, { maxBytes: 100, env: dev }),
    ).toEqual({ ok: false, code: "failed" });
    expect(
      await safeDownload(`${base}/missing`, { maxBytes: 100, env: dev }),
    ).toEqual({ ok: false, code: "failed" });
  });

  it("sends source credentials only to the configured host, and follows only a same-host redirect", async () => {
    const text = async (url: string, options: Record<string, unknown>) => {
      const result = await safeDownload(`${base}${url}`, {
        maxBytes: 1000,
        env: dev,
        ...options,
      });
      return result.ok ? new TextDecoder().decode(result.bytes) : result;
    };
    const auth = {
      headers: { authorization: "Bearer secret" },
      hosts: ["127.0.0.1"],
    };
    expect(await text("/echo-auth", { auth })).toBe("Bearer secret");
    // Another host name never receives them.
    expect(
      await text("/echo-auth", { auth: { ...auth, hosts: ["files.example"] } }),
    ).toBe("none");
    expect(await text("/echo-auth", {})).toBe("none");
    // Redirects stay off by default; one same-host redirect is allowed and keeps the credential.
    expect(await text("/same-host-redirect", { auth })).toEqual({
      ok: false,
      code: "failed",
    });
    expect(await text("/same-host-redirect", { auth, maxRedirects: 1 })).toBe(
      "Bearer secret",
    );
    // A redirect to a new host is refused even when redirects are allowed.
    expect(
      await text("/other-host-redirect", { auth, maxRedirects: 1 }),
    ).toEqual({
      ok: false,
      code: "failed",
    });
  });

  it("enforces the byte cap, by declared length and while streaming", async () => {
    expect(
      await safeDownload(`${base}/big`, { maxBytes: 1000, env: dev }),
    ).toEqual({ ok: false, code: "too_large" });
    expect(
      await safeDownload(`${base}/chunked-big`, { maxBytes: 4000, env: dev }),
    ).toEqual({ ok: false, code: "too_large" });
  });

  it("times out a stalled download", async () => {
    expect(
      await safeDownload(`${base}/hang`, {
        maxBytes: 100,
        timeoutMs: 200,
        env: dev,
      }),
    ).toEqual({ ok: false, code: "failed" });
  });

  it("stays strict by default even when the process runs with NODE_ENV=development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      expect(await safeDownload(`${base}/ok`, { maxBytes: 100 })).toEqual({
        ok: false,
        code: "failed",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses non-https, credentialed and non-routable destinations outside development", async () => {
    const prod = { NODE_ENV: "production" };
    for (const url of [
      `${base}/ok`,
      "http://example.test/a.png",
      "https://user:pw@example.test/a.png",
      "https://127.0.0.1/a.png",
      "https://[::1]/a.png",
      "https://10.0.0.5/a.png",
      "https://169.254.169.254/latest",
      "https://localhost/a.png",
    ])
      expect(await safeDownload(url, { maxBytes: 100, env: prod })).toEqual({
        ok: false,
        code: "failed",
      });
  });
});
