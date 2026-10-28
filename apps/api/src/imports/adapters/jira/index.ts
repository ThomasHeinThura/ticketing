import { registerImportAdapter } from "../../engine/adapter";
import { createJiraAdapter, type JiraAdapterDeps } from "./adapter";

export type { JiraAdapterDeps } from "./adapter";
export { buildJql, createJiraAdapter, JIRA_CHUNK_SIZE } from "./adapter";
export {
  createGuardedJiraTransport,
  type JiraTransport,
  type JiraTransportRequest,
  type JiraTransportResponse,
} from "./client";
export { normalizeIssue } from "./normalize";

/**
 * Registers `import.jira` and `import.jsm`. Called from `adapters/index.ts` (coordinator-owned).
 * `deps.transport` is for tests; production uses the guarded egress.
 */
export function registerJiraAdapters(deps: JiraAdapterDeps = {}) {
  registerImportAdapter("import.jira", () =>
    createJiraAdapter("import.jira", deps),
  );
  registerImportAdapter("import.jsm", () =>
    createJiraAdapter("import.jsm", deps),
  );
}
