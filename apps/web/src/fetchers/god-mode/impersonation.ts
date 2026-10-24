import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const impersonate = client.instance.impersonate;

export type ImpersonationStatus = InferResponseType<
  typeof impersonate.$get,
  200
>;

export async function getImpersonationStatus(): Promise<ImpersonationStatus> {
  const response = await impersonate.$get();
  if (!response.ok) {
    throw new HttpError(response.status, "Unable to read impersonation status");
  }
  return (await response.json()) as ImpersonationStatus;
}

/** GM-11: always allowed; restores the administrator's own session cookie. */
export async function endImpersonation() {
  const response = await impersonate.$delete();
  if (!response.ok) {
    throw new HttpError(response.status, "Unable to end impersonation");
  }
  return response.json();
}
