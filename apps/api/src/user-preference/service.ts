import { reaches } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  deleteOwnSettingRow,
  listLiveProjectReachFacts,
  listOwnSettingAddresses,
  listOwnSettingRows,
  lockOwnSettingsWrites,
  upsertOwnSettingRow,
} from "./repository";
import {
  layoutSettingKey,
  parseSettingKey,
  SETTINGS_MAX_KEYS_PER_REQUEST,
  SETTINGS_MAX_ROWS_PER_PERSON,
  type SettingTarget,
} from "./whitelist";

type Identity = NonNullable<Awaited<ReturnType<typeof resolveIdentity>>>;

async function resolveCaller(userId: string): Promise<Identity> {
  // The rows are the caller's own, so the credential kind does not change reach: reach is the
  // owner's current identity. Session-only enforcement for writes is the route's
  // `requireSessionOnly()` middleware, applied before this runs.
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity) {
    throw new HTTPException(403, {
      message: "No organisation identity for this account",
    });
  }
  return identity;
}

/** The subset of `projectIds` that exist (not soft-deleted) and that the caller reaches. */
async function reachableProjectIds(
  identity: Identity,
  projectIds: readonly string[],
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const projects = await listLiveProjectReachFacts(projectIds);
  return new Set(
    projects
      .filter((project) =>
        reaches(identity, {
          projectId: project.id,
          workspaceId: project.workspaceId,
          organisationId: project.organisationId,
          ancestorProjectIds: [],
          ownerTeamId: null,
        }),
      )
      .map((project) => project.id),
  );
}

async function readSettings(identity: Identity) {
  const rows = await listOwnSettingRows(identity.personId);

  const reachable = await reachableProjectIds(
    identity,
    rows.flatMap((row) =>
      row.scope === "project" && row.scopeId ? [row.scopeId] : [],
    ),
  );

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    const key =
      row.scope === "global"
        ? "density"
        : row.scopeId
          ? layoutSettingKey(row.scopeId)
          : undefined;
    if (!key) continue;
    const target = parseSettingKey(key);
    if (!target) continue;
    // A layout for a project the caller no longer reaches stays inert and is not served.
    if (target.kind === "layout" && !reachable.has(target.scopeId)) continue;
    // A stored value that no longer satisfies the key's schema is dropped, not served.
    const parsed = target.schema.safeParse(row.value);
    if (parsed.success) settings[key] = parsed.data;
  }
  return { settings };
}

export async function getOwnSettings(userId: string) {
  return readSettings(await resolveCaller(userId));
}

export async function patchOwnSettings(
  userId: string,
  body: Record<string, unknown>,
) {
  const entries = Object.entries(body);
  if (entries.length === 0) {
    throw new HTTPException(422, { message: "settings: no keys supplied" });
  }
  if (entries.length > SETTINGS_MAX_KEYS_PER_REQUEST) {
    throw new HTTPException(422, { message: "settings: too many keys" });
  }

  // Validate everything before any write: a bad key or value leaves nothing changed.
  const sets: { target: SettingTarget; value: unknown }[] = [];
  const clears: SettingTarget[] = [];
  for (const [key, value] of entries) {
    const target = parseSettingKey(key);
    if (!target) {
      throw new HTTPException(422, {
        message: "settings: key must be density or layout.<projectId>",
      });
    }
    if (value === null) {
      clears.push(target);
      continue;
    }
    const parsed = target.schema.safeParse(value);
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: `${key}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      });
    }
    sets.push({ target, value: parsed.data });
  }

  const identity = await resolveCaller(userId);
  // Reach is required to SET a layout. Clearing the caller's own row needs no reach, so a stale
  // row for a project the caller lost cannot get stuck; the result is the same whether or not
  // the row or the project existed, so it reveals nothing (ST-15).
  const projectIds = sets.flatMap(({ target }) =>
    target.kind === "layout" ? [target.scopeId] : [],
  );
  const reachable = await reachableProjectIds(identity, projectIds);
  if (projectIds.some((id) => !reachable.has(id))) {
    // Existence and reach are indistinguishable (404), and nothing is written.
    throw new HTTPException(404, { message: "Project not found" });
  }

  await db.transaction(async (tx) => {
    // One person's settings writes are serialised so the row cap below is exact, not a soft
    // bound (ST-16). The lock is per person, released at commit/rollback.
    await lockOwnSettingsWrites(tx, identity.personId);

    // Clears first, so a request that clears and sets is judged against the cap afterwards.
    for (const target of clears) {
      await deleteOwnSettingRow(tx, identity.personId, target);
    }

    // Row cap (ST-16). Replacing an existing row is always allowed.
    const existing = await listOwnSettingAddresses(tx, identity.personId);
    const have = new Set(existing.map((r) => `${r.scope}:${r.scopeId ?? ""}`));
    const newRows = sets.filter(
      (s) => !have.has(`${s.target.scope}:${s.target.scopeId ?? ""}`),
    ).length;
    if (existing.length + newRows > SETTINGS_MAX_ROWS_PER_PERSON) {
      throw new HTTPException(422, {
        message: "settings_limit: too many stored settings",
      });
    }

    const now = new Date();
    for (const { target, value } of sets) {
      await upsertOwnSettingRow(tx, {
        personId: identity.personId,
        target,
        value,
        updatedAt: now,
      });
    }
  });

  return readSettings(identity);
}
