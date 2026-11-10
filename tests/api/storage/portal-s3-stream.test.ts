import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getObjectSizeAndHeader,
  getPortalObjectRange,
} from "../../../apps/api/src/storage/s3";

const bytes = Buffer.from("portal S3 streaming bytes");
const previous = new Map<string, string | undefined>();
const names = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "AWS_MAX_ATTEMPTS",
];
let server: Server;
let mode:
  | "ok"
  | "missing"
  | "failure"
  | "wrong-length"
  | "wrong-range"
  | "stream"
  | "delay" = "ok";
let streamClosed = false;
let calls: Array<{ method: string; range?: string }> = [];

beforeAll(async () => {
  for (const name of names) previous.set(name, process.env[name]);
  server = createServer((req, res) => {
    calls.push({ method: req.method ?? "", range: req.headers.range });
    if (mode === "delay") return;
    if (mode === "missing" || mode === "failure") {
      res.writeHead(mode === "missing" ? 404 : 503, {
        "content-type": "application/xml",
      });
      res.end(
        `<Error><Code>${mode === "missing" ? "NoSuchKey" : "ServiceUnavailable"}</Code></Error>`,
      );
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { "content-length": bytes.length });
      res.end();
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    if (!match) {
      res.writeHead(400);
      res.end();
      return;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const body = bytes.subarray(start, end + 1);
    res.writeHead(206, {
      "content-length": mode === "wrong-length" ? body.length + 1 : body.length,
      "content-range":
        mode === "wrong-range"
          ? `bytes ${start}-${end}/${bytes.length + 1}`
          : `bytes ${start}-${end}/${bytes.length}`,
    });
    if (mode === "stream") {
      res.on("close", () => {
        streamClosed = true;
      });
      res.write(body.subarray(0, 2));
      return;
    }
    res.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local S3 test port");
  process.env.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.S3_BUCKET = "unit-test";
  process.env.S3_ACCESS_KEY_ID = "test-access";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
  process.env.AWS_MAX_ATTEMPTS = "1";
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  for (const name of names) {
    const value = previous.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("S3 portal download primitives", () => {
  it("uses HEAD without GET and streams requested full and partial bytes", async () => {
    mode = "ok";
    calls = [];
    expect(
      (await getObjectSizeAndHeader("prefix/object", 0)).contentLength,
    ).toBe(bytes.length);
    expect(calls).toEqual([{ method: "HEAD", range: undefined }]);
    for (const [start, end] of [
      [0, bytes.length - 1],
      [2, 6],
      [4, bytes.length - 1],
      [bytes.length - 3, bytes.length - 1],
    ] as const) {
      const body = await getPortalObjectRange(
        "prefix/object",
        start,
        end,
        new AbortController().signal,
        bytes.length,
      );
      expect(Buffer.from(await new Response(body).arrayBuffer())).toEqual(
        bytes.subarray(start, end + 1),
      );
      expect(calls.at(-1)?.range).toBe(`bytes=${start}-${end}`);
    }
  });
  it("rejects missing objects, upstream failures and mismatched byte lengths", async () => {
    mode = "missing";
    await expect(
      getObjectSizeAndHeader("prefix/object", 0),
    ).rejects.toBeDefined();
    mode = "failure";
    await expect(
      getPortalObjectRange(
        "prefix/object",
        0,
        3,
        new AbortController().signal,
        bytes.length,
      ),
    ).rejects.toBeDefined();
    mode = "wrong-length";
    await expect(
      getPortalObjectRange(
        "prefix/object",
        0,
        3,
        new AbortController().signal,
        bytes.length,
      ),
    ).rejects.toThrow();
    mode = "wrong-range";
    await expect(
      getPortalObjectRange(
        "prefix/object",
        0,
        3,
        new AbortController().signal,
        bytes.length,
      ),
    ).rejects.toThrow();
  });
  it("cancels the upstream response when a downstream reader cancels", async () => {
    mode = "stream";
    streamClosed = false;
    const body = await getPortalObjectRange(
      "prefix/object",
      0,
      3,
      new AbortController().signal,
      bytes.length,
    );
    const reader = body.getReader();
    expect((await reader.read()).value).toBeDefined();
    await reader.cancel();
    for (let attempt = 0; !streamClosed && attempt < 200; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(streamClosed).toBe(true);
  });
  it("aborts a stalled HEAD when the client disconnects", async () => {
    mode = "delay";
    calls = [];
    const controller = new AbortController();
    const pending = getObjectSizeAndHeader(
      "prefix/object",
      0,
      controller.signal,
    );
    const assertion = expect(pending).rejects.toBeDefined();
    for (let attempt = 0; calls.length === 0 && attempt < 200; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toEqual([{ method: "HEAD", range: undefined }]);
    controller.abort();
    await assertion;
  });
  it("aborts an upstream GET while waiting for headers", async () => {
    mode = "delay";
    calls = [];
    const controller = new AbortController();
    const pending = getPortalObjectRange(
      "prefix/object",
      0,
      3,
      controller.signal,
      bytes.length,
    );
    for (let attempt = 0; calls.length === 0 && attempt < 200; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls.length).toBeGreaterThan(0);
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});
