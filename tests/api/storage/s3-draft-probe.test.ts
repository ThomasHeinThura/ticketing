import { createHash, createHmac } from "node:crypto";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import https from "node:https";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStorageProbe } from "../../../apps/api/src/instance/storage/probe";
import { createS3DraftProbeAdapter } from "../../../apps/api/src/storage/s3-draft-probe";

const input = Object.freeze({
  connector: "external" as const,
  endpoint: "https://s3.example.com",
  publicBaseUrl: "https://files.example.com",
  maxImageUploadBytes: 10485760,
  presignTtlSeconds: 300,
  region: "us-east-1",
  bucket: "bucket",
  keyPrefix: "prefix",
  forcePathStyle: true,
  accessKeyId: "ACCESS_SECRET_MARKER",
  secretAccessKey: "SECRET_KEY_MARKER",
});
const id = "11111111-1111-1111-1111-111111111111";
const key = `taskdesk-storage-probe-${id}`;
const signal = () => new AbortController().signal;

afterEach(() => vi.restoreAllMocks());

function dnsAnswers(answers: string[][]) {
  let call = 0;
  vi.spyOn(dns, "lookup").mockImplementation(((
    _host: unknown,
    _options: unknown,
    callback: (
      error: null,
      entries: { address: string; family: number }[],
    ) => void,
  ) => {
    const selected = answers[Math.min(call++, answers.length - 1)] ?? [];
    queueMicrotask(() =>
      callback(
        null,
        selected.map((address) => ({ address, family: 4 })),
      ),
    );
  }) as typeof dns.lookup);
}

function fakeHttps(statuses: number[], remoteAddress = "8.8.8.8") {
  const calls: {
    method: string;
    path: string;
    hostname: string;
    port?: string | number;
    headers: Record<string, string>;
    body?: Buffer;
  }[] = [];
  vi.spyOn(https, "request").mockImplementation(((
    options: {
      method: string;
      path: string;
      hostname: string;
      port?: string | number;
      headers: Record<string, string>;
      lookup: (
        host: string,
        options: { all: boolean },
        callback: (error: Error | null) => void,
      ) => void;
    },
    callback: (
      res: Readable & { statusCode: number; headers: Record<string, string> },
    ) => void,
  ) => {
    const call = {
      ...options,
      headers: { ...options.headers },
    } as (typeof calls)[number];
    calls.push(call);
    const req = new EventEmitter() as EventEmitter & {
      end(body?: Uint8Array | string): void;
      destroy(error: Error): void;
    };
    let destroyed = false;
    req.destroy = (error) => {
      destroyed = true;
      queueMicrotask(() => req.emit("error", error));
    };
    req.end = (body) => {
      call.body = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
      options.lookup("s3.example.com", { all: true }, (error) => {
        if (error) {
          req.destroy(error);
          return;
        }
        const socket = new EventEmitter() as EventEmitter & {
          remoteAddress: string;
        };
        socket.remoteAddress = remoteAddress;
        req.emit("socket", socket);
        socket.emit("connect");
        if (destroyed) return;
        const status = statuses.shift() ?? 200;
        const body =
          options.method === "GET"
            ? Buffer.from("taskdesk-storage-probe-v1-check!")
            : Buffer.alloc(0);
        const res = Readable.from(body) as Readable & {
          statusCode: number;
          headers: Record<string, string>;
        };
        res.statusCode = status;
        res.headers =
          options.method === "HEAD"
            ? { "content-length": String(body.length || 31) }
            : {};
        callback(res);
      });
    };
    return req;
  }) as unknown as typeof https.request);
  return calls;
}

