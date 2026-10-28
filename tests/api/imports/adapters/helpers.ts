import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AdapterConnection,
  ImportSourceAdapter,
  ProposalContext,
  SourceRecord,
} from "../../../../apps/api/src/imports/engine/adapter";

export const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "../../../fixtures/imports", name), "utf8");

export const connection = (
  pluginId: AdapterConnection["pluginId"],
  config: Record<string, unknown>,
): AdapterConnection => ({
  pluginId,
  config,
  credential: null,
  readOnly: true,
});

export const context: ProposalContext = {
  workspaceId: "w",
  projectId: "p",
  peopleByEmail: new Map([["ana.lopez@example.test", "person-ana"]]),
  typeIdsByKey: new Map([["task", "type-task"]]),
};

export async function readAll(
  adapter: ImportSourceAdapter,
  conn: AdapterConnection,
  pageSize = 500,
) {
  const records: SourceRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await adapter.readPage(conn, cursor, pageSize);
    records.push(...page.records);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return records;
}
