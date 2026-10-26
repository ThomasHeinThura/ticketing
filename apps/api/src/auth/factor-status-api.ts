import { and, eq, gt, isNull } from "drizzle-orm";
import db, { schema } from "../database";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { dbNowUtc } from "../utils/db-time";
import {
  InactiveFactorIdentityError,
  loadLocalFactorState,
} from "./local-factor-service";
import { getPasswordCredential } from "./repository";

const availableMethodSchema = z.enum([
  "password",
  "totp",
  "backup_code",
  "sso_prompt_login",
]);

const factorStatusResponse = z.object({
  enabled: z.boolean(),
  required: z.boolean(),
  passwordRequiredForEnrollment: z.boolean(),
  policyMode: z.enum([
    "off",
    "optional",
    "required_staff",
    "required_role",
    "required_everyone",
  ]),
  availableMethods: z.array(availableMethodSchema),
});

const statusRoute = createRoute({
  method: "get",
  operationId: "getLocalFactorStatus",
  path: "/security/factors",
  tags: ["Authentication"],
  summary: "Get local factor status",
  description:
    "Returns the current user's local factor enrollment state and whether instance policy requires a factor. Never returns factor secrets or recovery codes.",
  responses: {
    200: jsonResponse("Current local factor state", factorStatusResponse),
    403: jsonResponse(
      "The caller's identity is inactive",
      z.object({ message: z.string() }),
    ),
    503: jsonResponse(
      "Factor policy could not be validated",
      z.object({ message: z.string() }),
    ),
  },
});

const factorStatus = apiRouter().openapi(statusRoute, async (c) => {
  setShadowLegacyAuthorization(c, "allowed");
  try {
    const state = await loadLocalFactorState(c.get("userId"));
    const credentials = state.enabled
      ? []
      : await getPasswordCredential(c.get("userId"));
    const passwordRequiredForEnrollment = credentials.some((credential) =>
      Boolean(credential.password),
    );
    const availableMethods: Array<
      "password" | "totp" | "backup_code" | "sso_prompt_login"
    > = [];
    if (state.enabled) {
      availableMethods.push("totp", "backup_code");
    } else if (!state.required) {
      if (passwordRequiredForEnrollment) availableMethods.push("password");
      const session = c.get("session") as { id?: string } | null;
      if (session?.id) {
        const [connection] = await db
          .select({
            id: schema.identityConnectionTable.id,
            mfaUpstreamMode: schema.identityConnectionTable.mfaUpstreamMode,
          })
          .from(schema.sessionTable)
          .innerJoin(
            schema.identityConnectionTable,
            eq(
              schema.identityConnectionTable.id,
              schema.sessionTable.identityConnectionId,
            ),
          )
          .innerJoin(
            schema.externalIdentityTable,
            and(
              eq(
                schema.externalIdentityTable.identityConnectionId,
                schema.identityConnectionTable.id,
              ),
              eq(
                schema.externalIdentityTable.userId,
                schema.sessionTable.userId,
              ),
              eq(schema.externalIdentityTable.personId, state.personId),
              eq(
                schema.externalIdentityTable.issuer,
                schema.identityConnectionTable.issuer,
              ),
              eq(schema.externalIdentityTable.active, true),
            ),
          )
          .where(
            and(
              eq(schema.sessionTable.id, session.id),
              eq(schema.sessionTable.userId, c.get("userId")),
              eq(schema.sessionTable.portal, "agent"),
              gt(schema.sessionTable.expiresAt, dbNowUtc()),
              isNull(schema.sessionTable.impersonatedBy),
              eq(schema.identityConnectionTable.enabled, true),
              eq(schema.identityConnectionTable.portalScope, "agent"),
              eq(schema.identityConnectionTable.mfaUpstreamMode, "off"),
            ),
          )
          .limit(1);
        if (connection) availableMethods.push("sso_prompt_login");
      }
    }
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        enabled: state.enabled,
        required: state.required,
        passwordRequiredForEnrollment,
        policyMode: state.policy.mode,
        availableMethods,
      },
      200,
    );
  } catch (error) {
    if (error instanceof InactiveFactorIdentityError) {
      setShadowLegacyAuthorization(c, "denied");
      return c.json({ message: "Forbidden" }, 403);
    }
    return c.json({ message: "Factor policy is unavailable" }, 503);
  }
});

export default factorStatus;
