import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/** `GET /api/projects/{projectId}/members` (PR-2): direct roster rows plus rows inherited from
 * ancestor projects, and the roles a row can be given. */
export async function getProjectMembers(projectId: string) {
  const response = await client.projects[":projectId"].members.$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to load the project roster"),
    );
  }
  return response.json();
}

/** `GET /api/projects/{projectId}/members/candidates`: workspace people who can be added. */
export async function getProjectMemberCandidates(projectId: string) {
  const response = await client.projects[":projectId"].members.candidates.$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to load people to add"),
    );
  }
  return response.json();
}

/** `POST /api/projects/{projectId}/members`: add a person with a project role. */
export async function addProjectMember({
  projectId,
  personId,
  roleKey,
}: {
  projectId: string;
  personId: string;
  roleKey: string;
}) {
  const response = await client.projects[":projectId"].members.$post({
    param: { projectId },
    json: { personId, roleKey },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to add the member"),
    );
  }
  return response.json();
}

/** `PATCH /api/projects/{projectId}/members/{personId}` (PR-3): change a role; on an inherited
 * member this writes the explicit child row that overrides it. */
export async function updateProjectMemberRole({
  projectId,
  personId,
  roleKey,
}: {
  projectId: string;
  personId: string;
  roleKey: string;
}) {
  const response = await client.projects[":projectId"].members[
    ":personId"
  ].$patch({
    param: { projectId, personId },
    json: { roleKey },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to change the role"),
    );
  }
  return response.json();
}

/** `DELETE /api/projects/{projectId}/members/{personId}` (PR-4): direct rows only. */
export async function removeProjectMember({
  projectId,
  personId,
}: {
  projectId: string;
  personId: string;
}) {
  const response = await client.projects[":projectId"].members[
    ":personId"
  ].$delete({
    param: { projectId, personId },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to remove the member"),
    );
  }
  return response.json();
}

/** `GET /api/projects/{projectId}/ownership/preview`: who gains and loses access if the
 * project moves under `parentId` (null = top level). */
export async function getReparentPreview({
  projectId,
  parentId,
}: {
  projectId: string;
  parentId: string | null;
}) {
  const response = await client.projects[":projectId"].ownership.preview.$get({
    param: { projectId },
    query: parentId ? { parentId } : {},
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to preview the move"),
    );
  }
  return response.json();
}
