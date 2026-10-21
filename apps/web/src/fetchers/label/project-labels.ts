import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";

async function checked<T extends Response>(response: T): Promise<T> {
  if (!response.ok)
    throw new HttpError(response.status, await readErrorDetail(response));
  return response;
}
export async function getProjectLabels(projectId: string) {
  return (
    await checked(
      await client.label.project[":projectId"].catalogue.$get({
        param: { projectId },
      }),
    )
  ).json();
}
export async function createProjectLabel(
  projectId: string,
  values: { name: string; color: string },
) {
  return (
    await checked(
      await client.label.project[":projectId"].catalogue.$post({
        param: { projectId },
        json: values,
      }),
    )
  ).json();
}
export async function updateProjectLabel(
  projectId: string,
  id: string,
  values: { name: string; color: string },
) {
  return (
    await checked(
      await client.label.project[":projectId"].catalogue[":id"].$patch({
        param: { projectId, id },
        json: values,
      }),
    )
  ).json();
}
export async function deleteProjectLabel(projectId: string, id: string) {
  return (
    await checked(
      await client.label.project[":projectId"].catalogue[":id"].$delete({
        param: { projectId, id },
      }),
    )
  ).json();
}
