import { useMutation } from "@tanstack/react-query";
import createProject, {
  type CreateProjectRequest,
} from "@/fetchers/project/create-project";

function useCreateProject({
  name,
  slug,
  workspaceId,
  icon,
  organisationId,
  kind,
  supportLevel,
  serviceCalendarId,
}: {
  name: string;
  slug: string;
  workspaceId: string;
  icon: string;
  organisationId?: string | null;
  kind?: CreateProjectRequest["kind"];
  supportLevel?: CreateProjectRequest["supportLevel"];
  serviceCalendarId?: string | null;
}) {
  return useMutation({
    mutationFn: () =>
      createProject({
        name,
        slug,
        workspaceId,
        icon,
        organisationId,
        kind,
        supportLevel,
        serviceCalendarId,
      }),
  });
}

export default useCreateProject;
