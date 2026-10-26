import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type RequestTypeGroupOrder = {
  groups: string[];
  version: number;
};

type GroupOrderResponse = { groupOrder: RequestTypeGroupOrder };

function isGroupOrderResponse(value: unknown): value is GroupOrderResponse {
  if (!value || typeof value !== "object" || !("groupOrder" in value))
    return false;
  const order = value.groupOrder;
  return (
    !!order &&
    typeof order === "object" &&
    "groups" in order &&
    Array.isArray(order.groups) &&
    order.groups.every((group) => typeof group === "string") &&
    "version" in order &&
    typeof order.version === "number" &&
    Number.isInteger(order.version) &&
    order.version > 0
  );
}

async function readGroupOrderResponse(response: Response) {
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(
        response,
        "Unable to load request type group order",
      ),
    );
  const body: unknown = await response.json();
  if (!isGroupOrderResponse(body))
    throw new HttpError(502, "Unexpected request type group order response");
  return body.groupOrder;
}

export async function getRequestTypeGroupOrder(
  workspaceId: string,
): Promise<RequestTypeGroupOrder> {
  const url = new URL(
    getApiUrl("request-type-groups/order"),
    window.location.origin,
  );
  url.searchParams.set("workspaceId", workspaceId);
  return readGroupOrderResponse(
    await apiFetch(url.toString(), {
      credentials: "include",
      cache: "no-store",
    }),
  );
}

export async function replaceRequestTypeGroupOrder(input: {
  workspaceId: string;
  groups: string[];
  version: number;
}): Promise<RequestTypeGroupOrder> {
  const url = new URL(
    getApiUrl("request-type-groups/order"),
    window.location.origin,
  );
  url.searchParams.set("workspaceId", input.workspaceId);
  return readGroupOrderResponse(
    await apiFetch(url.toString(), {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groups: input.groups, version: input.version }),
    }),
  );
}
