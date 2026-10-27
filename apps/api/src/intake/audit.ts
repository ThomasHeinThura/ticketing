import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, MiddlewareHandler } from "hono";
import { clientIpForContext } from "../api-key/enforce";
import type { AppendAuditLogInput } from "../audit/audit-writer";
import type { Executor } from "../database/executor";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { ensurePolicyRequestId } from "../permissions/shadow-context";

/**
 * `AU-14` for the intake domain. An audit append runs in a savepoint (`appendAuditSavepoint`) so
 * a failed row never fails the triage action, request-type write or customer submission. The
 * request's `actorIp` (trusted-proxy aware), `userAgent`, `traceId` and `apiKeyId` are read
 * lazily from the HTTP context the middleware stores; work outside a request (the
 * clarification-window job, tests) simply records none of them. Administrators are notified once,
 * after the outermost caller's transaction has committed.
 */

type AuditContextMeta = Pick<
  AppendAuditLogInput,
  "actorIp" | "userAgent" | "traceId" | "apiKeyId"
>;

type AuditStore = {
  readMeta: () => AuditContextMeta;
  failed: boolean;
};

const storage = new AsyncLocalStorage<AuditStore>();

function metaFromContext(c: Context): AuditContextMeta {
  const apiKey = (
    c as Context<{ Variables: { apiKey?: { id?: string } } }>
  ).get("apiKey");
  return {
    actorIp: clientIpForContext(c),
    userAgent: c.req.header("user-agent") ?? null,
    // The id shared with the request log and response header, never an inbound header.
    traceId: ensurePolicyRequestId(c),
    apiKeyId: apiKey?.id ?? null,
  };
}

async function runWithStore<T>(
  store: AuditStore,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await storage.run(store, work);
  } finally {
    if (store.failed) {
      store.failed = false;
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    }
  }
}

/** Stores the request's audit context for every intake route; place it before the routes. */
export const intakeAuditContext: MiddlewareHandler = async (c, next) => {
  await runWithStore(
    { readMeta: () => metaFromContext(c), failed: false },
    async () => {
      await next();
    },
  );
};

/** Runs `work` so any audit failure inside it notifies administrators once it has finished. */
export async function withIntakeAudit<T>(work: () => Promise<T>): Promise<T> {
  if (storage.getStore()) return work();
  return runWithStore({ readMeta: () => ({}), failed: false }, work);
}

/** Appends an audit row in a savepoint with the request metadata; never throws. */
export async function appendIntakeAudit(
  tx: Executor,
  input: AppendAuditLogInput,
): Promise<void> {
  const store = storage.getStore();
  const meta = store?.readMeta() ?? {};
  const failed = await appendAuditSavepoint(tx, {
    ...meta,
    ...input,
    apiKeyId: input.apiKeyId ?? meta.apiKeyId ?? null,
    actorIp: input.actorIp ?? meta.actorIp ?? null,
    userAgent: input.userAgent ?? meta.userAgent ?? null,
    traceId: input.traceId ?? meta.traceId ?? null,
  });
  if (failed && store) store.failed = true;
}
