/**
 * Real S3 compatibility contract against the pinned SeaweedFS image. Docker must be
 * available and able to use that image; this test deliberately fails rather than skips.
 * It uses an ephemeral container and bucket, never the application's configured bucket.
 * This verifies the storage driver, not attachment routes, browser CORS enforcement,
 * TLS, production networking, or any database-backed completion workflow.
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAttachmentDownloadUrl,
  createAttachmentUploadUrl,
  deleteS3Object,
  finalizeAttachmentObject,
} from "../../apps/api/src/storage/s3";

// This test is outside the API package; resolve its existing SDK dependency from there.
const requireFromApi = createRequire(
  fileURLToPath(new URL("../../apps/api/package.json", import.meta.url)),
);
const { S3Client, CreateBucketCommand, PutBucketCorsCommand } = requireFromApi(
  "@aws-sdk/client-s3",
) as typeof import("../../apps/api/node_modules/@aws-sdk/client-s3");

const origins = ["https://agent.example.test", "https://portal.example.test"];
const originalS3Env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith("S3_")),
);
let directory: string | undefined;
let containerId: string | undefined;
let networkId: string | undefined;
let client: InstanceType<typeof S3Client> | undefined;
let endpoint = "";
const bucket = `taskdesk-${randomUUID()}`;
const pending = `scratch/${randomUUID()}/pending`;
const finalKey = `scratch/${randomUUID()}/final`;

function docker(...args: string[]): string {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    // Docker diagnostics can contain arguments and paths; never surface them.
    throw new Error("SeaweedFS test Docker operation failed");
  }
}

function restoreS3Env() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("S3_")) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalS3Env)) {
    if (value !== undefined) process.env[key] = value;
  }
}

async function safe<T>(
  operation: () => Promise<T>,
  stage: () => string,
): Promise<T> {
  try {
    return await operation();
  } catch {
    // SDK and fetch errors can include endpoints, request URLs and credentials.
    throw new Error(
      `SeaweedFS compatibility failed at ${stage()}; sensitive diagnostics suppressed`,
    );
  }
}

describe("real SeaweedFS S3 compatibility", () => {
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "taskdesk-seaweedfs-"));
    const accessKeyId = randomBytes(16).toString("hex");
    const secretAccessKey = randomBytes(32).toString("hex");
    const config = join(directory, "s3.json");
    writeFileSync(
      config,
      JSON.stringify({
        identities: [
          {
            name: "test",
            credentials: [
              { accessKey: accessKeyId, secretKey: secretAccessKey },
            ],
            actions: ["Read", "Write", "List", "Tagging", "Admin"],
          },
        ],
      }),
      { mode: 0o600 },
    );
    let stage = "network creation";
    try {
      // Docker Desktop does not publish host ports on an internal-only network.
      // Use a private per-test bridge with only the S3 port bound to loopback.
      networkId = docker(
        "network",
        "create",
        `taskdesk-seaweedfs-${randomUUID()}`,
      );
      if (!/^[a-f0-9]{64}$/u.test(networkId))
        throw new Error("Invalid network ID");
      stage = "container creation";
      containerId = docker(
        "create",
        "--log-driver",
        "none",
        "--network",
        networkId,
        "--publish",
        "127.0.0.1::8333",
        "--mount",
        `type=bind,source=${config},target=/etc/seaweedfs/s3.json,readonly`,
        "--tmpfs",
        "/data",
        "chrislusf/seaweedfs:3.97@sha256:bb05d66d2963b1cc48073190781c3dd29e2c4c88a2ae2986bf58e38c86d89c6e",
        "server",
        "-dir=/data",
        "-s3",
        "-s3.config=/etc/seaweedfs/s3.json",
      );
      if (!/^[a-f0-9]{64}$/u.test(containerId))
        throw new Error("Invalid container ID");
      console.info("SeaweedFS fixture container:", containerId);
      stage = "container start";
      docker("start", containerId);
      stage = "loopback binding";
      const binding = docker("port", containerId, "8333/tcp");
      if (!binding) throw new Error("empty binding");
      const port = /^127\.0\.0\.1:(\d+)$/u.exec(binding)?.[1];
      if (!port) throw new Error("Invalid loopback port binding");
      endpoint = `http://127.0.0.1:${port}`;
      restoreS3Env();
      for (const key of Object.keys(process.env))
        if (key.startsWith("S3_")) delete process.env[key];
      Object.assign(process.env, {
        S3_ENDPOINT: endpoint,
        S3_BUCKET: bucket,
        S3_ACCESS_KEY_ID: accessKeyId,
        S3_SECRET_ACCESS_KEY: secretAccessKey,
        S3_REGION: "us-east-1",
        S3_FORCE_PATH_STYLE: "true",
      });
      client = new S3Client({
        endpoint,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: "WHEN_REQUIRED",
        maxAttempts: 1,
      });
      stage = "bucket creation";
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
          ready = true;
          break;
        } catch {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        }
      }
      if (!ready) throw new Error("SeaweedFS failed to become ready");
      stage = "bucket CORS configuration";
      await client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: origins,
                AllowedMethods: ["GET", "PUT"],
                AllowedHeaders: ["*"],
              },
            ],
          },
        }),
      );
    } catch {
      throw new Error(
        `SeaweedFS compatibility setup failed at ${stage}; sensitive diagnostics suppressed`,
      );
    }
  }, 60_000);

  afterAll(() => {
    client?.destroy();
    restoreS3Env();
    try {
      if (containerId && /^[a-f0-9]{64}$/u.test(containerId))
        docker("rm", "--force", containerId);
    } finally {
      try {
        if (networkId && /^[a-f0-9]{64}$/u.test(networkId))
          docker("network", "rm", networkId);
      } finally {
        if (directory) rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("enforces signed uploads, private downloads, snapshot isolation and bucket CORS", async () => {
    let stage = "signed upload";
    await safe(
      async () => {
        const bytes = Buffer.from("original test attachment");
        const replacement = Buffer.alloc(bytes.length, 0x78);
        try {
          const signed = await createAttachmentUploadUrl(
            pending,
            "text/plain",
            bytes.length,
            bytes.length,
          );
          const put = (body: Buffer, type: string) =>
            fetch(signed.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": type },
              body: Uint8Array.from(body),
            });
          expect(
            (await put(Buffer.concat([bytes, Buffer.from("!")]), "text/plain"))
              .ok,
          ).toBe(false);
          expect((await put(bytes, "application/octet-stream")).ok).toBe(false);
          expect((await put(bytes, "text/plain")).ok).toBe(true);
          stage = "finalize and signed download";
          await finalizeAttachmentObject(pending, finalKey);
          const download = await createAttachmentDownloadUrl(
            finalKey,
            "test.txt",
          );
          const read = async () => {
            const response = await fetch(download);
            expect(response.ok).toBe(true);
            return Buffer.from(await response.arrayBuffer());
          };
          expect(await read()).toEqual(bytes);
          stage = "anonymous download denial";
          expect(
            (await fetch(`${endpoint}/${bucket}/${finalKey}`)).status,
          ).toBe(403);
          // A still-valid pending PUT may succeed, but cannot mutate the final snapshot.
          stage = "upload replay isolation";
          await put(replacement, "text/plain");
          expect(await read()).toEqual(bytes);
          stage = "CORS preflight";
          for (const origin of [...origins, "https://untrusted.example.test"]) {
            const response = await fetch(signed.uploadUrl, {
              method: "OPTIONS",
              headers: {
                Origin: origin,
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "content-type",
              },
            });
            if (origins.includes(origin)) {
              expect(response.ok).toBe(true);
              expect(response.headers.get("access-control-allow-origin")).toBe(
                origin,
              );
              expect(
                response.headers.get("access-control-allow-methods"),
              ).toContain("PUT");
            } else {
              expect(
                response.headers.get("access-control-allow-origin"),
              ).not.toBe(origin);
              expect(
                response.headers.get("access-control-allow-origin"),
              ).not.toBe("*");
            }
          }
        } finally {
          try {
            await deleteS3Object(pending);
          } finally {
            await deleteS3Object(finalKey);
          }
        }
      },
      () => stage,
    );
  }, 60_000);
});
