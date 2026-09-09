import type { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import type { authClient } from "@/lib/auth-client";

// S3 (issue #6, retrofit plan §3, matrix row 28): native replacement for the
// `Awaited<ReturnType<typeof authClient.organization.getFullOrganization>>`
// alias this file used to carry, derived from the real TaskDesk response
// shape in apps/api/src/workspace/response.ts -- not guessed from the
// plugin's shape.
//
// GET /api/workspace -- one of the caller's workspaces, with the caller's
// own role. Every real consumer of the old default export
// (workspace-switcher.tsx, dashboard/index.tsx, settings/workspace.tsx) was
// already using it as a LIST-ITEM shape, even though it was typed against
// getFullOrganization()'s compound shape -- this redefinition also corrects
// that pre-existing mismatch rather than carrying it forward.
export type Workspace = InferResponseType<
  (typeof client)["workspace"]["$get"],
  200
>[number];

// GET /api/workspace/{workspaceId} -- workspace + members + pending
// invitations in one call. Native replacement for
// authClient.organization.getFullOrganization()
// (apps/web/src/hooks/queries/workspace/use-get-full-workspace.ts).
export type WorkspaceDetail = InferResponseType<
  (typeof client)["workspace"][":workspaceId"]["$get"],
  200
>;

// Not redefined by S3 (retrofit plan §3, S3 row names only line 5 of this
// file): zero importers of this type anywhere in apps/web/src today, and
// `authClient.useActiveOrganization` is still a valid property on the client
// SDK until S10 unmounts organizationClient() -- so this keeps compiling
// even though apps/web/src/hooks/queries/workspace/use-active-workspace.ts
// no longer calls the hook it names.
export type ActiveWorkspace = NonNullable<
  ReturnType<typeof authClient.useActiveOrganization>["data"]
>;

export default Workspace;
