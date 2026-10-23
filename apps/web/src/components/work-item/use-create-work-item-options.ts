import { useQuery } from "@tanstack/react-query";
import { getProjectLabels } from "@/fetchers/label/project-labels";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";

export type CreateWorkItemLabel = {
  id: string;
  name: string;
  color: string;
  workspaceId: string | null;
  taskId: string | null;
  projectId?: string | null;
};
export function creationLabelCatalogue(
  workspaceId: string | undefined,
  projectId: string,
  global: CreateWorkItemLabel[],
  project: CreateWorkItemLabel[],
) {
  return [
    ...new Map(
      [
        ...global.filter(
          (label) =>
            label.workspaceId === workspaceId &&
            label.taskId === null &&
            (label.projectId == null || label.projectId === projectId),
        ),
        ...project.filter(
          (label) =>
            label.workspaceId === workspaceId &&
            label.taskId === null &&
            label.projectId === projectId,
        ),
      ].map((label) => [label.id, label]),
    ).values(),
  ];
}
export function useCreateWorkItemOptions({
  workspaceId,
  projectId,
  canUpdate,
  canAssign,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canUpdate: boolean;
  canAssign: boolean;
}) {
  const states = useGetProjectStates(projectId);
  const people = useGetAssignablePeople({
    projectId,
    enabled: canUpdate || canAssign,
  });
  const globalLabels = useGetLabelsByWorkspace(workspaceId ?? "", canUpdate);
  const projectLabels = useQuery({
    queryKey: ["project-labels", projectId],
    queryFn: () => getProjectLabels(projectId),
    enabled: canUpdate && Boolean(projectId),
  });
  return {
    states: states.data ?? [],
    statesLoading: states.isLoading,
    statesError: states.isError,
    people: people.data ?? [],
    peopleLoading: people.isLoading,
    peopleError: people.isError,
    labels: creationLabelCatalogue(
      workspaceId,
      projectId,
      globalLabels.data ?? [],
      projectLabels.data ?? [],
    ),
    labelsLoading: globalLabels.isLoading || projectLabels.isLoading,
    labelsError: globalLabels.isError || projectLabels.isError,
  };
}
export type CreateWorkItemOptions = ReturnType<typeof useCreateWorkItemOptions>;
