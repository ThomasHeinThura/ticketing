import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  applicableFields,
  type TypeVisibility,
} from "../../custom-field/logic";
import {
  listFields,
  loadValueMaps,
  type MaterializedField,
} from "../../custom-field/repository";
import db, { schema } from "../../database";
import type { AuthenticatedApiKey } from "../../permissions/resolve-request-identity";
import {
  loadAncestorIdsByProject,
  loadOwnerTeamIdsByProject,
} from "../../project/hierarchy.repository";
import { hasProjectReadCapability } from "../../utils/has-project-reach";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "../../utils/require-workspace-capability";
import { customFieldColumnKeys } from "./custom-field-filter";

export type CustomFieldProjectionRow = {
  id: string;
  projectId: string;
  typeId: string;
};

export type CustomFieldSortProjectAuthority = {
  projectId: string;
  rosterProjectIds: string[];
  canViewAssignableNames: boolean;
  canViewOwnName: boolean;
};

/**
 * Reuses the same capability and project ancestry checks as the visible-person projection.
 * The sort query uses these exact project grants to resolve names; callers must still join
 * active, non-placeholder staff membership in `rosterProjectIds` before using a name.
 */
export async function customFieldSortProjectAuthority({
  identity,
  userId,
  apiKey,
  workspaceId,
  projects,
}: {
  identity: ResolvedIdentity;
  userId: string;
  apiKey: AuthenticatedApiKey | undefined;
  workspaceId: string;
  projects: readonly {
    projectId: string;
    ancestorProjectIds: readonly string[];
    ownerTeamId: string | null;
  }[];
}): Promise<CustomFieldSortProjectAuthority[]> {
  if (projects.length === 0) return [];
  const ancestorsByProject = await loadAncestorIdsByProject(db, [workspaceId]);
  const ownerTeams = await loadOwnerTeamIdsByProject(db, [workspaceId]);
  const canAssignWorkspace = await workspaceCapability(
    workspaceId,
    userId,
    apiKey,
    "work_item:assign",
  );
  const canUpdateWorkspace = await workspaceCapability(
    workspaceId,
    userId,
    apiKey,
    "work_item:update",
  );
  return projects.map((project) => {
    const ancestorProjectIds =
      project.ancestorProjectIds.length > 0
        ? [...project.ancestorProjectIds]
        : (ancestorsByProject.get(project.projectId) ?? []);
    const facts = {
      projectId: project.projectId,
      workspaceId,
      ancestorProjectIds,
      ownerTeamId:
        project.ownerTeamId ?? ownerTeams.get(project.projectId) ?? null,
      organisationId: null,
    };
    return {
      projectId: project.projectId,
      rosterProjectIds: [project.projectId, ...ancestorProjectIds],
      canViewAssignableNames:
        canAssignWorkspace &&
        hasProjectReadCapability(
          identity,
          "work_item:assign",
          "work_item",
          facts,
        ),
      canViewOwnName:
        canUpdateWorkspace &&
        Boolean(identity.personId) &&
        hasProjectReadCapability(
          identity,
          "work_item:update",
          "work_item",
          facts,
        ),
    };
  });
}

export type CustomFieldColumnDefinition = {
  key: string;
  name: string;
  format: MaterializedField["format"];
  options: MaterializedField["options"];
};

/**
 * Load the definitions and values for the selected custom table columns in page-sized
 * batches. Values are returned only for fields applicable to the row's type and currently
 * shown by CF-6; hidden values remain private. Caller must have already applied work-item
 * workspace/project reach and validated requested keys against the live workspace catalogue.
 */
export async function projectCustomFieldColumns(
  identity: ResolvedIdentity,
  userId: string,
  apiKey: AuthenticatedApiKey | undefined,
  workspaceId: string,
  rows: readonly CustomFieldProjectionRow[],
  columns: readonly string[] | undefined,
): Promise<
  | {
      columns: CustomFieldColumnDefinition[];
      valuesByItem: Map<string, Record<string, unknown>>;
      people?: Array<{
        projectId: string;
        personId: string;
        name: string | null;
      }>;
    }
  | undefined
> {
  const selectedKeys = customFieldColumnKeys(columns);
  if (selectedKeys.size === 0) return undefined;

  const fields = await listFields(workspaceId);
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const selectedFields: MaterializedField[] = [];
  for (const key of selectedKeys) {
    const field = fieldsByKey.get(key);
    if (!field) {
      throw new HTTPException(422, {
        message: "Column field unavailable",
      });
    }
    selectedFields.push(field);
  }

  const values = await loadValueMaps(
    db,
    rows.map((row) => row.id),
    fields.map((field) => field.id),
  );
  const valuesByItem = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const currentValues =
      values.get(row.id) ?? (Object.create(null) as Record<string, unknown>);
    const visibility = new Map<string, TypeVisibility>();
    for (const field of fields) {
      const typeVisibility = field.visibility.find(
        (entry) => entry.workItemTypeId === row.typeId,
      );
      if (typeVisibility)
        visibility.set(field.id, {
          visible: typeVisibility.visible,
          required: typeVisibility.required,
        });
    }
    const applicable = applicableFields(fields, visibility, currentValues);
    const itemValues = Object.create(null) as Record<string, unknown>;
    for (const field of applicable) {
      if (!selectedKeys.has(field.key) || !field.shown) continue;
      itemValues[field.key] = Object.hasOwn(currentValues, field.key)
        ? currentValues[field.key]
        : null;
    }
    valuesByItem.set(row.id, itemValues);
  }

  const people = await projectCustomFieldPeople({
    identity,
    userId,
    apiKey,
    workspaceId,
    rows,
    selectedFields,
    valuesByItem,
  });

  return {
    columns: selectedFields.map((field) => ({
      key: field.key,
      name: field.name,
      format: field.format,
      options: field.options,
    })),
    valuesByItem,
    ...(people.length > 0 ? { people } : {}),
  };
}

