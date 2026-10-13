import { reaches } from "@taskdesk/permissions";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  isPreferenceKey,
  isPreferenceScope,
  keysForScope,
  PREFERENCE_DEFINITIONS,
  PREFERENCE_KEYS,
  PREFERENCE_MAX_ROWS_PER_PERSON,
  PREFERENCE_SCOPE_ID_MAX_LENGTH,
  type PreferenceKey,
  type PreferenceScope,
} from "./whitelist";

const { userPreferenceTable, projectTable, workspaceTable } = schema;

type Caller = { readonly personId: string; readonly identity: Identity };
type Identity = NonNullable<Awaited<ReturnType<typeof resolveIdentity>>>;

async function resolveCaller(userId: string): Promise<Caller> {
  // The preference rows are the caller's own, so the credential kind does not change reach:
  // reach is the owner's current identity. Session-only enforcement for writes is the
  // route's `requireSessionOnly()` middleware, applied before this runs.
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity) {
    throw new HTTPException(403, {
      message: "No organisation identity for this account",
    });
  }
  return { personId: identity.personId, identity };
}

/**
 * Validates the `{scope, scopeId}` shape (PREF-3/PREF-5, `422`) and that the caller reaches
 * the named workspace or project (PREF-6, `404`). Returns the normalised `scopeId`.
 */
async function assertScopeReachable(
  caller: Caller,
  scope: PreferenceScope,
  scopeId: string | undefined,
): Promise<string | null> {
  if (scope === "global") {
    if (scopeId !== undefined) {
      throw new HTTPException(422, {
        message: "scopeId: not allowed for global scope",
      });
    }
    return null;
  }
  if (!scopeId) {
    throw new HTTPException(422, {
      message: `scopeId: required for ${scope} scope`,
    });
  }
  if (scopeId.length > PREFERENCE_SCOPE_ID_MAX_LENGTH) {
    throw new HTTPException(422, { message: "scopeId: too long" });
  }

  if (scope === "workspace") {
    const { identity } = caller;
    const reachable =
      identity.side === "staff" &&
      (identity.reach.kind === "all" ||
        identity.memberships.some(
          (m) => m.scope === "workspace" && m.scopeId === scopeId,
        ));
    if (!reachable) {
      throw new HTTPException(404, { message: "Workspace not found" });
    }
    return scopeId;
  }

  const [project] = await db
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      organisationId: workspaceTable.organisationId,
    })
    .from(projectTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(and(eq(projectTable.id, scopeId), isNull(projectTable.deletedAt)))
    .limit(1);
  if (
    !project ||
    !reaches(caller.identity, {
      projectId: project.id,
      workspaceId: project.workspaceId,
      organisationId: project.organisationId,
      ancestorProjectIds: [],
      ownerTeamId: null,
    })
  ) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  return project.id;
}

function parseScope(scope: string): PreferenceScope {
  if (!isPreferenceScope(scope)) {
    throw new HTTPException(422, {
      message: "scope: must be global, workspace or project",
    });
  }
  return scope;
}

export async function listOwnPreferences(
  userId: string,
  input: { scope: string; scopeId?: string },
) {
  const scope = parseScope(input.scope);
  const caller = await resolveCaller(userId);
  const scopeId = await assertScopeReachable(caller, scope, input.scopeId);

  const keys = keysForScope(scope);
  const rows =
    keys.length === 0
      ? []
      : await db
          .select({
            key: userPreferenceTable.key,
            value: userPreferenceTable.value,
            updatedAt: userPreferenceTable.updatedAt,
          })
          .from(userPreferenceTable)
          .where(
            and(
              eq(userPreferenceTable.personId, caller.personId),
              eq(userPreferenceTable.scope, scope),
              scopeId === null
                ? isNull(userPreferenceTable.scopeId)
                : eq(userPreferenceTable.scopeId, scopeId),
              inArray(userPreferenceTable.key, keys),
            ),
          )
          .orderBy(userPreferenceTable.key);

  // A stored value that no longer satisfies the key's schema (e.g. the whitelist narrowed) is
  // dropped rather than served.
  const preferences = rows.filter(
    (row) =>
      PREFERENCE_DEFINITIONS[row.key as PreferenceKey].value.safeParse(
        row.value,
      ).success,
  );
  return { scope, scopeId, preferences };
}

export async function putOwnPreference(
  userId: string,
  input: { scope: string; key: string; scopeId?: string; value: unknown },
) {
  const scope = parseScope(input.scope);
  if (!isPreferenceKey(input.key)) {
    throw new HTTPException(422, {
      message: `key: must be one of ${PREFERENCE_KEYS.join(", ")}`,
    });
  }
  const key = input.key;
  const definition = PREFERENCE_DEFINITIONS[key];
  if (definition.scope !== scope) {
    throw new HTTPException(422, {
      message: `key: ${key} is a ${definition.scope}-scope preference`,
    });
  }
  const parsed = definition.value.safeParse(input.value);
  if (!parsed.success) {
    throw new HTTPException(422, {
      message: `value: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    });
  }

  const caller = await resolveCaller(userId);
  const scopeId = await assertScopeReachable(caller, scope, input.scopeId);

  const scopeMatch =
    scopeId === null
      ? isNull(userPreferenceTable.scopeId)
      : eq(userPreferenceTable.scopeId, scopeId);

  // PREF-7: cap rows per person. Replacing an existing row is always allowed. The count is
  // a soft bound (two concurrent first writes may both pass), which is acceptable for a
  // UI-preference store whose keys are a closed whitelist.
  const [existing] = await db
    .select({ id: userPreferenceTable.id })
    .from(userPreferenceTable)
    .where(
      and(
        eq(userPreferenceTable.personId, caller.personId),
        eq(userPreferenceTable.scope, scope),
        scopeMatch,
        eq(userPreferenceTable.key, key),
      ),
    )
    .limit(1);
  if (!existing) {
    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(userPreferenceTable)
      .where(
        and(
          eq(userPreferenceTable.personId, caller.personId),
          inArray(userPreferenceTable.key, PREFERENCE_KEYS),
        ),
      );
    if (total >= PREFERENCE_MAX_ROWS_PER_PERSON) {
      throw new HTTPException(422, {
        message: "preference_limit: too many stored preferences",
      });
    }
  }

  const now = new Date();
  const [row] = await db
    .insert(userPreferenceTable)
    .values({
      personId: caller.personId,
      scope,
      scopeId,
      key,
      value: parsed.data,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target:
        scopeId === null
          ? [
              userPreferenceTable.personId,
              userPreferenceTable.scope,
              userPreferenceTable.key,
            ]
          : [
              userPreferenceTable.personId,
              userPreferenceTable.scope,
              userPreferenceTable.scopeId,
              userPreferenceTable.key,
            ],
      targetWhere:
        scopeId === null
          ? sql`${userPreferenceTable.scopeId} is null`
          : sql`${userPreferenceTable.scopeId} is not null`,
      set: { value: parsed.data, updatedAt: now },
    })
    .returning({
      scope: userPreferenceTable.scope,
      scopeId: userPreferenceTable.scopeId,
      key: userPreferenceTable.key,
      value: userPreferenceTable.value,
      updatedAt: userPreferenceTable.updatedAt,
    });
  if (!row) throw new HTTPException(500, { message: "Preference not saved" });
  return row;
}
