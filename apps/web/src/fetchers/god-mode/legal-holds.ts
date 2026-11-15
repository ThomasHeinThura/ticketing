import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type LegalHoldScope = "organisation" | "person";
export type LegalHoldStatusFilter = "active" | "lifted" | "all";

export type LegalHoldActor = {
  id: string;
  name: string | null;
  email: string | null;
};

export type LegalHoldItem = {
  id: string;
  scope: LegalHoldScope;
  scopeId: string;
  status: "active" | "lifted";
  targetLabel: string;
  targetSecondaryLabel: string | null;
  reason: string;
  placedAt: string;
  placedBy: LegalHoldActor;
  liftedAt: string | null;
  liftedBy: LegalHoldActor | null;
};

export type LegalHoldListResponse = {
  checkedAt: string;
  activeCount: number;
  holds: LegalHoldItem[];
};

export type LegalHoldListQuery = {
  status?: LegalHoldStatusFilter;
  scope?: LegalHoldScope;
  scopeId?: string;
};

export async function getLegalHolds(
  query: LegalHoldListQuery = {},
): Promise<LegalHoldListResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.scope) params.set("scope", query.scope);
  if (query.scopeId) params.set("scopeId", query.scopeId);
  const queryString = params.toString();
  const path = queryString
    ? `instance/legal-holds?${queryString}`
    : "instance/legal-holds";

  const response = await apiFetch(getApiUrl(path), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Legal holds request failed"),
    );
  }
  return (await response.json()) as LegalHoldListResponse;
}

export async function placeLegalHold(input: {
  scope: LegalHoldScope;
  scopeId: string;
  reason: string;
}): Promise<LegalHoldItem> {
  const response = await apiFetch(getApiUrl("instance/legal-holds"), {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Unable to place legal hold"),
    );
  }
  return (await response.json()) as LegalHoldItem;
}

export async function liftLegalHold(input: {
  id: string;
  reason?: string;
}): Promise<LegalHoldItem> {
  const payload = input.reason?.trim() ? { reason: input.reason.trim() } : {};
  const response = await apiFetch(
    getApiUrl(`instance/legal-holds/${encodeURIComponent(input.id)}/lift`),
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Unable to lift legal hold"),
    );
  }
  return (await response.json()) as LegalHoldItem;
}
