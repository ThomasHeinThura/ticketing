import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../../auth";
import { runWithStepUp, stepUpTokenHeader } from "../../auth/step-up-spend";
import db, { schema } from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import {
  STORAGE_CONFIG_SAVE_OPERATION,
  STORAGE_CONFIG_TEST_OPERATION,
} from "../../storage/s3-draft-binding";
import { createS3DraftProbeAdapter } from "../../storage/s3-draft-probe";
import {
  s3DraftConfigSchema,
  s3DraftWriteSchema,
} from "../../storage/s3-draft-schema";
import {
  getS3Draft,
  saveS3Draft,
  selectS3DraftForProbe,
} from "../../storage/s3-draft-service";
import { requireSessionOnly } from "../../utils/require-session-only";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";
import { runStorageProbe } from "./probe";
import { storageProbeResponseSchema } from "./probe-schema";

const PATH = "/api/instance/storage/s3-draft";
const errorSchema = z.object({ message: z.string() });
const responseSchema = z.object({
  version: z.number().int().nonnegative(),
  config: s3DraftConfigSchema.nullable(),
  credentialConfigured: z.boolean(),
  accessKeyIdConfigured: z.boolean(),
  secretAccessKeyConfigured: z.boolean(),
});
const getRoute = createRoute({
  method: "get",
  path: "/storage/s3-draft",
  operationId: "getInstanceS3Draft",
  tags: ["Instance"],
  summary: "Read the inactive S3 storage draft without credentials",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("Inactive S3 draft", responseSchema),
    403: jsonResponse("Forbidden", errorSchema),
    503: jsonResponse("Draft unavailable", errorSchema),
  },
});
const mutationResponses = {
  403: jsonResponse("Forbidden or fresh verification required", errorSchema),
  409: jsonResponse(
    "Draft version changed; reload before retrying",
    errorSchema,
  ),
  503: jsonResponse("Draft unavailable", errorSchema),
};
const saveRoute = createRoute({
  method: "put",
  path: "/storage/s3-draft",
  operationId: "saveInstanceS3Draft",
  tags: ["Instance"],
  summary: "Save encrypted inactive S3 settings with a separate one-use proof",
  description:
    "Current instance administrators and agent sessions only. The proof binds the exact normalized configuration, draft version and credential changes. Saving never changes the active backend or migrates files.",
  middleware: [requireSessionOnly()] as const,
  request: {
    headers: stepUpTokenHeader,
    body: {
      required: true,
      content: { "application/json": { schema: s3DraftWriteSchema } },
    },
  },
  responses: {
    200: jsonResponse("Saved inactive S3 draft", responseSchema),
    ...mutationResponses,
  },
});
const testRoute = createRoute({
  method: "post",
  path: "/storage/s3-draft/test",
  operationId: "testInstanceS3Draft",
  tags: ["Instance"],
  summary: "Verify a candidate S3 draft with a separate one-use proof",
  description:
    "Commits the test proof and attempt audit before bounded write/read networking. Public external HTTPS targets use DNS and socket guards; the bundled connector uses only its fixed internal service. A small diagnostic object may remain. No cleanup, browser transfer, file migration or backend activation is claimed.",
  middleware: [requireSessionOnly()] as const,
  request: {
    headers: stepUpTokenHeader,
    body: {
      required: true,
      content: { "application/json": { schema: s3DraftWriteSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Server-side write/read result",
      storageProbeResponseSchema.extend({
        browserPathVerified: z.literal(false),
      }),
    ),
    429: jsonResponse("Test temporarily rate limited", errorSchema),
    ...mutationResponses,
  },
});

async function requireStorageAdmin(
  c: Context,
  method: "GET" | "PUT" | "POST",
  path: string,
) {
  c.header("Cache-Control", "no-store");
  if (portalForHost(c.req.header("host")) !== "agent")
    throw new HTTPException(403, { message: "Forbidden" });
  await requireCurrentInstanceAdmin(c, method, path);
  const userId = c.get("userId") as string;
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!person) throw new HTTPException(403, { message: "Forbidden" });
  return {
    userId,
    personId: person.id,
    traceId: normaliseTraceId(c.req.header("x-request-id")),
  };
}

export default apiRouter()
  .openapi(getRoute, async (c) => {
    await requireStorageAdmin(c, "GET", PATH);
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(await getS3Draft(), 200);
  })
  .openapi(saveRoute, async (c) => {
    const actor = await requireStorageAdmin(c, "PUT", PATH);
    const request = c.req.valid("json");
    const saved = await runWithStepUp(
      c,
      { operation: STORAGE_CONFIG_SAVE_OPERATION, ...request },
      (spend) => saveS3Draft(request, actor, spend),
    );
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(saved, 200);
  })
  .openapi(testRoute, async (c) => {
    const actor = await requireStorageAdmin(c, "POST", `${PATH}/test`);
    const request = c.req.valid("json");
    const selection = await runWithStepUp(
      c,
      { operation: STORAGE_CONFIG_TEST_OPERATION, ...request },
      (spend) => selectS3DraftForProbe(request, actor, spend),
    );
    let adapter: ReturnType<typeof createS3DraftProbeAdapter>;
    try {
      adapter = createS3DraftProbeAdapter({
        ...selection.config,
        ...selection.credentials,
      });
    } catch {
      throw new HTTPException(503, {
        message: "Storage draft test unavailable",
      });
    }
    try {
      const result = await runStorageProbe(adapter);
      setShadowLegacyAuthorization(c, "allowed");
      return c.json({ ...result, browserPathVerified: false as const }, 200);
    } finally {
      adapter.close();
    }
  });
