import { useQuery } from "@tanstack/react-query";
import { listWorkItemTemplateOptions } from "@/fetchers/work-item-template/work-item-templates";

/** Live work-item templates for the create dialog's picker (`WI-5`). */
function useWorkItemTemplateOptions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["work-item-templates", "options", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => listWorkItemTemplateOptions(workspaceId as string),
    retry: false,
  });
}

export default useWorkItemTemplateOptions;
