import { useQuery } from "@tanstack/react-query";
import {
  getCustomFieldSections,
  getCustomFields,
} from "@/fetchers/custom-field";

export const customFieldsKey = (workspaceId: string, includeDeleted = false) =>
  ["custom-fields", workspaceId, includeDeleted] as const;
export const customFieldSectionsKey = (workspaceId: string) =>
  ["custom-field-sections", workspaceId] as const;

export function useCustomFields(workspaceId: string, includeDeleted = false) {
  return useQuery({
    queryKey: customFieldsKey(workspaceId, includeDeleted),
    queryFn: () => getCustomFields(workspaceId, includeDeleted),
    enabled: Boolean(workspaceId),
  });
}

export function useCustomFieldSections(workspaceId: string) {
  return useQuery({
    queryKey: customFieldSectionsKey(workspaceId),
    queryFn: () => getCustomFieldSections(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
