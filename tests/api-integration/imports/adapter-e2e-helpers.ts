import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import type { StateGroup } from "../../../apps/api/src/imports/engine/adapter";
import { ensureCreationWorkflow } from "../helpers/workflow";
import { type App, call, type engineFixture, post } from "./engine-helpers";

export type Fixture = Awaited<ReturnType<typeof engineFixture>>;

/** One destination work item type per source type, each with a creation workflow. */
export async function makeTypes(f: Fixture, names: readonly string[]) {
  const ids = new Map<string, string>();
  for (const name of names) {
    const [type] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: f.workspace.id,
        key: `${name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}-${randomUUID().slice(0, 8)}`,
        name,
        category: "delivery",
      })
      .returning();
    if (!type) throw new Error("type insert failed");
    await ensureCreationWorkflow({
      workspaceId: f.workspace.id,
      projectId: f.project.id,
      typeId: type.id,
    });
    ids.set(name, type.id);
  }
  return ids;
}

export async function startSourceRun(
  app: App,
  f: Fixture,
  input: {
    pluginId: "import.azure-devops" | "import.plane";
    config: Record<string, unknown>;
    credential: string;
    sourceRef: string;
  },
) {
  const source = await call(
    app,
    f.key,
    "/api/import-sources",
    post({
      workspaceId: f.workspace.id,
      pluginId: input.pluginId,
      name: `${input.sourceRef}-${randomUUID()}`,
      config: input.config,
      credential: input.credential,
    }),
    200,
  );
  const run = await call(
    app,
    f.key,
    `/api/import-sources/${source.id}/runs`,
    post({ projectId: f.project.id, sourceRef: input.sourceRef }),
    200,
  );
  const mapping = await call(
    app,
    f.key,
    `/api/imports/${run.id}/discover`,
    post(),
    200,
  );
  return { source, run, mapping };
}

type Entry = { domain: string; value: string; status: string };

/**
 * The operator's review: source types to destination types, an explicit group for each state the
 * adapter could not propose, everything without a destination id ignored, and every remaining
 * proposal confirmed in one deliberate click.
 */
export async function decideMapping(
  app: App,
  f: Fixture,
  runId: string,
  // biome-ignore lint/suspicious/noExplicitAny: loose JSON body from the mapping route
  mapping: Record<string, any>,
  decisions: {
    types: ReadonlyMap<string, string>;
    states?: Record<string, StateGroup>;
  },
) {
  const edits: Array<{ domain: string; value: string; target: unknown }> = [];
  for (const entry of mapping.entries as Entry[]) {
    if (entry.status === "confirmed") continue;
    if (entry.domain === "type") {
      const id = decisions.types.get(entry.value);
      if (!id) throw new Error(`no destination type for ${entry.value}`);
      edits.push({
        domain: "type",
        value: entry.value,
        target: { kind: "target", id },
      });
    } else if (entry.domain === "state") {
      const group = decisions.states?.[entry.value];
      if (group)
        edits.push({
          domain: "state",
          value: entry.value,
          target: { kind: "group", group },
        });
    } else if (
      ["module", "cycle", "label", "custom_field", "project"].includes(
        entry.domain,
      )
    )
      edits.push({
        domain: entry.domain,
        value: entry.value,
        target: { kind: "ignore" },
      });
  }
  return call(
    app,
    f.key,
    `/api/imports/${runId}/mapping`,
    post({
      expectedMappingVersion: mapping.mappingVersion,
      entries: edits,
      confirmProposals: true,
    }),
    200,
  );
}

/** Created work items for one source ref, with their destination type id and parent. */
export async function importedItems(f: Fixture, sourceRef: string) {
  const links = await db
    .select()
    .from(schema.importRecordLinkTable)
    .where(
      and(
        eq(schema.importRecordLinkTable.workspaceId, f.workspace.id),
        eq(schema.importRecordLinkTable.sourceRef, sourceRef),
      ),
    );
  if (links.length === 0) return { links, items: [] };
  const items = await db
    .select()
    .from(schema.workItemTable)
    .where(
      inArray(
        schema.workItemTable.id,
        links.map((l) => l.targetId),
      ),
    );
  return { links, items };
}

export function tally<T>(rows: readonly T[], key: (row: T) => string) {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
}
