import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";
import { authClient } from "@/lib/auth-client";
import { HttpError } from "@/lib/http-error";

type ProjectBody = InferRequestType<
  (typeof client)["project"][":id"]["$put"]
>["json"];
export type UpdateProjectRequest = { id: string } & Partial<ProjectBody>;

const writeTails = new Map<string, Promise<void>>();

export function updateProjectForSession(
  request: UpdateProjectRequest,
  sessionId: string,
) {
  const previous = writeTails.get(request.id) ?? Promise.resolve();
  const result = previous.then(async () => {
    const currentSession = async () => {
      const { data, error } = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (error || !data?.session?.id || data.session.id !== sessionId)
        throw new Error("Project save cancelled: session changed");
    };
    // The save carries only the fields the caller changed and the API applies only those, so
    // nothing is read first or filled in from a stale copy: another tab's confirmed change to
    // a field this save does not send can no longer be reverted by it. The session is checked
    // immediately before the write.
    await currentSession();
    return updateProject(request);
  });
  const tail = result.then(
    () => {},
    () => {},
  );
  writeTails.set(request.id, tail);
  void tail.then(() => {
    if (writeTails.get(request.id) === tail) writeTails.delete(request.id);
  });
  return result;
}

async function updateProject({
  id,
  name,
  icon,
  slug,
  description,
  kind,
  supportLevel,
  serviceCalendarId,
  defaultCommentVisibility,
  managerId,
  startDate,
  endDate,
  defaultAssigneeId,
}: UpdateProjectRequest) {
  const response = await client.project[":id"].$put({
    param: { id },
    // The field is sent only when the caller sets it: the server asks for the strict
    // project:manage_settings capability whenever it is present, so omitting it keeps a
    // plain rename working for callers who lack that capability.
    json: {
      // The four base fields follow the same rule as every other one: sent only when set.
      ...(name !== undefined ? { name } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(description !== undefined ? { description } : {}),
      // Engagement fields (PR-9) follow the same rule: the server reads an omitted
      // field as "unchanged" and an explicit null as "clear".
      ...(kind !== undefined ? { kind } : {}),
      ...(supportLevel !== undefined ? { supportLevel } : {}),
      ...(serviceCalendarId !== undefined ? { serviceCalendarId } : {}),
      ...(defaultCommentVisibility !== undefined
        ? { defaultCommentVisibility }
        : {}),
      // Planning fields (PR-6, PR-10, AS-11): same rule, omitted means "unchanged" and an
      // explicit null clears. Each needs project:manage_settings server-side.
      ...(managerId !== undefined ? { managerId } : {}),
      ...(startDate !== undefined ? { startDate } : {}),
      ...(endDate !== undefined ? { endDate } : {}),
      ...(defaultAssigneeId !== undefined ? { defaultAssigneeId } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new HttpError(response.status, error);
  }

  const data = await response.json();

  return data;
}
