import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
} from "@/fetchers/project-member/project-members";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { HistoryTarget } from "@/query-client/settings-history-key";

/** The row's own id when the screen knows it, and the direct row the answered roster shows for the
 * person (a new row on add, or the explicit child row that overrides an inherited one). */
type Audited = {
  projectId: string;
  personId: string;
  membershipId?: string | null;
};
type Roster = {
  members?: {
    personId: string;
    membershipId: string | null;
    source: string;
  }[];
};

/** Every roster write answers with the updated roster; the roster, the candidate list and the
 * project's assignable people (AS-5) all depend on it. */
function useRosterMutation<Variables extends Audited>(
  mutationFn: (variables: Omit<Variables, "membershipId">) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  return useMutation({
    mutationFn: ({ membershipId: _membershipId, ...request }: Variables) =>
      mutationFn(request),
    meta: {
      audits: {
        targets: (variables: Variables, result: unknown): HistoryTarget[] => {
          if (!workspace?.id) return [];
          const direct = (result as Roster).members?.find(
            (member) =>
              member.personId === variables.personId &&
              member.source === "direct",
          )?.membershipId;
          return [variables.membershipId, direct]
            .filter((id): id is string => typeof id === "string")
            .map((id) => ({
              kind: "entity",
              type: "project_membership",
              id,
              scope: {
                kind: "project",
                workspaceId: workspace.id,
                projectId: variables.projectId,
              },
            }));
        },
      },
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "members"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "assignable"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["workspace-capabilities"],
        }),
      ]);
    },
  });
}

export const useAddProjectMember = () =>
  useRosterMutation<Parameters<typeof addProjectMember>[0] & Audited>(
    addProjectMember,
  );
export const useUpdateProjectMemberRole = () =>
  useRosterMutation<Parameters<typeof updateProjectMemberRole>[0] & Audited>(
    updateProjectMemberRole,
  );
export const useRemoveProjectMember = () =>
  useRosterMutation<Parameters<typeof removeProjectMember>[0] & Audited>(
    removeProjectMember,
  );
