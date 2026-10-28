import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import type {
  CustomFieldFormat,
  CustomFieldOption,
  VisibilityCondition,
} from "@/lib/custom-field";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type CustomFieldVisibilityRow = {
  workItemTypeId: string;
  visible: boolean;
  required: boolean;
};

export type CustomField = {
  id: string;
  workspaceId: string;
  sectionId: string;
  key: string;
  name: string;
  format: CustomFieldFormat;
  options: CustomFieldOption[];
  defaultValue: unknown;
  helpText: string | null;
  customerVisible: boolean;
  visibilityCondition: VisibilityCondition | null;
  position: number;
  deletedAt: string | null;
  updatedAt: string;
  visibility: CustomFieldVisibilityRow[];
  usageCount: number;
};

export type CustomFieldSection = {
  id: string;
  workspaceId: string;
  name: string;
  position: number;
};

export type CustomFieldList = {
  data: CustomField[];
  meta: { total: number; manyFieldsWarning: boolean };
};

export type CustomFieldInput = {
  sectionId: string;
  key: string;
  name: string;
  format: CustomFieldFormat;
  options: CustomFieldOption[];
  defaultValue?: unknown;
  helpText?: string | null;
  customerVisible: boolean;
  visibilityCondition: VisibilityCondition | null;
  visibility: CustomFieldVisibilityRow[];
};

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  fallback = "The request failed",
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, fallback),
    );
  return response.json() as Promise<T>;
}

export function getCustomFields(
  workspaceId: string,
  includeDeleted = false,
): Promise<CustomFieldList> {
  const query = new URLSearchParams({ workspaceId });
  if (includeDeleted) query.set("includeDeleted", "true");
  return request(`/custom-fields?${query}`, {}, "Failed to load custom fields");
}

export async function getCustomFieldSections(
  workspaceId: string,
): Promise<CustomFieldSection[]> {
  const query = new URLSearchParams({ workspaceId });
  const result = await request<{ data: CustomFieldSection[] }>(
    `/custom-field-sections?${query}`,
    {},
    "Failed to load sections",
  );
  return result.data;
}

export function createCustomField(
  workspaceId: string,
  input: CustomFieldInput,
): Promise<CustomField> {
  return request(
    "/custom-fields",
    { method: "POST", body: { workspaceId, ...input } },
    "Failed to create the field",
  );
}

export type CustomFieldUpdate = Partial<
  Omit<CustomFieldInput, "key" | "visibility">
>;

export async function updateCustomField(
  id: string,
  update: CustomFieldUpdate,
  visibility?: CustomFieldVisibilityRow[],
): Promise<CustomField> {
  let field = await request<CustomField>(
    `/custom-fields/${encodeURIComponent(id)}`,
    { method: "PATCH", body: update },
    "Failed to save the field",
  );
  if (visibility)
    field = await request<CustomField>(
      `/custom-fields/${encodeURIComponent(id)}/visibility`,
      { method: "PUT", body: { visibility } },
      "Failed to save the visibility grid",
    );
  return field;
}

/** CF-8: requests deletion; the field stays until the requester approves it. */
export async function requestCustomFieldDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/custom-fields/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the field deletion",
  );
}

export function restoreCustomField(id: string): Promise<CustomField> {
  return request(
    `/custom-fields/${encodeURIComponent(id)}/restore`,
    { method: "POST" },
    "Failed to restore the field",
  );
}

export function reorderCustomFields(
  workspaceId: string,
  sections: { sectionId: string; fieldIds: string[] }[],
) {
  return request(
    "/custom-fields/reorder",
    { method: "POST", body: { workspaceId, sections } },
    "Failed to reorder fields",
  );
}

export function createCustomFieldSection(workspaceId: string, name: string) {
  return request<CustomFieldSection>(
    "/custom-field-sections",
    { method: "POST", body: { workspaceId, name } },
    "Failed to create the section",
  );
}

export function renameCustomFieldSection(id: string, name: string) {
  return request<CustomFieldSection>(
    `/custom-field-sections/${encodeURIComponent(id)}`,
    { method: "PATCH", body: { name } },
    "Failed to rename the section",
  );
}

export function deleteCustomFieldSection(id: string) {
  return request(
    `/custom-field-sections/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Failed to delete the section",
  );
}

export function reorderCustomFieldSections(
  workspaceId: string,
  sectionIds: string[],
) {
  return request(
    "/custom-field-sections/reorder",
    { method: "POST", body: { workspaceId, sectionIds } },
    "Failed to reorder sections",
  );
}
