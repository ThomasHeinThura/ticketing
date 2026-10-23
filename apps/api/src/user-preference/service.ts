import { type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { loadAncestorIdsByProject } from "../project/hierarchy.repository";
import {
  deleteOwnSettingRow,
  listLiveProjectReachFacts,
  listOwnSettingAddresses,
  listOwnSettingRows,
  lockOwnSettingsWrites,
  upsertOwnSettingRow,
} from "./repository";
import {
  parseSettingKey,
  projectSettingKey,
  SETTINGS_MAX_KEYS_PER_REQUEST,
  SETTINGS_MAX_ROWS_PER_PERSON,
  type SettingTarget,
} from "./whitelist";

type Identity = ResolvedIdentity;

/** The subset of `projectIds` that exist (not soft-deleted) and that the caller reaches. */
async function reachableProjectIds(
  identity: Identity,
  projectIds: readonly string[],
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const projects = await listLiveProjectReachFacts(identity, projectIds);
  // PR-2: inherited project membership, read at call time (one query for all workspaces).
  const ancestorsByProject = await loadAncestorIdsByProject(db, [
    ...new Set(projects.map((project) => project.workspaceId)),
  ]);
  return new Set(
    projects
      .filter((project) =>
        reaches(identity, {
          projectId: project.id,
          workspaceId: project.workspaceId,
          organisationId: project.organisationId,
          ancestorProjectIds: ancestorsByProject.get(project.id) ?? [],
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
          ? projectSettingKey(row.key, row.scopeId)
          : undefined;
    if (!key) continue;
    const target = parseSettingKey(key);
    if (!target) continue;
    // A project setting for a project the caller no longer reaches stays inert and is not served.
    if (target.scope === "project" && !reachable.has(target.scopeId)) continue;
    // A stored value that no longer satisfies the key's schema is dropped, not served.
    const parsed = target.schema.safeParse(row.value);
    if (parsed.success) settings[key] = parsed.data;
  }
  return { settings };
}

export async function getOwnSettings(identity: Identity) {
  return readSettings(identity);
}

export async function patchOwnSettings(
  identity: Identity,
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
        message:
          "settings: key must be density, layout.<projectId>, listGroups.<projectId> or columns.<projectId>",
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

  // Reach is required to SET a layout. Clearing the caller's own row needs no reach, so a stale
  // row for a project the caller lost cannot get stuck; the result is the same whether or not
  // the row or the project existed, so it reveals nothing (ST-15).
  const projectIds = sets.flatMap(({ target }) =>
    target.scope === "project" ? [target.scopeId] : [],
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
    const address = (r: {
      scope: string;
      scopeId: string | null;
      key: string;
    }) => `${r.scope}:${r.scopeId ?? ""}:${r.key}`;
    const have = new Set(existing.map(address));
    const newRows = sets.filter(
      (s) =>
        !have.has(
          address({
            scope: s.target.scope,
            scopeId: s.target.scopeId,
            key: s.target.rowKey,
          }),
        ),
    ).length;
    if (existing.length + newRows > SETTINGS_MAX_ROWS_PER_PERSON) {
      throw new HTTPException(422, {
        message: "settings_limit: too many stored settings",
      });
    }

    const now = new Date();
    for (const { target, value } of sets) {
      const row = await upsertOwnSettingRow(tx, identity, {
        personId: identity.personId,
        target: {
          scope: target.scope,
          scopeId: target.scopeId,
          rowKey: target.rowKey,
        },
        value,
        updatedAt: now,
      });
      if (!row) throw new HTTPException(404, { message: "Project not found" });
    }
  });

  return readSettings(identity);
}
