import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type CannedResponseInput = {
  name: string;
  body: unknown;
  visibilityDefault: "public" | "internal";
};
async function checked<T extends Response>(response: T): Promise<T> {
  if (!response.ok)
    throw new HttpError(response.status, await readErrorDetail(response));
  return response;
}
export async function getCannedResponseLibrary(workspaceId: string) {
  return (
    await checked(
      await client["canned-responses"].manage.$get({ query: { workspaceId } }),
    )
  ).json();
}
export async function saveCannedResponse(
  workspaceId: string,
  input: CannedResponseInput,
  id?: string,
) {
  const response = id
    ? await client["canned-responses"][":id"].$patch({
        param: { id },
        json: input,
      })
    : await client["canned-responses"].$post({
        json: { workspaceId, ...input },
      });
  return (await checked(response)).json();
}
export async function removeCannedResponse(id: string) {
  return (
    await checked(
      await client["canned-responses"][":id"].$delete({ param: { id } }),
    )
  ).json();
}
