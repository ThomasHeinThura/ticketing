import { HTTPException } from "hono/http-exception";
import { runWithStepUp } from "../../auth/step-up-spend";
import db from "../../database";
import { currentEncryptionKeyId } from "../../identity/client-secret";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { runSecretsRekeyJob } from "../../scheduler/secrets-rekey";
import { getSecretsRekeyProgress } from "../../secrets/rekey";
import { requireSessionOnly } from "../../utils/require-session-only";
import { isCurrentInstanceAdmin } from "../observability/audit-failure-notifier";

const errorSchema = z.object({ message: z.string() });
const progressSchema = z.object({
  currentKeyId: z.string().nullable(),
  previousKeyConfigured: z.boolean(),
  expiredInvitationDeliveryEnvelopes: z.number().int().nonnegative(),
  total: z.object({
    plugins: z.number(),
    identityConnections: z.number(),
    textSecrets: z.number(),
  }),
  pending: z.object({
    plugins: z.number(),
    identityConnections: z.number(),
    textSecrets: z.number(),
  }),
  complete: z.boolean(),
});

const rotateRoute = createRoute({
  method: "post",
  operationId: "rotateInstanceSecrets",
  path: "/plugins/rotate-secrets",
  tags: ["Instance"],
  summary: "Start the secrets-rekey job (GM-13)",
  description:
    "Instance administrator, elevated and session-only (PA-15 operation `secrets_rotate`). Re-encrypts every plugin secret, identity-connection client secret, webhook signing secret and notification token under the current key. The job runs in the background, is resumable and leader-leased; progress is read from the instance health response. Returns counts only, never a key id or envelope.",
  middleware: [requireSessionOnly()] as const,
  request: {
    headers: z.object({ "x-taskdesk-step-up-token": z.string().length(43) }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({}).strict() } },
    },
  },
  responses: {
    202: jsonResponse(
      "The job was started or is already running",
      z.object({ status: z.literal("accepted"), progress: progressSchema }),
    ),
    403: jsonResponse("Forbidden or step-up unavailable", errorSchema),
    409: jsonResponse("No encryption key is configured", errorSchema),
  },
});

const routes = apiRouter().openapi(rotateRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  const session = c.get("session") as {
    id: string;
    portal?: string;
    impersonatedBy?: string | null;
  } | null;
  if (!session || session.portal !== "agent" || session.impersonatedBy) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "session_required" });
  }
  const userId = c.get("userId") as string;
  if (!(await isCurrentInstanceAdmin(userId))) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }
  if (!currentEncryptionKeyId())
    throw new HTTPException(409, { message: "encryption_key_not_configured" });
  c.req.valid("json");
  const traceId = c.req.header("x-request-id");

  // The proof is spent in a transaction that holds nothing else: the job below is a process-level
  // action that cannot join it, so the spend commits exactly when the method is acceptable, and a
  // refusal (wrong sign-in method, stale proof) rolls the consumption back (`runWithStepUp`).
  try {
    await runWithStepUp(c, { operation: "secrets_rotate" }, (spend) =>
      db.transaction(async (tx) => {
        await spend(tx);
      }),
    );
  } catch (error) {
    setShadowLegacyAuthorization(c, "denied");
    throw error;
  }

  // Never awaited inside the request: the job holds a 30-minute lease and writes its own
  // `secrets.rekeyed` audit row (counts only). A failure is logged without any secret material.
  void runSecretsRekeyJob({ userId, traceId: traceId ?? null }).catch(
    (error: unknown) => {
      console.error(
        "secrets-rekey job failed",
        error instanceof Error ? error.message : "unknown error",
      );
    },
  );
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(
    { status: "accepted" as const, progress: await getSecretsRekeyProgress() },
    202,
  );
});

export default routes;
