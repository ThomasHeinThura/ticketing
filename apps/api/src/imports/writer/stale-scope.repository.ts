import { inArray, type SQL, sql } from "drizzle-orm";
import {
  importRunTable,
  importSourceConnectionTable,
} from "../../database/schema-imports";

const RUN = importRunTable;
const CONNECTION = importSourceConnectionTable;

/**
 * Restricts the end-of-run stale sweep to one slice of a source (adapter `staleScope`): the rows
 * whose last-seen run (`runIdColumn`) belongs to a run of the same `sourceRef` whose source
 * connection config contains every `scope` entry. No scope: no restriction (the whole `sourceRef`).
 * A scope value no connection stores (for example the empty string) matches no run.
 */
export function inSameStaleSlice(
  runIdColumn: Parameters<typeof inArray>[0],
  input: {
    workspaceId: string;
    pluginId: string;
    sourceRef: string;
    scope?: Record<string, string> | null;
  },
): SQL | undefined {
  if (!input.scope || Object.keys(input.scope).length === 0) return undefined;
  return inArray(
    runIdColumn,
    sql`(select ${RUN.id} from ${RUN} inner join ${CONNECTION} on ${CONNECTION.id} = ${RUN.sourceConnectionId} where ${RUN.workspaceId} = ${input.workspaceId} and ${RUN.pluginId} = ${input.pluginId} and ${RUN.sourceRef} = ${input.sourceRef} and ${CONNECTION.config} @> ${JSON.stringify(input.scope)}::jsonb)`,
  );
}
