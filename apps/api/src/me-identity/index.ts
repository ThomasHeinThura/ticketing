import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { loadApiKeyKind } from "../api-key/repository";
import db, { schema } from "../database";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";

export const meIdentitySchema = z
  .object({
    user: z.object({ id: z.string(), name: z.string() }).strict(),
    personId: z.string(),
    credentialType: z.enum(["session", "api_key", "mcp_key"]),
  })
  .strict()
  .openapi("MeIdentity");

const getMeIdentityRoute = createRoute({
  method: "get",
  operationId: "getMeIdentity",
  path: "/identity",
  tags: ["Authentication"],
  summary: "Get the authenticated user's own staff identity",
  description:
    "Returns only the authenticated user's identity and credential type. It does not return session tokens, cookies, email, or permissions.",
  responses: {
    200: jsonResponse("The authenticated user's identity", meIdentitySchema),
    401: errorResponse("Authentication required"),
    403: errorResponse("An active staff identity is required"),
  },
});

const router = apiRouter().openapi(getMeIdentityRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  setShadowLegacyAuthorization(c, "denied");
  const apiKey = c.get("apiKey");
  let credentialType: "session" | "api_key" | "mcp_key" = "session";
  let apiKeyPersonId: string | null = null;

  if (apiKey) {
    const kind = await loadApiKeyKind(apiKey.id);
    if (kind.kind !== "personal" || kind.disabledAt || !apiKey.enabled) {
      throw new HTTPException(403, {
        message: "An active personal staff identity is required",
      });
    }
    apiKeyPersonId = kind.personId;
    credentialType = kind.isMcp ? "mcp_key" : "api_key";
  }

  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

  const [identity] = await db
    .select({
      userId: schema.userTable.id,
      name: schema.userTable.name,
      personId: schema.personTable.id,
    })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
        eq(schema.personTable.isPlaceholder, false),
        eq(schema.userTable.banned, false),
      ),
    )
    .limit(1);

  if (
    !identity ||
    (apiKeyPersonId !== null && apiKeyPersonId !== identity.personId)
  ) {
    throw new HTTPException(403, {
      message: "An active staff identity is required",
    });
  }

  setShadowLegacyAuthorization(c, "allowed");
  return c.json(
    {
      user: { id: identity.userId, name: identity.name },
      personId: identity.personId,
      credentialType,
    },
    200,
  );
});

export default router;
