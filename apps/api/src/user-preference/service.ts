import { type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { and, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { customFieldTable } from "../database/migration-schema";
import {
  loadAncestorIdsByProject,
  loadOwnerTeamIdsByProject,
} from "../project/hierarchy.repository";
import {
  deleteOwnSettingRow,
  listLiveProjectReachFacts,
  listOwnSettingAddresses,
  listOwnSettingRows,
  lockOwnSettingsWrites,
  upsertOwnSettingRow,
} from "./repository";
import {
  CUSTOM_FIELD_COLUMN_PATTERN,
  parseSettingKey,
  projectSettingKey,
  SETTINGS_MAX_KEYS_PER_REQUEST,
  SETTINGS_MAX_ROWS_PER_PERSON,
  type SettingTarget,
  TABLE_COLUMNS,
} from "./whitelist";

type Identity = ResolvedIdentity;

/** The subset of `projectIds` that exist (not soft-deleted) and that the caller reaches. */
async function reachableProjectWorkspaces(
  identity: Identity,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const projects = await listLiveProjectReachFacts(identity, projectIds);
  // PR-2: inherited project membership, read at call time (one query for all workspaces).
  const workspaceIds = [
    ...new Set(projects.map((project) => project.workspaceId)),
  ];
  const ancestorsByProject = await loadAncestorIdsByProject(db, workspaceIds);
  // TM-4 / reach step 5.
  const ownerTeams = await loadOwnerTeamIdsByProject(db, workspaceIds);
  return new Map(
    projects.flatMap((project) => {
      const reached = reaches(identity, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        organisationId: project.organisationId,
        ancestorProjectIds: ancestorsByProject.get(project.id) ?? [],
        ownerTeamId: ownerTeams.get(project.id) ?? null,
      });
      return reached ? [[project.id, project.workspaceId] as const] : [];
    }),
  );
}

function projectIdsOf(targets: readonly SettingTarget[]) {
  return targets.flatMap((target) =>
    target.scope === "project" ? [target.scopeId] : [],
  );
}

function customColumnKeys(value: unknown): string[] {
  const columns = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.keys(value)
      : [];
  return columns.filter(
    (column): column is string =>
      typeof column === "string" && CUSTOM_FIELD_COLUMN_PATTERN.test(column),
  );
}

async function liveCustomFieldKeys(workspaceIds: readonly string[]) {
  const byWorkspace = new Map<string, Set<string>>();
  if (workspaceIds.length === 0) return byWorkspace;
  const rows = await db
    .select({
      workspaceId: customFieldTable.workspaceId,
      key: customFieldTable.key,
    })
    .from(customFieldTable)
    .where(
      and(
        inArray(customFieldTable.workspaceId, [...workspaceIds]),
        isNull(customFieldTable.deletedAt),
      ),
    );
  for (const row of rows) {
    const keys = byWorkspace.get(row.workspaceId) ?? new Set<string>();
    keys.add(`cf.${row.key}`);
    byWorkspace.set(row.workspaceId, keys);
  }
  return byWorkspace;
}

function filterLiveCustomColumns<T>(
  target: SettingTarget,
  value: T,
  workspaceId: string,
  registeredByWorkspace: ReadonlyMap<string, ReadonlySet<string>>,
  rejectUnknown: boolean,
): T | undefined {
  if (target.kind !== "columns" && target.kind !== "columnWidths") return value;
  const registered =
    registeredByWorkspace.get(workspaceId) ?? new Set<string>();
  const entries = customColumnKeys(value);
  const unknown = entries.filter((column) => !registered.has(column));
  if (unknown.length > 0 && rejectUnknown) {
    throw new HTTPException(422, {
      message: `${target.kind}.${target.scopeId}: custom field column unavailable`,
    });
  }
  if (target.kind === "columns") {
    const columns = value as string[];
    const filtered = columns.filter(
      (column) =>
        (TABLE_COLUMNS as readonly string[]).includes(column) ||
        registered.has(column),
    );
    return filtered.length > 0 ? (filtered as T) : undefined;
  }
  const widths = value as Record<string, number>;
  const filtered = Object.fromEntries(
    Object.entries(widths).filter(
      ([column]) =>
        (TABLE_COLUMNS as readonly string[]).includes(column) ||
        registered.has(column),
    ),
  );
  return filtered as T;
}

async function readSettings(identity: Identity) {
  const rows = await listOwnSettingRows(identity.personId);

  const reachableWorkspaces = await reachableProjectWorkspaces(
    identity,
    rows.flatMap((row) =>
      row.scope === "project" && row.scopeId ? [row.scopeId] : [],
    ),
  );
  const workspaceIds = [...new Set(reachableWorkspaces.values())];
  const hasCustomColumns = rows.some(
    (row) =>
      (row.key === "columns" || row.key === "columnWidths") &&
      customColumnKeys(row.value).length > 0,
  );
  const registeredByWorkspace = hasCustomColumns
    ? await liveCustomFieldKeys(workspaceIds)
    : new Map<string, Set<string>>();

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
    const projectWorkspace =
      target.scope === "project"
        ? reachableWorkspaces.get(target.scopeId)
        : undefined;
    if (target.scope === "project" && !projectWorkspace) continue;
    // A stored value that no longer satisfies the key's schema is dropped, not served.
    const parsed = target.schema.safeParse(row.value);
    if (!parsed.success) continue;
    const filtered =
      projectWorkspace === undefined
        ? parsed.data
        : filterLiveCustomColumns(
            target,
            parsed.data,
            projectWorkspace,
            registeredByWorkspace,
            false,
          );
    if (filtered !== undefined) settings[key] = filtered;
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
          "settings: key must be density, layout.<projectId>, listGroups.<projectId>, columns.<projectId> or columnWidths.<projectId>",
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
  const projectIds = projectIdsOf(sets.map(({ target }) => target));
  const reachableWorkspaces = await reachableProjectWorkspaces(
    identity,
    projectIds,
  );
  if (projectIds.some((id) => !reachableWorkspaces.has(id))) {
    // Existence and reach are indistinguishable (404), and nothing is written.
    throw new HTTPException(404, { message: "Project not found" });
  }

  const needsCustomFieldRegistry = sets.some(
    ({ target, value }) =>
      (target.kind === "columns" || target.kind === "columnWidths") &&
      customColumnKeys(value).length > 0,
  );
  const registeredByWorkspace = needsCustomFieldRegistry
    ? await liveCustomFieldKeys([...new Set(reachableWorkspaces.values())])
    : new Map<string, Set<string>>();
  const validatedSets = sets.map(({ target, value }) => {
    if (target.scope !== "project") return { target, value };
    const workspaceId = reachableWorkspaces.get(target.scopeId);
    if (!workspaceId)
      throw new HTTPException(404, { message: "Project not found" });
    const filtered = filterLiveCustomColumns(
      target,
      value,
      workspaceId,
      registeredByWorkspace,
      true,
    );
    if (filtered === undefined)
      throw new HTTPException(422, {
        message: `${target.kind}.${target.scopeId}: at least one live column is required`,
      });
    return { target, value: filtered };
  });

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
    const newRows = validatedSets.filter(
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
    for (const { target, value } of validatedSets) {
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
