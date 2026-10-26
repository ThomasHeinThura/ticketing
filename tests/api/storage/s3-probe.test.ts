import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StorageProbeCollisionError } from "../../../apps/api/src/storage/probe-error";
import {
  deleteStorageProbeObject,
  readStorageProbeObject,
  writeStorageProbeObject,
} from "../../../apps/api/src/storage/s3";

describe("S3 storage probe adapter", () => {
  const keys = [
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_KEY_PREFIX",
  ] as const;
  const previous = new Map<string, string | undefined>();
  let server: ReturnType<typeof createServer>;
  let object: Buffer | undefined;
  let methods: string[];
  let conditionalPuts: string[];

  beforeEach(async () => {
    for (const key of keys) previous.set(key, process.env[key]);
    server = createServer((request, response) => {
      methods.push(request.method ?? "unknown");
      if (request.method === "PUT") {
        conditionalPuts.push(request.headers["if-none-match"] ?? "");
        if (object) {
          response
            .writeHead(412, { "Content-Type": "application/xml" })
            .end("<Error><Code>PreconditionFailed</Code></Error>");
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        request.on("end", () => {
          object = Buffer.concat(chunks);
          response.writeHead(200).end();
        });
      } else if (request.method === "HEAD" && object) {
        response
          .writeHead(200, { "Content-Length": String(object.byteLength) })
          .end();
      } else if (request.method === "GET" && object) {
        response
          .writeHead(200, { "Content-Length": String(object.byteLength) })
          .end(object);
      } else if (request.method === "DELETE") {
        object = undefined;
        response.writeHead(204).end();
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.S3_BUCKET = "taskdesk-test";
    process.env.S3_ACCESS_KEY_ID = "local-test-access";
    process.env.S3_SECRET_ACCESS_KEY = "local-test-secret";
    process.env.S3_KEY_PREFIX = "tenant-prefix";
    object = undefined;
    methods = [];
    conditionalPuts = [];
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

  it("uses the reserved prefixed key and verifies/deletes bytes via the S3 SDK", async () => {
    const key = "taskdesk-storage-probe-e21a9b3f-8a77-42be-9864-63d35c925735";
    const payload = Buffer.from("test");
    const controller = new AbortController();
    await writeStorageProbeObject(key, payload, controller.signal);
    await expect(
      readStorageProbeObject(key, payload.byteLength, controller.signal),
    ).resolves.toEqual(payload);
    await deleteStorageProbeObject(key, controller.signal);

    expect(object).toBeUndefined();
    expect(methods).toEqual(["PUT", "HEAD", "GET", "DELETE"]);
    expect(conditionalPuts).toEqual(["*"]);
  });

  it("reports an exclusive-create collision without deleting the existing object", async () => {
    object = Buffer.from("existing");
    const key = "taskdesk-storage-probe-e21a9b3f-8a77-42be-9864-63d35c925735";
    await expect(
      writeStorageProbeObject(
        key,
        Buffer.from("new"),
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(StorageProbeCollisionError);
    expect(object).toEqual(Buffer.from("existing"));
    expect(methods).toEqual(["PUT"]);
    expect(conditionalPuts).toEqual(["*"]);
  });
});
