import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Executor } from "../database/executor";
import { loadProjectAncestorIdsFor } from "../project/hierarchy.repository";

/**
 * The ancestor chain (nearest first) that reach step 4 and inherited project authority
 * (`PR-2`/`PR-3`) are decided from, for call sites that have an executor but no request
 * context. Memoised per executor (so per transaction), skipped when the identity holds no
 * project-scope row that could be inherited. Every `reaches()` / `can()` on a project or
 * work-item target must pass this as `ancestorProjectIds`; omitting it silently falls back to
 * the caller's workspace role.
 */
export function projectAncestryFor(
  executor: object,
  identity: Pick<ResolvedIdentity, "memberships" | "authority" | "side">,
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  return loadProjectAncestorIdsFor(
    executor,
    executor as Executor,
    identity,
    workspaceId,
    projectId,
  );
}