async function projectCustomFieldPeople({
  identity,
  userId,
  apiKey,
  workspaceId,
  rows,
  selectedFields,
  valuesByItem,
}: {
  identity: ResolvedIdentity;
  userId: string;
  apiKey: AuthenticatedApiKey | undefined;
  workspaceId: string;
  rows: readonly CustomFieldProjectionRow[];
  selectedFields: readonly MaterializedField[];
  valuesByItem: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}) {
  const personFields = new Set(
    selectedFields
      .filter(
        (field) => field.format === "user" || field.format === "multi_user",
      )
      .map((field) => field.key),
  );
  if (personFields.size === 0) return [];

  const referencesByProject = new Map<string, Set<string>>();
  for (const row of rows) {
    const values = valuesByItem.get(row.id);
    if (!values) continue;
    for (const key of personFields) {
      if (!Object.hasOwn(values, key)) continue;
      const value = values[key];
      const references =
        typeof value === "string"
          ? [value]
          : Array.isArray(value)
            ? value.filter(
                (personId): personId is string => typeof personId === "string",
              )
            : [];
      if (references.length === 0) continue;
      const projectReferences =
        referencesByProject.get(row.projectId) ?? new Set<string>();
      for (const personId of references) projectReferences.add(personId);
      referencesByProject.set(row.projectId, projectReferences);
    }
  }
  if (referencesByProject.size === 0) return [];

  const ancestorsByProject = await loadAncestorIdsByProject(db, [workspaceId]);
  const ownerTeams = await loadOwnerTeamIdsByProject(db, [workspaceId]);
  const workspaceCanAssign = await workspaceCapability(
    workspaceId,
    userId,
    apiKey,
    "work_item:assign",
  );
  const workspaceCanUpdate = await workspaceCapability(
    workspaceId,
    userId,
    apiKey,
    "work_item:update",
  );
  const allowedReferencesByProject = new Map<string, Set<string>>();
  for (const [projectId, references] of referencesByProject) {
    const ancestorProjectIds = ancestorsByProject.get(projectId) ?? [];
    const facts = {
      projectId,
      workspaceId,
      ancestorProjectIds,
      ownerTeamId: ownerTeams.get(projectId) ?? null,
      organisationId: null,
    };
    if (
      workspaceCanAssign &&
      hasProjectReadCapability(identity, "work_item:assign", "work_item", facts)
    ) {
      allowedReferencesByProject.set(projectId, references);
    } else if (
      workspaceCanUpdate &&
      identity.personId &&
      hasProjectReadCapability(
        identity,
        "work_item:update",
        "work_item",
        facts,
      ) &&
      references.has(identity.personId)
    ) {
      allowedReferencesByProject.set(projectId, new Set([identity.personId]));
    }
  }
  if (allowedReferencesByProject.size === 0) return [];

  const rosterProjectIds = [
    ...new Set(
      [...allowedReferencesByProject].flatMap(([projectId]) => [
        projectId,
        ...(ancestorsByProject.get(projectId) ?? []),
      ]),
    ),
  ];
  const personIds = [
    ...new Set(
      [...allowedReferencesByProject.values()].flatMap((references) => [
        ...references,
      ]),
    ),
  ];
  const rosterRows = await db
    .select({
      scopeId: schema.membershipTable.scopeId,
      personId: schema.personTable.id,
      name: schema.userTable.name,
    })
    .from(schema.membershipTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.membershipTable.personId),
    )
    .leftJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(
      and(
        eq(schema.membershipTable.scope, "project"),
        inArray(schema.membershipTable.scopeId, rosterProjectIds),
        inArray(schema.personTable.id, personIds),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
        eq(schema.personTable.isPlaceholder, false),
      ),
    );
  const rostersByPerson = new Map<string, Map<string, string | null>>();
  for (const entry of rosterRows) {
    const scopes = rostersByPerson.get(entry.personId) ?? new Map();
    scopes.set(entry.scopeId, entry.name ?? null);
    rostersByPerson.set(entry.personId, scopes);
  }

  const result: { projectId: string; personId: string; name: string | null }[] =
    [];
  for (const [projectId, references] of allowedReferencesByProject) {
    const rosterIds = new Set([
      projectId,
      ...(ancestorsByProject.get(projectId) ?? []),
    ]);
    for (const personId of references) {
      const scopes = rostersByPerson.get(personId);
      const name = [...rosterIds]
        .map((scopeId) => scopes?.get(scopeId))
        .find((value) => value !== undefined);
      if (name !== undefined) result.push({ projectId, personId, name });
    }
  }
  return result;
}

async function workspaceCapability(
  workspaceId: string,
  userId: string,
  apiKey: AuthenticatedApiKey | undefined,
  capability: "work_item:assign" | "work_item:update",
) {
  try {
    await assertCallerHasCapability(
      workspaceId,
      userId,
      capability,
      capabilityCredential(apiKey),
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}
