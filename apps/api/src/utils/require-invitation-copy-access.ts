import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import { rejectNulByte } from "./reject-nul-byte";
import {
  assertCallerHasCapability,
  assertCallerHasCapabilityOrOwner,
} from "./require-workspace-capability";

export type InvitationCopyOwnerLookup = {
  inviterId: string;
  inviterPersonId: string | null;
} | null;

async function defaultLoadInvitationOwner(input: {
  workspaceId: string;
  invitationId: string;
  scope: "customer" | "staff";
  organisationId?: string;
}): Promise<InvitationCopyOwnerLookup> {
  const predicates = [
    eq(schema.invitationTable.id, input.invitationId),
    eq(schema.invitationTable.workspaceId, input.workspaceId),
    eq(schema.invitationTable.scope, input.scope),
  ];
  if (input.scope === "customer") {
    predicates.push(
      eq(schema.invitationTable.organisationId, input.organisationId ?? ""),
    );
  }
  const [row] = await db
    .select({
      inviterId: schema.invitationTable.inviterId,
      inviterPersonId: schema.personTable.id,
    })
    .from(schema.invitationTable)
    .leftJoin(
      schema.personTable,
      and(
        eq(schema.personTable.userId, schema.invitationTable.inviterId),
        eq(schema.personTable.side, "staff"),
      ),
    )
    .where(and(...predicates))
    .limit(1);
  return row ?? null;
}

/**
 * Admission gate for invitation link copy endpoints (`member:invite` OR the invitation's own
 * `inviter_id` holding `workspace:read` — owner decision D-N, contract CP-23).
 *
 * Non-holders of `member:invite` who are not the row's `inviterId` always receive `403` without
 * revealing whether the invitation or organisation exists.
 */
export function requireInvitationCopyAccess(options: {
  scope: "customer" | "staff";
  idParam: string;
  loadInvitationOwner?: typeof defaultLoadInvitationOwner;
  checkCapabilityOrOwner?: (input: {
    workspaceId: string;
    userId: string;
    isOwner: boolean;
  }) => Promise<void>;
}) {
  const loadOwner = options.loadInvitationOwner ?? defaultLoadInvitationOwner;
  const checkCapability =
    options.checkCapabilityOrOwner ??
    (async ({ workspaceId, userId, isOwner }) => {
      if (isOwner) {
        await assertCallerHasCapabilityOrOwner(
          workspaceId,
          userId,
          "member:invite",
          "workspace:read",
          true,
          { kind: "session" },
        );
      } else {
        await assertCallerHasCapability(workspaceId, userId, "member:invite", {
          kind: "session",
        });
      }
    });

  return async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    const workspaceId = c.get("workspaceId") as string | undefined;
    const userId = c.get("userId") as string | undefined;
    const invitationId = c.req.param(options.idParam);
    const organisationId =
      options.scope === "customer" ? c.req.param("organisationId") : undefined;

    if (!workspaceId || !userId || !invitationId) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    rejectNulByte(invitationId, "Invitation id");
    if (organisationId !== undefined) {
      rejectNulByte(organisationId, "Organisation id");
    }

    const owner = await loadOwner({
      workspaceId,
      invitationId,
      scope: options.scope,
      organisationId,
    });
    c.set("policyRowFacts", { createdBy: owner?.inviterPersonId ?? "" });

    try {
      await checkCapability({
        workspaceId,
        userId,
        isOwner: Boolean(owner && owner.inviterId === userId),
      });
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        setShadowLegacyAuthorization(c, "denied");
      }
      throw error;
    }

    setShadowLegacyAuthorization(c, "allowed");
    return next();
  };
}
