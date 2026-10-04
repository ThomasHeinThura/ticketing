import { useMutation } from "@tanstack/react-query";
import createProject from "@/fetchers/project/create-project";

function useCreateProject({
  name,
  slug,
  workspaceId,
  icon,
  organisationId,
}: {
  name: string;
  slug: string;
  workspaceId: string;
  icon: string;
  organisationId: string | null;
}) {
  return useMutation({
    mutationFn: () =>
      createProject({ name, slug, workspaceId, icon, organisationId }),
  });
}

export default useCreateProject;
