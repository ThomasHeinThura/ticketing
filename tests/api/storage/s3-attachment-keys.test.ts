/**
 * P1R2-6 / P1R2-7: the S3 attachment path with a configured key prefix, against a local HTTP
 * server standing in for S3 (the real AWS SDK signs and sends every request).
 *  - one key builder: upload, finalize (copy + delete), download and delete all address the
 *    same prefixed object, and the prefix is applied exactly once;
 *  - the upload credential is bound to the declared size and content type (Content-Length and
 *    Content-Type are signed headers; the stand-in verifies presigned SigV4 signatures and
 *    answers 403 on a mismatch, as S3 does);
 *  - the download response override carries an RFC 5987 `filename*` for a non-Latin name.
 */
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAttachmentStorageKey,
  createAttachmentDownloadUrl,
  createAttachmentUploadUrl,
  deleteS3Object,
  finalizeAttachmentObject,
  getAttachmentUploadTtlSeconds,
} from "../../../apps/api/src/storage/s3";
import { toFinalAttachmentObjectKey } from "../../../apps/api/src/storage/shared";

type SeenRequest = {
  method: string;
  path: string;
  copySource: string | undefined;
};

const TEST_SECRET = "local-test-secret";

/** Recomputes a presigned (query-string) SigV4 signature the way S3 does. */
function presignedSignatureMatches(request: IncomingMessage): boolean {
  const [rawPath = "/", rawQuery = ""] = (request.url ?? "/").split("?");
  const pairs = rawQuery
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const [name = "", value = ""] = pair.split("=");
      return [name, value] as const;
    });
  const query = new Map(pairs);
  const signature = query.get("X-Amz-Signature");
  const credential = decodeURIComponent(query.get("X-Amz-Credential") ?? "");
  const amzDate = query.get("X-Amz-Date") ?? "";
  const signedHeaders = decodeURIComponent(
    query.get("X-Amz-SignedHeaders") ?? "",
  ).split(";");
  const [, date = "", region = "", service = ""] = credential.split("/");
  const canonicalQuery = pairs
    .filter(([name]) => name !== "X-Amz-Signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${String(request.headers[name] ?? "").trim()}\n`)
    .join("");
  const canonicalRequest = [
    request.method,
    rawPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  let key: Buffer = createHmac("sha256", `AWS4${TEST_SECRET}`)
    .update(date)
    .digest();
  for (const part of [region, service, "aws4_request"])
    key = createHmac("sha256", key).update(part).digest();
  const expected = createHmac("sha256", key).update(stringToSign).digest("hex");
  return signature === expected;
}

describe("S3 attachment keys and upload bounds", () => {
  const keys = [
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_KEY_PREFIX",
    "S3_FORCE_PATH_STYLE",
    "S3_PRESIGN_TTL_SECONDS",
  ] as const;
  const previous = new Map<string, string | undefined>();
  let server: ReturnType<typeof createServer>;
  let seen: SeenRequest[];

  function record(request: IncomingMessage) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    seen.push({
      method: request.method ?? "unknown",
      path: decodeURIComponent(url.pathname),
      copySource: request.headers["x-amz-copy-source"]
        ? decodeURIComponent(String(request.headers["x-amz-copy-source"]))
        : undefined,
    });
  }

  beforeEach(async () => {
    for (const key of keys) previous.set(key, process.env[key]);
    seen = [];
    server = createServer((request, response) => {
      record(request);
      request.resume();
      request.on("end", () => {
        if (
          (request.url ?? "").includes("X-Amz-Signature=") &&
          !presignedSignatureMatches(request)
        ) {
          response.writeHead(403).end();
          return;
        }
        if (request.method === "PUT" && request.headers["x-amz-copy-source"]) {
          response
            .writeHead(200, { "Content-Type": "application/xml" })
            .end(
              "<CopyObjectResult><ETag>&quot;x&quot;</ETag></CopyObjectResult>",
            );
          return;
        }
        response.writeHead(request.method === "DELETE" ? 204 : 200).end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.S3_BUCKET = "taskdesk-test";
    process.env.S3_ACCESS_KEY_ID = "local-test-access";
    process.env.S3_SECRET_ACCESS_KEY = TEST_SECRET;
    process.env.S3_KEY_PREFIX = "tenant-a/";
    process.env.S3_FORCE_PATH_STYLE = "true";
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
    delete process.env.S3_PRESIGN_TTL_SECONDS;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const rawKey = "workspace/ws-1/work-item/wi-1/attachment/att-1/file.pdf";

  it("applies the key prefix once and every operation addresses the same prefixed object", async () => {
    const key = buildAttachmentStorageKey(rawKey);
    expect(key).toBe(`tenant-a/${rawKey}`);

    const upload = await createAttachmentUploadUrl(
      key,
      "application/pdf",
      1024,
      12,
    );
    expect(upload.key).toBe(key);
    const uploadPath = decodeURIComponent(new URL(upload.uploadUrl).pathname);
    expect(uploadPath).toBe(`/taskdesk-test/${key}`);

    const put = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.headers,
      body: Buffer.alloc(12),
    });
    expect(put.status).toBe(200);

    const finalKey = toFinalAttachmentObjectKey(key);
    expect(finalKey.startsWith("tenant-a/workspace/")).toBe(true);
    await finalizeAttachmentObject(key, finalKey);

    const download = await createAttachmentDownloadUrl(finalKey, "file.pdf");
    expect(decodeURIComponent(new URL(download).pathname)).toBe(
      `/taskdesk-test/${finalKey}`,
    );

    await deleteS3Object(finalKey);

    expect(seen.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `PUT /taskdesk-test/${key}`,
      `PUT /taskdesk-test/${finalKey}`,
      `DELETE /taskdesk-test/${key}`,
      `DELETE /taskdesk-test/${finalKey}`,
    ]);
    expect(seen[1]?.copySource).toBe(`taskdesk-test/${key}`);
    for (const request of seen)
      expect(request.path).not.toContain("tenant-a/tenant-a");
  });

  it("binds the upload credential to the declared size and type through signed headers", async () => {
    const key = buildAttachmentStorageKey(rawKey);
    const upload = await createAttachmentUploadUrl(
      key,
      "application/pdf",
      1024,
      12,
    );
    const signed = new URL(upload.uploadUrl).searchParams
      .get("X-Amz-SignedHeaders")
      ?.split(";");
    expect(signed).toContain("content-length");
    expect(signed).toContain("content-type");
    expect(
      Object.keys(upload.headers).map((h) => h.toLowerCase()),
    ).not.toContain("content-length");
    expect(upload.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(
      Number(new URL(upload.uploadUrl).searchParams.get("X-Amz-Expires")),
    ).toBe(getAttachmentUploadTtlSeconds());

    // No declared size, or one above the configured maximum, never yields a credential.
    await expect(
      createAttachmentUploadUrl(key, "application/pdf", 10, 12),
    ).rejects.toThrow(/declared size/);
    await expect(
      createAttachmentUploadUrl(key, "application/pdf", 10),
    ).rejects.toThrow(/declared size/);
  });

  it("rejects an upload whose Content-Type or size differs from the signed values (P1R3-2)", async () => {
    const key = buildAttachmentStorageKey(rawKey);
    const upload = await createAttachmentUploadUrl(
      key,
      "application/pdf",
      1024,
      12,
    );

    const otherType = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/html" },
      body: Buffer.alloc(12),
    });
    expect(otherType.status).toBe(403);

    const otherSize = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.headers,
      body: Buffer.alloc(13),
    });
    expect(otherSize.status).toBe(403);

    const exact = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.headers,
      body: Buffer.alloc(12),
    });
    expect(exact.status).toBe(200);
  });

  it("downloads a non-Latin file name through an RFC 5987 filename* override", async () => {
    const url = new URL(
      await createAttachmentDownloadUrl(
        buildAttachmentStorageKey(rawKey),
        "報告.pdf",
      ),
    );
    const disposition = url.searchParams.get("response-content-disposition");
    expect(disposition).toBe(
      `attachment; filename="_.pdf"; filename*=UTF-8''${encodeURIComponent("報告.pdf")}`,
    );
  });
});
