import { and, desc, eq, gt, ilike, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import { loadLocalFactorState } from "../../auth/local-factor-service";
import { consumeInstanceAdminGrantProof } from "../../auth/step-up-service";
import db, { schema } from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { createPendingAction } from "../../pending-action/service";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { requireSessionOnly } from "../../utils/require-session-only";
import { isCurrentInstanceAdmin } from "../observability/audit-failure-notifier";
import {
  decodeUserDirectoryCursor,
  encodeUserDirectoryCursor,
  escapeIlikeSubstring,
  isCurrentlySuspended,
  normalizeUserDirectoryFilters,
  type UserDirectoryFilters,
} from "./directory";

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
const querySchema = z
  .object({
    q: z.string().max(200).optional(),
    side: z.enum(["staff", "customer"]).optional(),
    active: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    organisationId: z.string().min(1).max(128).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: limitSchema,
  })
  .strict();

const personSchema = z
  .object({
    id: z.string(),
    side: z.enum(["staff", "customer"]),
    organisationId: z.string().nullable(),
    organisationName: z.string().nullable(),
    active: z.boolean(),
    isPlaceholder: z.boolean(),
  })
  .nullable();
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.string().datetime(),
  locale: z.string().nullable(),
  isInstanceAdmin: z.boolean(),
  isSuspended: z.boolean(),
  suspensionExpiresAt: z.string().datetime().nullable(),
  twoFactorEnabled: z.boolean(),
  person: personSchema,
});
const pageSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
const directoryResponse = z.object({
  data: z.array(userSchema),
  page: pageSchema,
});
const errorSchema = z.object({ message: z.string() });
const idParams = z.object({ id: z.string().min(1).max(128) });
const emptyBody = z.object({}).strict();
const suspensionBody = z
  .object({
    reason: z.string().trim().min(1).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.reason !== undefined && Array.from(body.reason).length > 500) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "too_long" });
    }
  });

const usersListRoute = createRoute({
  method: "get",
  operationId: "listInstanceUsers",
  path: "/users",
  tags: ["Instance"],
  summary: "List instance users",
  middleware: [requireSessionOnly()] as const,
  request: { query: querySchema },
  responses: {
    200: jsonResponse("Opaque-cursor user directory", directoryResponse),
    400: jsonResponse("Invalid query or cursor", errorSchema),
    403: jsonResponse("Forbidden", errorSchema),
  },
});
const userDetailRoute = createRoute({
  method: "get",
  operationId: "getInstanceUser",
  path: "/users/{id}",
  tags: ["Instance"],
  summary: "Read an instance user",
  middleware: [requireSessionOnly()] as const,
  request: { params: idParams },
  responses: {
    200: jsonResponse("Allowlisted user details", userSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("User not found", errorSchema),
  },
});
const suspendRoute = createRoute({
  method: "post",
  operationId: "suspendInstanceUser",
  path: "/users/{id}/suspend",
  tags: ["Instance"],
  summary: "Suspend an instance user",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: idParams,
    body: {
      required: true,
      content: { "application/json": { schema: suspensionBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "User suspended",
      z.object({
        suspended: z.literal(true),
        expiresAt: z.string().datetime().nullable(),
      }),
    ),
    400: jsonResponse("Invalid suspension", errorSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("User not found", errorSchema),
  },
});
const unsuspendRoute = createRoute({
  method: "post",
  operationId: "unsuspendInstanceUser",
  path: "/users/{id}/unsuspend",
  tags: ["Instance"],
  summary: "Unsuspend an instance user",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: idParams,
    body: {
      required: true,
      content: { "application/json": { schema: emptyBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "User unsuspended",
      z.object({ suspended: z.literal(false) }),
    ),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("User not found", errorSchema),
  },
});
const signOutRoute = createRoute({
  method: "post",
  operationId: "signOutInstanceUser",
  path: "/users/{id}/sign-out",
  tags: ["Instance"],
  summary: "Revoke an instance user's sessions",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: idParams,
    body: {
      required: true,
      content: { "application/json": { schema: emptyBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Sessions revoked",
      z.object({ revokedSessions: z.number().int().nonnegative() }),
    ),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("User not found", errorSchema),
  },
});
const deactivateRoute = createRoute({
  method: "post",
  operationId: "requestInstanceUserDeactivation",
  path: "/users/{id}/deactivate",
  tags: ["Instance"],
  summary: "Request person deactivation",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: idParams,
    body: {
      required: true,
      content: { "application/json": { schema: emptyBody } },
    },
  },
  responses: {
    202: jsonResponse(
      "Person deactivation pending action",
      z.object({
        pendingActionId: z.string(),
        action: z.literal("user_deactivation"),
        confirmation: z.literal("typed_name_step_up"),
        summary: z.record(z.string(), z.unknown()),
        expiresAt: z.string().datetime(),
        approveUrl: z.string(),
      }),
    ),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("User not found", errorSchema),
    409: jsonResponse("A matching pending action already exists", errorSchema),
  },
});
const grantAdminRoute = createRoute({
  method: "post",
  operationId: "grantInstanceAdmin",
  path: "/users/{id}/grant-admin",
  tags: ["Instance"],
  summary: "Grant instance administrator authority",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: idParams,
    headers: z.object({ "x-taskdesk-step-up-token": z.string().length(43) }),
    body: {
      required: true,
      content: { "application/json": { schema: emptyBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Administrator grant result",
      z.object({ outcome: z.enum(["granted", "already_admin"]) }),
    ),
    403: jsonResponse("Forbidden or step-up unavailable", errorSchema),
    404: jsonResponse("User not found", errorSchema),
    409: jsonResponse(
      "Instance setup is incomplete or the target is not eligible",
      errorSchema,
    ),
  },
});

type SessionContext = {
  id: string;
  portal?: string;
  impersonatedBy?: string | null;
} | null;
async function requireGodMode(c: Context) {
  const session = c.get("session") as SessionContext;
  if (session?.portal !== "agent" || session?.impersonatedBy) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }
  if (!(await isCurrentInstanceAdmin(c.get("userId")))) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }
  return session;
}

function safeUser(
  row: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: Date;
    locale: string | null;
    role: string | null;
    banned: boolean | null;
    banExpires: Date | null;
    twoFactorEnabled: boolean | null;
    personId: string | null;
    side: string | null;
    organisationId: string | null;
    organisationName: string | null;
    personActive: boolean | null;
    isPlaceholder: boolean | null;
  },
  now: Date,
) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
    locale: row.locale,
    isInstanceAdmin: row.role === "admin",
    isSuspended: isCurrentlySuspended(row.banned, row.banExpires, now),
    suspensionExpiresAt: row.banExpires?.toISOString() ?? null,
    twoFactorEnabled: row.twoFactorEnabled === true,
    person:
      row.personId === null
        ? null
        : {
            id: row.personId,
            side: row.side as "staff" | "customer",
            organisationId: row.organisationId,
            organisationName: row.organisationName,
            active: row.personActive === true,
            isPlaceholder: row.isPlaceholder === true,
          },
  };
}

