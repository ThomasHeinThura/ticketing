/**
 * Attachment download credentials for an engine run, resolved at download time. The adapter derives
 * them from the run's stored connection (PAT, API key, token); they are never copied into a job, a
 * preview, a loss, a provenance row or a report. Headers are sent only to the source's own host
 * (`ImportAttachmentAuth.hosts`), and the download still runs through the SSRF, size and type guards.
 */
import { eq } from "drizzle-orm";
import db from "../../database";
import type { ImportAttachmentAuth } from "../writer/safe-fetch";
import { getImportAdapter } from "./adapter";
import { CONNECTION, RUN, toAdapterConnection } from "./store";

export async function engineAttachmentAuth(
  runId: string,
): Promise<ImportAttachmentAuth | null> {
  const [run] = await db
    .select({
      workspaceId: RUN.workspaceId,
      pluginId: RUN.pluginId,
      sourceConnectionId: RUN.sourceConnectionId,
    })
    .from(RUN)
    .where(eq(RUN.id, runId))
    .limit(1);
  if (!run?.sourceConnectionId) return null;
  const [connection] = await db
    .select()
    .from(CONNECTION)
    .where(eq(CONNECTION.id, run.sourceConnectionId))
    .limit(1);
  if (!connection || connection.workspaceId !== run.workspaceId) return null;
  const adapter = getImportAdapter(run.pluginId);
  return adapter?.attachmentAuth?.(toAdapterConnection(connection)) ?? null;
}
