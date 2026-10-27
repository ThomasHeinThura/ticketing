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
 * after the outermost caller's transaction has committed, and only when the work that lost the
 * row actually committed (`P2R2-03`): a request that failed (thrown error or 4xx/5xx response)
 * rolled its transaction back with the failed savepoint, so nothing is reported for it.
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
  committed: (result: T) => boolean = () => true,
): Promise<T> {
  let result: T;
  try {
    result = await storage.run(store, work);
  } catch (error) {
    // The work failed, so its transaction (and the lost audit row with it) rolled back.
    store.failed = false;
    throw error;
  }
  if (store.failed && committed(result)) {
    store.failed = false;
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
  store.failed = false;
  return result;
}

/** Stores the request's audit context for every intake route; place it before the routes. */
export const intakeAuditContext: MiddlewareHandler = async (c, next) => {
  await runWithStore(
    { readMeta: () => metaFromContext(c), failed: false },
    async () => {
      await next();
    },
    // Hono's compose turns a thrown handler error into `c.error` and an error response, so
    // `next()` resolves either way: only a successful response committed the mutation.
    () => !c.error && c.res.status < 400,
  );
};

/** Runs `work` so any audit failure inside it notifies administrators once it has finished. */
export async function withIntakeAudit<T>(work: () => Promise<T>): Promise<T> {
  if (storage.getStore()) return work();
  return runWithStore({ readMeta: () => ({}), failed: false }, work);
}

/**
 * One unit of work (one transaction) inside a longer intake store, such as one row of the
 * clarification-window job: if it throws, its transaction rolled back with any failed audit
 * append, so the failures it recorded are discarded instead of reported (`P2R2-03`).
 */
export async function intakeAuditUnit<T>(work: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  const before = store?.failed ?? false;
  try {
    return await work();
  } catch (error) {
    if (store) store.failed = before;
    throw error;
  }
}

/**
 * Appends an audit row in a savepoint with the request metadata; never throws. Inside an intake
 * store the store reports a failure once its work commits. Outside one (the request-type
 * deletion approval) it returns `true` on a failed append, and the caller must notify
 * administrators after its own transaction commits (`P2R2-01`).
 */
export async function appendIntakeAudit(
  tx: Executor,
  input: AppendAuditLogInput,
): Promise<boolean> {
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
  if (!failed) return false;
  if (store) {
    store.failed = true;
    return false;
  }
  return true;
}
