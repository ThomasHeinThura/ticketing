import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../../auth";
import db, { schema } from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import {
  getStorageBackendStatus,
  getStorageProbeAdapter,
  type StorageProbeAdapter,
} from "../../storage";
import { requireSessionOnly } from "../../utils/require-session-only";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";
import { runStorageProbe } from "./probe";
import { storageProbeLimiter } from "./probe-limiter";

const errorSchema = z.object({ message: z.string() });
const usageResponseSchema = z.object({
  checkedAt: z.string().datetime(),
  backend: z.object({
    source: z.literal("bootstrap"),
    driver: z.enum(["filesystem", "s3", "unsupported"]),
    configuration: z.enum([
      "configured",
      "incomplete",
      "unavailable",
      "unsupported",
    ]),
    connectivity: z.literal("not_checked"),
    probeAvailable: z.boolean(),
  }),
  usageBasis: z.literal("attachment_metadata"),
  physicalUsageAvailable: z.literal(false),
  limits: z.object({
    maxAttachmentBytes: z.number().int().nonnegative(),
    maxAttachmentsPerItem: z.number().int().positive(),
    allowedExtensions: z.array(z.string()),
  }),
  attachments: z.object({
    ready: z.object({
      count: z.number().int().nonnegative(),
      bytes: z.string(),
    }),
    pending: z.object({
      count: z.number().int().nonnegative(),
      bytes: z.string(),
    }),
    deleted: z.object({
      count: z.number().int().nonnegative(),
      bytes: z.string(),
    }),
  }),
});
const probeResponseSchema = z.object({
  status: z.enum([
    "verified",
    "write_failed",
    "read_failed",
    "content_mismatch",
    "timed_out",
    "cleanup_failed",
    "cleanup_indeterminate",
  ]),
  cleanup: z.enum(["confirmed", "failed", "indeterminate", "not_attempted"]),
  durationMs: z.number().int().nonnegative(),
});

const getRoute = createRoute({
  method: "get",
  path: "/storage/usage",
  operationId: "getInstanceStorageUsage",
  tags: ["Instance"],
  summary: "Read attachment storage metadata and active backend configuration",
  description:
    "Returns logical attachment metadata totals and bootstrap-selected backend readiness. It does not enumerate physical storage or contact the provider.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse(
      "Logical attachment usage and storage readiness",
      usageResponseSchema,
    ),
    403: jsonResponse("Forbidden", errorSchema),
    503: jsonResponse("Storage metadata unavailable", errorSchema),
  },
});

const probeRoute = createRoute({
  method: "post",
  path: "/storage/test",
  operationId: "runInstanceStorageProbe",
  tags: ["Instance"],
  summary: "Run a bounded storage write/read/delete probe",
  description:
    "Writes fixed nonsecret bytes to a generated reserved key on one frozen backend selection, verifies them, and attempts to delete that exact key. No object identifiers are returned.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("Bounded storage probe outcome", probeResponseSchema),
    403: jsonResponse("Forbidden", errorSchema),
    429: jsonResponse("Storage probe is temporarily rate limited", errorSchema),
    503: jsonResponse("Storage probe unavailable", errorSchema),
  },
});

type UsageRow = {
  readyCount: number | string;
  readyBytes: number | string;
  pendingCount: number | string;
  pendingBytes: number | string;
  deletedCount: number | string;
  deletedBytes: number | string;
};

function count(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new HTTPException(503, { message: "Storage metadata unavailable" });
  return parsed;
}

function bytes(value: number | string): string {
  const parsed = BigInt(value);
  return parsed >= 0n ? parsed.toString() : "0";
}

async function readUsage() {
  const [setting] = await db
    .select({
      maxBytes: schema.instanceSettingTable.attachmentMaxBytes,
      maxPerItem: schema.instanceSettingTable.attachmentMaxPerItem,
      extensions: schema.instanceSettingTable.attachmentAllowedExtensions,
    })
    .from(schema.instanceSettingTable)
    .where(sql`${schema.instanceSettingTable.id} = 'singleton'`)
    .limit(1);
  if (!setting)
    throw new HTTPException(503, { message: "Storage metadata unavailable" });

  const result = await db.execute<UsageRow>(sql`
    SELECT
      count(*) FILTER (WHERE state = 'ready')::bigint AS "readyCount",
      COALESCE(sum(size) FILTER (WHERE state = 'ready'), 0)::text AS "readyBytes",
      count(*) FILTER (WHERE state = 'pending')::bigint AS "pendingCount",
      COALESCE(sum(size) FILTER (WHERE state = 'pending'), 0)::text AS "pendingBytes",
      count(*) FILTER (WHERE state = 'deleted')::bigint AS "deletedCount",
      COALESCE(sum(size) FILTER (WHERE state = 'deleted'), 0)::text AS "deletedBytes"
    FROM attachment
  `);
  const row = result.rows[0];
  if (!row)
    throw new HTTPException(503, { message: "Storage metadata unavailable" });
  const backend = await getStorageBackendStatus();

  return {
    checkedAt: new Date().toISOString(),
    backend,
    usageBasis: "attachment_metadata" as const,
    physicalUsageAvailable: false as const,
    limits: {
      maxAttachmentBytes: setting.maxBytes,
      maxAttachmentsPerItem: setting.maxPerItem,
      allowedExtensions: setting.extensions,
    },
    attachments: {
      ready: { count: count(row.readyCount), bytes: bytes(row.readyBytes) },
      pending: {
        count: count(row.pendingCount),
        bytes: bytes(row.pendingBytes),
      },
      deleted: {
        count: count(row.deletedCount),
        bytes: bytes(row.deletedBytes),
      },
    },
  };
}

const router = apiRouter()
  .openapi(getRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent")
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/storage/usage");
    c.header("Cache-Control", "no-store");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(await readUsage(), 200);
  })
  .openapi(probeRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent")
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(c, "POST", "/api/instance/storage/test");
    c.header("Cache-Control", "no-store");
    setShadowLegacyAuthorization(c, "allowed");
    const actorId = c.get("userId") as string | undefined;
    if (!actorId) throw new HTTPException(403, { message: "Forbidden" });
    const lease = storageProbeLimiter.acquire(actorId);
    if (!("release" in lease)) {
      c.header("Retry-After", String(lease.retryAfterSeconds));
      throw new HTTPException(429, {
        message: "Storage probe is rate limited",
      });
    }
    try {
      let adapter: StorageProbeAdapter;
      try {
        adapter = getStorageProbeAdapter();
      } catch {
        throw new HTTPException(503, { message: "Storage probe unavailable" });
      }
      return c.json(await runStorageProbe(adapter), 200);
    } finally {
      lease.release();
    }
  });

export default router;
