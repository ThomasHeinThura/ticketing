import { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { sendGuardedOutboundRequest } from "../webhook/safe-http";
import type { StorageProbeAdapter } from "./index";
import { StorageProbeCollisionError } from "./probe-error";
import {
  resolveS3DraftEndpoint,
  type S3DraftConfig,
  s3DraftConfigSchema,
} from "./s3-draft-schema";
import { applyKeyPrefix } from "./shared";

const RESPONSE_LIMIT = 64 * 1024;
const fail = () => new Error("Storage draft probe failed.");
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

type Draft = Readonly<
  S3DraftConfig & {
    accessKeyId: string;
    secretAccessKey: string;
  }
>;

type SignedRequest = {
  protocol: string;
  hostname: string;
  port?: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  query?: Record<string, string | string[] | null>;
  body?: unknown;
  username?: string;
  password?: string;
  fragment?: string;
};

type Options = { abortSignal?: AbortSignal };

/** An inactive draft adapter. Its endpoint and credentials are captured at creation. */
export function createS3DraftProbeAdapter(
  input: Draft,
): StorageProbeAdapter & { close(): void } {
  const { accessKeyId, secretAccessKey, ...rawConfig } = input;
  const parsed = s3DraftConfigSchema.safeParse(rawConfig);
  if (!parsed.success || !accessKeyId || !secretAccessKey) throw fail();
  const config = parsed.data;
  const endpoint = new URL(resolveS3DraftEndpoint(config));
  const host = endpoint.hostname;
  const port = endpoint.port ? Number(endpoint.port) : 443;
  const allowedHosts = new Set([host]);
  if (config.connector === "external" && !config.forcePathStyle)
    allowedHosts.add(`${config.bucket}.${host}`);
  const controllers = new Set<AbortController>();
  let closed = false;
  const owned = new Set<string>();
  const requestHandler = {
    async handle(request: SignedRequest, options: Options = {}) {
      try {
        if (
          closed ||
          options.abortSignal?.aborted ||
          request.protocol !== endpoint.protocol ||
          !allowedHosts.has(request.hostname) ||
          (request.port ?? (endpoint.protocol === "https:" ? 443 : 80)) !==
            port ||
          request.username ||
          request.password ||
          request.fragment ||
          !["PUT", "GET", "HEAD"].includes(request.method) ||
          !request.path.startsWith("/") ||
          (request.body !== undefined &&
            !(request.body instanceof Uint8Array) &&
            typeof request.body !== "string")
        )
          throw fail();
        const query = Object.entries(request.query ?? {})
          .flatMap(([key, value]) =>
            (Array.isArray(value) ? value : [value]).map(
              (v) => `${encode(key)}${v === null ? "" : `=${encode(v)}`}`,
            ),
          )
          .join("&");
        const controller = new AbortController();
        controllers.add(controller);
        const abort = () => controller.abort();
        options.abortSignal?.addEventListener("abort", abort, { once: true });
        if (options.abortSignal?.aborted) controller.abort();
        let result: Awaited<ReturnType<typeof sendGuardedOutboundRequest>>;
        try {
          result = await sendGuardedOutboundRequest({
            origin: `${endpoint.protocol}//${request.hostname}${endpoint.port ? `:${endpoint.port}` : ""}`,
            path: request.path + (query ? `?${query}` : ""),
            method: request.method,
            headers: request.headers,
            body: request.body as Uint8Array | string | undefined,
            policy:
              config.connector === "bundled_seaweedfs"
                ? "bundled-seaweedfs"
                : "strict-public-https",
            timeoutMs: 10_000,
            maxResponseBytes: RESPONSE_LIMIT,
            signal: controller.signal,
          });
        } finally {
          controllers.delete(controller);
          options.abortSignal?.removeEventListener("abort", abort);
        }
        return {
          response: {
            statusCode: result.statusCode,
            headers: result.headers,
            body: Readable.from(result.body),
          },
        };
      } catch {
        throw fail();
      }
    },
    destroy() {
      closed = true;
      for (const controller of controllers) controller.abort();
    },
  };
  const client = new S3Client({
    endpoint: endpoint.origin,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    maxAttempts: 1,
    followRegionRedirects: false,
    requestHandler: requestHandler as S3ClientConfig["requestHandler"],
  });
  const keyFor = (key: string) => {
    if (!/^taskdesk-storage-probe-[0-9a-f-]{36}$/u.test(key)) throw fail();
    return applyKeyPrefix(config.keyPrefix, key);
  };
  return {
    driver: "s3",
    async write(key, bytes, signal) {
      const objectKey = keyFor(key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            Body: bytes,
            ContentLength: bytes.byteLength,
            IfNoneMatch: "*",
          }),
          { abortSignal: signal },
        );
        owned.add(key);
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 412
        )
          throw new StorageProbeCollisionError();
        throw fail();
      }
    },
    async read(key, maxBytes, signal) {
      const objectKey = keyFor(key);
      if (
        !owned.has(key) ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > RESPONSE_LIMIT
      )
        throw fail();
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
          { abortSignal: signal },
        );
        if (head.ContentLength === undefined || head.ContentLength > maxBytes)
          throw fail();
        if (!head.ContentLength) return Buffer.alloc(0);
        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            Range: `bytes=0-${head.ContentLength - 1}`,
          }),
          { abortSignal: signal },
        );
        if (!result.Body) throw fail();
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
          total += chunk.byteLength;
          if (total > maxBytes || signal.aborted) throw fail();
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      } catch {
        throw fail();
      }
    },
    async delete() {
      throw fail();
    },
    close() {
      client.destroy();
    },
  };
}
