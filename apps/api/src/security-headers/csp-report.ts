import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Context, MiddlewareHandler, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../api-key/enforce";
import db, { schema } from "../database";
import { apiRouter, createRoute, errorResponse, z } from "../openapi";
import { resolveAuthSecret } from "../utils/require-auth-secret";

const BUCKET = "anonymous_csp_report" as const;
export const CSP_REPORT_MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS_PER_BATCH = 20;
const MAX_DIAGNOSTIC_COUNT = 2_147_483_647;

export type CspReportOutcome =
  | "accepted"
  | "invalid"
  | "too_large"
  | "rate_limited"
  | "limiter_unavailable";

const diagnosticCounts: Record<CspReportOutcome, number> = {
  accepted: 0,
  invalid: 0,
  too_large: 0,
  rate_limited: 0,
  limiter_unavailable: 0,
};

function recordOutcome(outcome: CspReportOutcome) {
  diagnosticCounts[outcome] = Math.min(
    MAX_DIAGNOSTIC_COUNT,
    diagnosticCounts[outcome] + 1,
  );
}

/** Closed, process-local counters; report contents and caller identities are never retained. */
export function readCspReportDiagnosticCounters() {
  return { ...diagnosticCounts };
}

const reportScalar = z.union([
  z.string().max(4096),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const reportObject = z
  .record(z.string().max(80), reportScalar)
  .refine((value) => Object.keys(value).length <= 64);
const legacyReport = z.object({ "csp-report": reportObject }).strict();
const modernReportEntry = z
  .object({
    type: z.literal("csp-violation"),
    age: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    url: z.string().max(2048).optional(),
    user_agent: z.string().max(1024).optional(),
    body: reportObject,
  })
  .strict();
const modernReportBatch = z
  .array(modernReportEntry)
  .min(1)
  .max(MAX_REPORTS_PER_BATCH);

export const cspReportRequestSchema = z.union([
  legacyReport,
  modernReportBatch,
]);

type RateDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function dateValue(value: Date | string | undefined): Date {
  const parsed = value instanceof Date ? value : new Date(value ?? "");
  if (Number.isNaN(parsed.getTime()))
    throw new Error("CSP report limiter unavailable");
  return parsed;
}

function digestClientKey(clientIp: string | null, windowMs: number) {
  const resolved = resolveAuthSecret(process.env.TASKDESK_AUTH_SECRET);
  if (!resolved.ok) throw new Error("CSP report limiter unavailable");
  return createHmac("sha256", resolved.secret)
    .update(BUCKET)
    .update("\0")
    .update(String(windowMs))
    .update("\0")
    .update(clientIp ?? "no-trusted-client-ip")
    .digest("hex");
}

async function consumeCspReportRateLimit(
  context: Context,
): Promise<RateDecision> {
  const [settings] = await db
    .select({
      windowMs: schema.instanceSettingTable.anonymousRateLimitWindowMs,
      max: schema.instanceSettingTable.anonymousRateLimitMax,
    })
    .from(schema.instanceSettingTable)
    .where(sql`${schema.instanceSettingTable.id} = 'singleton'`)
    .limit(1);
  if (
    !settings ||
    !Number.isSafeInteger(settings.windowMs) ||
    settings.windowMs < 60_000 ||
    settings.windowMs > 86_400_000 ||
    !Number.isSafeInteger(settings.max) ||
    settings.max < 1 ||
    settings.max > 10_000
  ) {
    throw new Error("CSP report limiter unavailable");
  }

  const keyHash = digestClientKey(
    clientIpForContext(context),
    settings.windowMs,
  );
  const result = await db.execute(sql`
    WITH rate_clock AS (SELECT clock_timestamp() AS now)
    INSERT INTO ${schema.requestRateLimitCounterTable}
      (bucket, key_hash, window_started_at, count, expires_at, created_at, updated_at)
    SELECT ${BUCKET}, ${keyHash}, rate_clock.now, 1,
      rate_clock.now + (${settings.windowMs} * interval '1 millisecond'),
      rate_clock.now, rate_clock.now
    FROM rate_clock
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${settings.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN EXCLUDED.window_started_at
        ELSE ${schema.requestRateLimitCounterTable}.window_started_at
      END,
      count = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${settings.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN 1
        WHEN ${schema.requestRateLimitCounterTable}.count < ${settings.max}
        THEN ${schema.requestRateLimitCounterTable}.count + 1
        ELSE LEAST(${schema.requestRateLimitCounterTable}.count + 1, ${settings.max} + 1)
      END,
      expires_at = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${settings.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN EXCLUDED.expires_at
        ELSE ${schema.requestRateLimitCounterTable}.expires_at
      END,
      updated_at = EXCLUDED.updated_at
    RETURNING count, window_started_at, clock_timestamp() AS now
  `);
  const row = result.rows[0] as
    | { count: number; window_started_at: Date | string; now: Date | string }
    | undefined;
  if (!row) throw new Error("CSP report limiter unavailable");
  const startedAt = dateValue(row.window_started_at);
  const now = dateValue(row.now).getTime();
  const allowed = row.count <= settings.max;
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(
          1,
          Math.ceil((startedAt.getTime() + settings.windowMs - now) / 1000),
        ),
  };
}

function rateLimitMiddleware(): MiddlewareHandler {
  return async (context: Context, next: Next) => {
    let decision: RateDecision;
    try {
      decision = await consumeCspReportRateLimit(context);
    } catch {
      recordOutcome("limiter_unavailable");
      throw new HTTPException(503, {
        message: "CSP report service unavailable",
      });
    }
    if (!decision.allowed) {
      recordOutcome("rate_limited");
      context.header("Retry-After", String(decision.retryAfterSeconds));
      throw new HTTPException(429, { message: "Too many requests" });
    }
    await next();
    if (context.res.status === 400 || context.res.status === 415)
      recordOutcome("invalid");
  };
}

function supportedContentType(context: Context): string | undefined {
  return context.req
    .header("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
}

function normalizeReportContentType(): MiddlewareHandler {
  return async (context: Context, next: Next) => {
    const contentType = supportedContentType(context);
    if (
      contentType !== "application/csp-report" &&
      contentType !== "application/reports+json" &&
      contentType !== "application/json"
    ) {
      return context.json({ message: "Unsupported report format" }, 415);
    }
    if (contentType !== "application/json") {
      const headers = new Headers(context.req.raw.headers);
      headers.set("content-type", "application/json");
      context.req.raw = new Request(context.req.raw, { headers });
    }
    await next();
  };
}

const reportRoute = createRoute({
  method: "post",
  path: "/",
  operationId: "receiveCspViolationReport",
  tags: ["Security"],
  summary: "Receive a bounded browser CSP violation report",
  description:
    "Accepts legacy CSP and Reporting API JSON reports. The server retains only bounded diagnostic outcome counters; submitted report fields are discarded.",
  security: [],
  middleware: [
    bodyLimit({
      maxSize: CSP_REPORT_MAX_BODY_BYTES,
      onError: (context) => {
        recordOutcome("too_large");
        return context.json({ message: "Report is too large" }, 413);
      },
    }),
    rateLimitMiddleware(),
    normalizeReportContentType(),
  ] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/csp-report": { schema: cspReportRequestSchema },
        "application/reports+json": { schema: cspReportRequestSchema },
        "application/json": { schema: cspReportRequestSchema },
      },
    },
  },
  responses: {
    204: { description: "Report accepted; no report fields are retained" },
    400: errorResponse("Malformed or unsupported report JSON"),
    413: errorResponse("Report body exceeds 16 KiB"),
    415: errorResponse("Unsupported report media type"),
    429: errorResponse("Anonymous report limit exceeded"),
    503: errorResponse("Report service is unavailable"),
  },
});

export const cspReportApi = apiRouter().openapi(
  reportRoute,
  async (context) => {
    // The validator checks a bounded outer envelope; report fields are never
    // copied, logged, persisted, or echoed from this point onward.
    recordOutcome("accepted");
    return context.body(null, 204);
  },
  (result, context) => {
    if (!result.success) {
      // The default API hook includes the submitted field path in its error.
      // Keep reports opaque: no report data or attacker-chosen key is reflected.
      return context.json({ message: "Invalid report" }, 400);
    }
  },
);