const projection = {
  id: schema.userTable.id,
  name: schema.userTable.name,
  email: schema.userTable.email,
  emailVerified: schema.userTable.emailVerified,
  createdAt: schema.userTable.createdAt,
  locale: schema.userTable.locale,
  role: schema.userTable.role,
  banned: schema.userTable.banned,
  banExpires: schema.userTable.banExpires,
  twoFactorEnabled: schema.userTable.twoFactorEnabled,
  personId: schema.personTable.id,
  side: schema.personTable.side,
  organisationId: schema.personTable.organisationId,
  organisationName: schema.organisationTable.name,
  personActive: schema.personTable.active,
  isPlaceholder: schema.personTable.isPlaceholder,
};

const routes = apiRouter()
  .openapi(usersListRoute, async (c) => {
    await requireGodMode(c);
    const query = c.req.valid("query");
    const filters: UserDirectoryFilters = normalizeUserDirectoryFilters({
      q: query.q,
      side: query.side,
      active: query.active,
      organisationId: query.organisationId,
    });
    const cursor = query.cursor
      ? decodeUserDirectoryCursor(query.cursor, filters)
      : null;
    if (query.cursor && !cursor)
      throw new HTTPException(400, { message: "Invalid cursor" });
    const predicates = [];
    if (filters.q) {
      const escaped = `%${escapeIlikeSubstring(filters.q)}%`;
      const searchPredicate = or(
        ilike(schema.userTable.name, escaped),
        ilike(schema.userTable.email, escaped),
      );
      if (searchPredicate) predicates.push(searchPredicate);
    }
    if (filters.side)
      predicates.push(eq(schema.personTable.side, filters.side));
    if (filters.active !== undefined)
      predicates.push(eq(schema.personTable.active, filters.active));
    if (filters.organisationId)
      predicates.push(
        eq(schema.personTable.organisationId, filters.organisationId),
      );
    if (cursor) {
      const cursorPredicate = or(
        lt(schema.userTable.createdAt, cursor.createdAt),
        and(
          eq(schema.userTable.createdAt, cursor.createdAt),
          lt(schema.userTable.id, cursor.id),
        ),
      );
      if (cursorPredicate) predicates.push(cursorPredicate);
    }
    const rows = await db
      .select(projection)
      .from(schema.userTable)
      .leftJoin(
        schema.personTable,
        eq(schema.personTable.userId, schema.userTable.id),
      )
      .leftJoin(
        schema.organisationTable,
        eq(schema.organisationTable.id, schema.personTable.organisationId),
      )
      .where(predicates.length ? and(...predicates) : undefined)
      .orderBy(desc(schema.userTable.createdAt), desc(schema.userTable.id))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit);
    const last = selected.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeUserDirectoryCursor(
            { createdAt: last.createdAt, id: last.id },
            filters,
          )
        : null;
    const now = new Date();
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        data: selected.map((row) => safeUser(row, now)),
        page: { nextCursor, hasMore },
      },
      200,
    );
  })
  .openapi(userDetailRoute, async (c) => {
    await requireGodMode(c);
    const { id } = c.req.valid("param");
    const [row] = await db
      .select(projection)
      .from(schema.userTable)
      .leftJoin(
        schema.personTable,
        eq(schema.personTable.userId, schema.userTable.id),
      )
      .leftJoin(
        schema.organisationTable,
        eq(schema.organisationTable.id, schema.personTable.organisationId),
      )
      .where(eq(schema.userTable.id, id))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "User not found" });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(safeUser(row, new Date()), 200);
  })
  .openapi(suspendRoute, async (c) => {
    await requireGodMode(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expiresAt = body.expiresAt == null ? null : new Date(body.expiresAt);
    if (expiresAt && expiresAt <= new Date())
      throw new HTTPException(400, { message: "Invalid expiry" });
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: schema.userTable.id, banned: schema.userTable.banned })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, id))
        .for("update")
        .limit(1);
      if (!target) throw new HTTPException(404, { message: "User not found" });
      if (expiresAt) {
        const expiryCheck = await tx.execute<{ future: boolean }>(
          sql`SELECT now() < ${expiresAt}::timestamptz AS future`,
        );
        if (expiryCheck.rows[0]?.future !== true) {
          throw new HTTPException(400, { message: "Invalid expiry" });
        }
      }
      await tx
        .update(schema.userTable)
        .set({
          banned: true,
          banReason: body.reason ?? null,
          banExpires: expiresAt,
        })
        .where(eq(schema.userTable.id, id));
      const revokedSessions = await tx
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, id))
        .returning({ id: schema.sessionTable.id });
      await tx
        .delete(schema.apikeyTable)
        .where(eq(schema.apikeyTable.referenceId, id));
      await appendAuditLog(tx, {
        action: "auth.user_suspended",
        actorId: c.get("userId"),
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId: null,
        entityType: "user",
        entityId: id,
        before: { banned: target.banned === true },
        after: {
          outcome: "suspended",
          finiteExpiry: expiresAt !== null,
          revokedSessions: revokedSessions.length,
        },
      });
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      { suspended: true as const, expiresAt: expiresAt?.toISOString() ?? null },
      200,
    );
  })
  .openapi(unsuspendRoute, async (c) => {
    await requireGodMode(c);
    const { id } = c.req.valid("param");
    c.req.valid("json");
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: schema.userTable.id, banned: schema.userTable.banned })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, id))
        .for("update")
        .limit(1);
      if (!target) throw new HTTPException(404, { message: "User not found" });
      await tx
        .update(schema.userTable)
        .set({ banned: false, banReason: null, banExpires: null })
        .where(eq(schema.userTable.id, id));
      await appendAuditLog(tx, {
        action: "auth.user_unsuspended",
        actorId: c.get("userId"),
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId: null,
        entityType: "user",
        entityId: id,
        before: { banned: target.banned === true },
        after: { outcome: "unsuspended" },
      });
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ suspended: false as const }, 200);
  })
  .openapi(signOutRoute, async (c) => {
    await requireGodMode(c);
    const { id } = c.req.valid("param");
    c.req.valid("json");
    const revokedSessions = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, id))
        .for("update")
        .limit(1);
      if (!target) throw new HTTPException(404, { message: "User not found" });
      const sessions = await tx
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, id))
        .returning({ id: schema.sessionTable.id });
      await appendAuditLog(tx, {
        action: "auth.sessions_revoked",
        actorId: c.get("userId"),
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId: null,
        entityType: "user",
        entityId: id,
        before: null,
        after: { revokedSessions: sessions.length },
      });
      return sessions.length;
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ revokedSessions }, 200);
  })
  .openapi(deactivateRoute, async (c) => {
    await requireGodMode(c);
    const { id } = c.req.valid("param");
    c.req.valid("json");
    const [target] = await db
      .select({
        personId: schema.personTable.id,
        active: schema.personTable.active,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, id))
      .limit(1);
    if (!target?.active)
      throw new HTTPException(404, { message: "User not found" });
    const [actor] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, c.get("userId")),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
        ),
      )
      .limit(1);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    const requested = await createPendingAction({
      requesterPersonId: actor.id,
      credentialType: "session",
      credentialId: null,
      origin: "web",
      action: "user_deactivation",
      routeKey: "POST /api/instance/users/{id}/deactivate",
      targetType: "person",
      targetIds: [target.personId],
      workspaceId: null,
      projectId: null,
      organisationId: null,
      actorId: c.get("userId"),
      actorType: "person",
      actorIp: c.req.header("x-forwarded-for") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        ...requested,
        action: "user_deactivation" as const,
        confirmation: "typed_name_step_up" as const,
      },
      202,
    );
  })
  .openapi(grantAdminRoute, async (c) => {
    const session = await requireGodMode(c);
    c.req.valid("json");
    const { id } = c.req.valid("param");
    const factor = await loadLocalFactorState(c.get("userId"));
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026)`);
      const [setup] = await tx
        .select({ completedAt: schema.instanceSettingTable.setupCompletedAt })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton"))
        .for("update")
        .limit(1);
      if (!setup?.completedAt)
        throw new HTTPException(409, {
          message: "Instance setup is incomplete",
        });
      const [target] = await tx
        .select({
          id: schema.userTable.id,
          role: schema.userTable.role,
          banned: schema.userTable.banned,
          anonymous: schema.userTable.isAnonymous,
        })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, id))
        .for("update")
        .limit(1);
      if (!target) throw new HTTPException(404, { message: "User not found" });
      const people = await tx
        .select({
          id: schema.personTable.id,
          side: schema.personTable.side,
          active: schema.personTable.active,
        })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, id))
        .for("update");
      if (
        target.anonymous ||
        target.banned ||
        people.length !== 1 ||
        people[0]?.side !== "staff" ||
        people[0]?.active !== true
      ) {
        throw new HTTPException(409, { message: "Target is not eligible" });
      }
      const [actor] = await tx
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(
          and(
            eq(schema.userTable.id, c.get("userId")),
            eq(schema.userTable.role, "admin"),
          ),
        )
        .for("update")
        .limit(1);
      const actorPerson = actor
        ? await tx
            .select({ id: schema.personTable.id })
            .from(schema.personTable)
            .where(
              and(
                eq(schema.personTable.id, factor.personId),
                eq(schema.personTable.userId, actor.id),
                eq(schema.personTable.side, "staff"),
                eq(schema.personTable.active, true),
              ),
            )
            .for("update")
            .limit(1)
        : [];
      const activeSession = actor
        ? await tx
            .select({ id: schema.sessionTable.id })
            .from(schema.sessionTable)
            .where(
              and(
                eq(schema.sessionTable.id, session.id),
                eq(schema.sessionTable.userId, actor.id),
                eq(schema.sessionTable.portal, "agent"),
                gt(schema.sessionTable.expiresAt, sql`now()`),
              ),
            )
            .for("update")
            .limit(1)
        : [];
      if (!actor || actorPerson.length !== 1 || activeSession.length !== 1)
        throw new HTTPException(403, { message: "Forbidden" });
      const proof = await consumeInstanceAdminGrantProof(tx, {
        token: c.req.valid("header")["x-taskdesk-step-up-token"],
        personId: factor.personId,
        sessionId: session.id,
        userId: id,
      });
      if (
        !proof ||
        (proof.authMethod === "password" &&
          (factor.required || factor.enabled)) ||
        ((proof.authMethod === "totp" || proof.authMethod === "backup_code") &&
          !factor.enabled)
      ) {
        throw new HTTPException(403, { message: "step_up_unavailable" });
      }
      const result =
        target.role === "admin"
          ? ("already_admin" as const)
          : ("granted" as const);
      if (result === "granted")
        await tx
          .update(schema.userTable)
          .set({ role: "admin" })
          .where(eq(schema.userTable.id, id));
      const admins = await tx
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.role, "admin"));
      const recipients = [...new Set([...admins.map((row) => row.id), id])];
      await tx.insert(schema.notificationTable).values(
        recipients.map((userId) => ({
          userId,
          type: "security_alert",
          title: "Instance administrator authority changed",
          content:
            "An instance administrator grant operation was recorded. Review the instance audit log if you did not expect this change.",
          eventData:
            userId === id
              ? { kind: "instance_admin_granted" }
              : { kind: "instance_admin_granted", userId: id },
          resourceId: "singleton",
          resourceType: "instance",
        })),
      );
      await appendAuditLog(tx, {
        action: "auth.instance_admin_granted",
        actorId: c.get("userId"),
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId: null,
        entityType: "user",
        entityId: id,
        before: { role: target.role },
        after: { outcome: result },
      });
      return result;
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ outcome }, 200);
  });

export default routes;
