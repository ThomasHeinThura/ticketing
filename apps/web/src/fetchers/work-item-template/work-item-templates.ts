import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type WorkItemTemplateInput = {
  name: string;
  typeId: string;
  title: string;
  description?: unknown;
  labelIds: string[];
  checklistTemplateId: string | null;
};

export type ChecklistTemplateInput = { name: string; items: string[] };

async function checked<T extends Response>(response: T): Promise<T> {
  if (!response.ok)
    throw new HttpError(response.status, await readErrorDetail(response));
  return response;
}

/** Live templates a create dialog offers (`WI-5`): `workspace:read` is enough to list them. */
export async function listWorkItemTemplateOptions(workspaceId: string) {
  return (
    await checked(
      await client.workspace[":workspaceId"]["work-item-templates"].$get({
        param: { workspaceId },
      }),
    )
  ).json();
}

export async function listWorkItemTemplatesForManagement(workspaceId: string) {
  return (
    await checked(
      await client.workspace[":workspaceId"]["work-item-templates"].manage.$get(
        { param: { workspaceId }, query: {} },
      ),
    )
  ).json();
}

export async function saveWorkItemTemplate(
  workspaceId: string,
  input: WorkItemTemplateInput,
  id?: string,
) {
  const route = client.workspace[":workspaceId"]["work-item-templates"];
  const response = id
    ? await route[":id"].$patch({
        param: { workspaceId, id },
        json: input,
      })
    : await route.$post({ param: { workspaceId }, json: input });
  return (await checked(response)).json();
}

export async function archiveWorkItemTemplate(workspaceId: string, id: string) {
  return (
    await checked(
      await client.workspace[":workspaceId"]["work-item-templates"][":id"][
        "archive"
      ].$post({ param: { workspaceId, id } }),
    )
  ).json();
}

export async function listChecklistTemplates(workspaceId: string) {
  return (
    await checked(
      await client.workspace[":workspaceId"]["checklist-templates"].$get({
        param: { workspaceId },
        query: {},
      }),
    )
  ).json();
}

export async function saveChecklistTemplate(
  workspaceId: string,
  input: ChecklistTemplateInput,
  id?: string,
) {
  const route = client.workspace[":workspaceId"]["checklist-templates"];
  const response = id
    ? await route[":id"].$patch({ param: { workspaceId, id }, json: input })
    : await route.$post({ param: { workspaceId }, json: input });
  return (await checked(response)).json();
}

export async function archiveChecklistTemplate(
  workspaceId: string,
  id: string,
) {
  return (
    await checked(
      await client.workspace[":workspaceId"]["checklist-templates"][":id"][
        "archive"
      ].$post({ param: { workspaceId, id } }),
    )
  ).json();
}
