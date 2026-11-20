/**
 * PTM-06: `finalizeAttachmentObject` copies on a single-attempt client and classifies the copy
 * outcome. The REAL `@aws-sdk/client-s3` (signing, serialization, retry middleware, error
 * parsing) runs against an in-memory request handler: no network, no listener, no fake
 * constructor. Only the transport is replaced, so a retry that would hide an earlier attempt is
 * counted exactly as it would be against S3.
 */
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// See `attachment-s3-finalize-race.test.ts`: the mock must target the module id `s3.ts` itself
// resolves, which is only reachable through a `require` scoped to a file inside `apps/api`.
const resolvedAwsPaths = vi.hoisted(() => {
  const nodeModule = process.getBuiltinModule("node:module");
  const nodePath = process.getBuiltinModule("node:path");
  const apiS3Path = nodePath.resolve(
    import.meta.dirname,
    "../../../apps/api/src/storage/s3.ts",
  );
  return {
    clientS3: nodeModule.createRequire(apiS3Path).resolve("@aws-sdk/client-s3"),
  };
});

type Reply = {
  statusCode: number;
  body?: string;
  headers?: Record<string, string>;
};
const transport = vi.hoisted(() => ({
  calls: [] as { method: string; path: string }[],
  /** One reply per `METHOD` (copy is a PUT with `x-amz-copy-source`, delete is a DELETE). */
  replies: new Map<string, Reply>(),
}));

vi.mock(resolvedAwsPaths.clientS3, async (importOriginal) => {
  const actual = await importOriginal<{
    S3Client: new (config: object) => object;
  }>();
  const handler = {
    async handle(request: {
      method: string;
      path: string;
      headers: Record<string, string>;
    }) {
      const kind =
        request.method === "PUT" && request.headers["x-amz-copy-source"]
          ? "COPY"
          : request.method;
      transport.calls.push({ method: kind, path: request.path });
      const reply = transport.replies.get(kind) ?? { statusCode: 200 };
      return {
        response: {
          statusCode: reply.statusCode,
          reason: "",
          headers: reply.headers ?? {},
          body: Readable.from([Buffer.from(reply.body ?? "")]),
        },
      };
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs() {
      return {};
    },
    destroy() {},
  };
  class InMemoryS3Client extends actual.S3Client {
    constructor(config: object) {
      super({ ...config, requestHandler: handler });
    }
  }
  return { ...actual, S3Client: InMemoryS3Client };
});

import { finalizeAttachmentObject } from "../../../apps/api/src/storage/s3";
import { FinalizeOutcomeUnknownError } from "../../../apps/api/src/storage/shared";

const errorXml = (code: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;
const copyOk =
  '<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"abc"</ETag></CopyObjectResult>';

const savedEnv = { ...process.env };
beforeEach(() => {
  transport.calls.length = 0;
  transport.replies.clear();
  process.env.S3_ENDPOINT = "https://s3.example.test";
  process.env.S3_BUCKET = "bucket";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "test-access";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
  delete process.env.S3_KEY_PREFIX;
});
afterEach(() => {
  process.env = { ...savedEnv };
});

const copies = () => transport.calls.filter((call) => call.method === "COPY");
const deletes = () =>
  transport.calls.filter((call) => call.method === "DELETE");

describe("finalizeAttachmentObject single-attempt copy (PTM-06)", () => {
  it("a 500 on CopyObject is exactly one request and an unknown outcome, and no delete follows", async () => {
    transport.replies.set("COPY", {
      statusCode: 500,
      body: errorXml("InternalError"),
    });
    const failure = await finalizeAttachmentObject(
      "a/old",
      "a/final/new",
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FinalizeOutcomeUnknownError);
    expect(copies()).toHaveLength(1);
    expect(deletes()).toHaveLength(0);
  });

  it("a throttled copy (503 SlowDown) is one request and an unknown outcome", async () => {
    transport.replies.set("COPY", {
      statusCode: 503,
      body: errorXml("SlowDown"),
    });
    await expect(
      finalizeAttachmentObject("a/old", "a/final/new"),
    ).rejects.toBeInstanceOf(FinalizeOutcomeUnknownError);
    expect(copies()).toHaveLength(1);
  });

  it("a first-attempt 404 NoSuchKey is settled: the original error, not unknown", async () => {
    transport.replies.set("COPY", {
      statusCode: 404,
      body: errorXml("NoSuchKey"),
    });
    const failure = await finalizeAttachmentObject(
      "a/old",
      "a/final/new",
    ).catch((error: unknown) => error as { name: string });
    expect(failure).not.toBeInstanceOf(FinalizeOutcomeUnknownError);
    expect((failure as { name: string }).name).toBe("NoSuchKey");
    expect(copies()).toHaveLength(1);
    expect(deletes()).toHaveLength(0);
  });

  it("any other 4xx (here AccessDenied) is unknown, never settled", async () => {
    transport.replies.set("COPY", {
      statusCode: 403,
      body: errorXml("AccessDenied"),
    });
    await expect(
      finalizeAttachmentObject("a/old", "a/final/new"),
    ).rejects.toBeInstanceOf(FinalizeOutcomeUnknownError);
  });

  it("a 200 carrying an embedded error is unknown, not a settled copy", async () => {
    transport.replies.set("COPY", {
      statusCode: 200,
      body: errorXml("InternalError"),
    });
    await expect(
      finalizeAttachmentObject("a/old", "a/final/new"),
    ).rejects.toBeInstanceOf(FinalizeOutcomeUnknownError);
    expect(copies()).toHaveLength(1);
  });

  it("a resolved copy is settled; the old key is then deleted on the default (retrying) client", async () => {
    transport.replies.set("COPY", { statusCode: 200, body: copyOk });
    transport.replies.set("DELETE", { statusCode: 204 });
    await finalizeAttachmentObject("a/old", "a/final/new");
    expect(copies()).toHaveLength(1);
    expect(deletes()).toHaveLength(1);
  });

  it("DeleteObject keeps the default retries: a 500 delete is attempted more than once and is not an unknown outcome", async () => {
    transport.replies.set("COPY", { statusCode: 200, body: copyOk });
    transport.replies.set("DELETE", {
      statusCode: 500,
      body: errorXml("InternalError"),
    });
    const failure = await finalizeAttachmentObject(
      "a/old",
      "a/final/new",
    ).catch((error: unknown) => error);
    expect(failure).toBeDefined();
    expect(failure).not.toBeInstanceOf(FinalizeOutcomeUnknownError);
    expect(copies()).toHaveLength(1);
    expect(deletes().length).toBeGreaterThan(1);
  });
});