// Independent implementation of AWS S3's single-chunk SigV4 calculation.
// Test-only verification: never print the captured Authorization header.
function recomputeS3Signature(
  call: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: Buffer;
  },
  secret: string,
): string {
  const headers = Object.fromEntries(
    Object.entries(call.headers).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
  const authorization = headers.authorization ?? "";
  const fields =
    /^AWS4-HMAC-SHA256 Credential=[^/]+\/(\d{8})\/([^/]+)\/s3\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=[a-f0-9]{64}$/u.exec(
      authorization,
    );
  if (!fields) throw new Error("Invalid synthetic authorization structure");
  const [, date, region, signed] = fields;
  if (!date || !region || !signed)
    throw new Error("Missing synthetic signature scope");
  const timestamp = headers["x-amz-date"] ?? "";
  const signedNames = signed.split(";");
  if (
    !/^\d{8}T\d{6}Z$/u.test(timestamp) ||
    timestamp.slice(0, 8) !== date ||
    signedNames.join(";") !== [...signedNames].sort().join(";") ||
    signedNames.some((name) => headers[name] === undefined)
  )
    throw new Error("Invalid synthetic signed headers");
  const [rawPath = "", rawQuery = ""] = call.path.split("?", 2);
  const encode = (value: string) =>
    encodeURIComponent(value).replace(
      /[!'()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const query = rawQuery
    ? rawQuery
        .split("&")
        .map((pair) => {
          const position = pair.indexOf("=");
          const rawKey = position < 0 ? pair : pair.slice(0, position);
          const rawValue = position < 0 ? "" : pair.slice(position + 1);
          return {
            key: encode(decodeURIComponent(rawKey)),
            value: encode(decodeURIComponent(rawValue)),
          };
        })
        .sort((left, right) =>
          left.key < right.key
            ? -1
            : left.key > right.key
              ? 1
              : left.value < right.value
                ? -1
                : left.value > right.value
                  ? 1
                  : 0,
        )
        .map(({ key, value }) => `${key}=${value}`)
        .join("&")
    : "";
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${headers[name]?.trim().replace(/\s+/gu, " ")}\n`)
    .join("");
  const hash = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const payloadHash = hash(call.body ?? Buffer.alloc(0));
  const canonical = [
    call.method,
    rawPath,
    query,
    canonicalHeaders,
    signed,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", timestamp, scope, hash(canonical)].join(
    "\n",
  );
  const hmac = (key: string | Buffer, data: string) =>
    createHmac("sha256", key).update(data).digest();
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(hmac(serviceKey, "aws4_request"), toSign).toString("hex");
}

describe("inactive S3 draft probe", () => {
  it.each([
    "http://s3.example.com",
    "https://user:pass@s3.example.com",
    "https://s3.example.com/path",
    "https://s3.example.com?",
    "https://s3.example.com#",
    "https://127.0.0.1",
    "https://[::1]",
  ])("rejects unsafe endpoint %s", (endpoint) => {
    expect(() => createS3DraftProbeAdapter({ ...input, endpoint })).toThrow(
      "Storage draft probe failed.",
    );
  });
  it("supports virtual-host addressing with a guarded signed authority", async () => {
    dnsAnswers([["8.8.8.8"]]);
    const calls = fakeHttps([200]);
    const adapter = createS3DraftProbeAdapter({
      ...input,
      forcePathStyle: false,
    });
    await adapter.write(key, Buffer.from("x"), signal());
    expect(calls[0]?.hostname).toBe("bucket.s3.example.com");
    expect(calls[0]?.headers.host).toBe("bucket.s3.example.com");
    const call = calls[0];
    if (!call) throw new Error("Missing signed request");
    expect(recomputeS3Signature(call, input.secretAccessKey)).toBe(
      call.headers.authorization?.split("Signature=")[1],
    );
    adapter.close();
  });
  it("rejects mixed public and private DNS before opening a request", async () => {
    dnsAnswers([["8.8.8.8", "127.0.0.1"]]);
    const calls = fakeHttps([]);
    const adapter = createS3DraftProbeAdapter(input);
    await expect(
      adapter.write(key, Buffer.from("x"), signal()),
    ).rejects.toThrow("Storage draft probe failed.");
    expect(calls).toHaveLength(0);
    adapter.close();
  });
  it("rejects DNS rebinding at lookup and a forbidden connected socket", async () => {
    dnsAnswers([["8.8.8.8"], ["127.0.0.1"]]);
    fakeHttps([]);
    const adapter = createS3DraftProbeAdapter(input);
    await expect(
      adapter.write(key, Buffer.from("x"), signal()),
    ).rejects.toThrow("Storage draft probe failed.");
    adapter.close();
    vi.restoreAllMocks();
    dnsAnswers([["8.8.8.8"]]);
    fakeHttps([], "127.0.0.1");
    const second = createS3DraftProbeAdapter(input);
    await expect(second.write(key, Buffer.from("x"), signal())).rejects.toThrow(
      "Storage draft probe failed.",
    );
    second.close();
  });
  it("refuses redirects without following their destination", async () => {
    dnsAnswers([["8.8.8.8"]]);
    const calls = fakeHttps([301]);
    const adapter = createS3DraftProbeAdapter(input);
    await expect(
      adapter.write(key, Buffer.from("x"), signal()),
    ).rejects.toThrow("Storage draft probe failed.");
    expect(calls).toHaveLength(1);
    adapter.close();
  });
  it("treats a 412 collision as unowned and never deletes it", async () => {
    dnsAnswers([["8.8.8.8"]]);
    const calls = fakeHttps([412]);
    const adapter = createS3DraftProbeAdapter(input);
    const result = await runStorageProbe(adapter, { createId: () => id });
    expect(result.status).toBe("write_failed");
    expect(result.cleanup).toBe("not_attempted");
    expect(calls.map((call) => call.method)).toEqual(["PUT"]);
    expect(calls[0]?.headers["if-none-match"]).toBe("*");
    adapter.close();
  });
  it("independently verifies the exact signed S3 write at the HTTPS boundary", async () => {
    dnsAnswers([["8.8.8.8"]]);
    const calls = fakeHttps([200]);
    const config = {
      ...input,
      endpoint: "https://s3.example.com:9443",
      keyPrefix: "sp ace/plus+hash#unicode-ü",
    };
    const adapter = createS3DraftProbeAdapter(config);
    const bytes = Buffer.from("synthetic signed content\n", "utf8");
    try {
      await adapter.write(key, bytes, signal());
      expect(calls).toHaveLength(1);
      const call = calls[0];
      if (!call) throw new Error("Missing synthetic signed request");
      const headers = Object.fromEntries(
        Object.entries(call.headers).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      );
      const [pathname, query] = call.path.split("?", 2);
      expect(call.method).toBe("PUT");
      expect(call.hostname === "s3.example.com").toBe(true);
      expect(String(call.port) === "9443").toBe(true);
      expect(headers.host === "s3.example.com:9443").toBe(true);
      expect(
        pathname === `/bucket/sp%20ace/plus%2Bhash%23unicode-%C3%BC/${key}`,
      ).toBe(true);
      expect(query === "x-id=PutObject").toBe(true);
      expect(call.body?.equals(bytes)).toBe(true);
      expect(headers["content-length"] === String(bytes.length)).toBe(true);
      expect(headers["if-none-match"] === "*").toBe(true);
      expect(
        headers["x-amz-content-sha256"] ===
          createHash("sha256").update(bytes).digest("hex"),
      ).toBe(true);
      const auth = headers.authorization ?? "";
      const match =
        /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([a-f0-9]{64})$/u.exec(
          auth,
        );
      if (!match) throw new Error("Invalid synthetic authorization structure");
      const [, accessKey, , region, signedHeaders, signature] = match;
      expect(accessKey === config.accessKeyId).toBe(true);
      expect(region).toBe(config.region);
      expect(signedHeaders?.split(";")).toEqual(
        expect.arrayContaining(["host", "if-none-match", "x-amz-date"]),
      );
      expect(
        recomputeS3Signature(call, config.secretAccessKey) === signature,
      ).toBe(true);
      expect(
        recomputeS3Signature(
          { ...call, path: call.path.replace("%20", "%21") },
          config.secretAccessKey,
        ) !== signature,
      ).toBe(true);
      expect(
        recomputeS3Signature(
          { ...call, path: call.path.replace("PutObject", "GetObject") },
          config.secretAccessKey,
        ) !== signature,
      ).toBe(true);
      expect(
        recomputeS3Signature(
          { ...call, method: "DELETE" },
          config.secretAccessKey,
        ) !== signature,
      ).toBe(true);
      expect(
        recomputeS3Signature(
          { ...call, body: Buffer.from("different synthetic content") },
          config.secretAccessKey,
        ) !== signature,
      ).toBe(true);
      expect(
        recomputeS3Signature(
          {
            ...call,
            headers: { ...call.headers, "if-none-match": "tampered" },
          },
          config.secretAccessKey,
        ) !== signature,
      ).toBe(true);
      expect(
        recomputeS3Signature(
          { ...call, headers: { ...call.headers, host: "altered.invalid" } },
          config.secretAccessKey,
        ) !== signature,
      ).toBe(true);
    } finally {
      adapter.close();
    }
  });
  it("retains the diagnostic object after the bounded read and never deletes", async () => {
    dnsAnswers([["8.8.8.8"]]);
    const calls = fakeHttps([200, 200, 206]);
    const adapter = createS3DraftProbeAdapter(input);
    const result = await runStorageProbe(adapter, { createId: () => id });
    expect(result.status).toBe("verified");
    expect(result.cleanup).toBe("not_attempted");
    expect(result.diagnosticObjectMayRemain).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["PUT", "HEAD", "GET"]);
    await expect(adapter.delete(key, signal())).rejects.toThrow();
    expect(calls.map((call) => call.method)).toEqual(["PUT", "HEAD", "GET"]);
    adapter.close();
  });
  it("does not start a request when already aborted", async () => {
    dnsAnswers([["8.8.8.8"]]);
    const calls = fakeHttps([]);
    const controller = new AbortController();
    controller.abort(new Error(input.secretAccessKey));
    const adapter = createS3DraftProbeAdapter(input);
    await expect(
      adapter.write(key, Buffer.from("x"), controller.signal),
    ).rejects.toThrow("Storage draft probe failed.");
    expect(calls).toHaveLength(0);
    adapter.close();
  });
  it("does not expose credentials or provider errors", async () => {
    dnsAnswers([["8.8.8.8"]]);
    fakeHttps([500]);
    const adapter = createS3DraftProbeAdapter(input);
    try {
      await adapter.write(key, Buffer.from("x"), signal());
    } catch (error) {
      expect(String(error)).toBe("Error: Storage draft probe failed.");
      expect(String(error)).not.toContain(input.secretAccessKey);
      expect(String(error)).not.toContain(input.endpoint);
    }
    adapter.close();
  });
});
