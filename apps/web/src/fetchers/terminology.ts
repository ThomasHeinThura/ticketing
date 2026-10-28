import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "./get-api-url";

export const TERMINOLOGY_TERM_KEYS = [
  "work_item",
  "project",
  "cycle",
  "module",
  "epic",
  "request",
  "submission",
  "service",
  "change",
] as const;
export type TerminologyTermKey = (typeof TERMINOLOGY_TERM_KEYS)[number];
export type TerminologyAudience = "agent" | "customer" | "both";
export type TerminologyForms = Record<string, string>;
export type TerminologyOverride = {
  scope: "instance" | "workspace";
  workspaceId: string | null;
  audience: TerminologyAudience;
  termKey: TerminologyTermKey;
  locale: string;
  forms: TerminologyForms;
};
export type TerminologyResponse = {
  overrides: TerminologyOverride[];
  etag: string;
};
export type TerminologyTarget =
  | { scope: "instance" }
  | { scope: "workspace"; workspaceId: string };

function path(target: TerminologyTarget) {
  return target.scope === "instance"
    ? "instance/terminology"
    : `workspaces/${encodeURIComponent(target.workspaceId)}/terminology`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(getApiUrl(url), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 409)
    throw new HttpError(409, "Terminology changed; reload before saving");
  if (!response.ok)
    throw new HttpError(response.status, "Terminology request failed");
  return (await response.json()) as T;
}

export function getTerminology(target: TerminologyTarget) {
  return request<TerminologyResponse>(path(target));
}

export function saveTerminology(
  target: TerminologyTarget,
  input: {
    expectedEtag: string;
    override: {
      audience: TerminologyAudience;
      termKey: TerminologyTermKey;
      locale: string;
      forms: TerminologyForms | null;
    };
  },
) {
  return request<TerminologyResponse>(path(target), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export type TerminologyPreview = {
  termKey: TerminologyTermKey;
  locale: string;
  audience: "agent" | "customer";
  examples: Array<{ category: string; count: number; label: string }>;
};

export function previewTerminology(input: {
  termKey: TerminologyTermKey;
  locale: string;
  audience: "agent" | "customer";
  forms: TerminologyForms;
}) {
  return request<TerminologyPreview>("instance/terminology/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type PublicTerminology = {
  locale: string;
  audience: "agent" | "customer";
  terms: Partial<Record<TerminologyTermKey, TerminologyForms>>;
  etag: string;
};

export function getPublicTerminology(locale: string) {
  return request<PublicTerminology>(
    `public/terminology?locale=${encodeURIComponent(locale)}`,
  );
}

export function getWorkspaceRuntimeTerminology(
  workspaceId: string,
  locale: string,
) {
  return request<PublicTerminology>(
    `workspaces/${encodeURIComponent(workspaceId)}/terminology/runtime?locale=${encodeURIComponent(locale)}`,
  );
}

export function getPortalTerminology(
  locale: string,
  selector?:
    | { requestTypeKey: string }
    | { submissionRef: string }
    | { workItemKey: string },
) {
  const query = new URLSearchParams({ locale, ...selector });
  return request<PublicTerminology>(`portal/terminology?${query.toString()}`);
}
