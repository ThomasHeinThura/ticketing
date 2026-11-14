import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import {
  Button,
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@taskdesk/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { PickerPopover } from "@/components/common/picker-popover";
import { InvitationResultCard } from "@/components/invitation/invitation-result-card";
import { NoEmailNotice } from "@/components/invitation/no-email-notice";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
};

const teamMemberSchema = z.object({
  email: z.string(),
  role: z.string().min(1),
});

type TeamMemberFormValues = z.infer<typeof teamMemberSchema>;

function InviteTeamMemberModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { mutateAsync } = useInviteWorkspaceUser();
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const roles = useQuery({
    queryKey: ["invitation-roles", workspaceId],
    enabled: Boolean(workspaceId && open),
    queryFn: async () => {
      if (!workspaceId) return [];
      const response = await client.workspace[":workspaceId"][
        "invitation-roles"
      ].$get({ param: { workspaceId } });
      if (!response.ok) throw new Error("Could not load invitation roles");
      return response.json();
    },
  });
  const { canInviteUsers } = useWorkspacePermission();
  const canInvite = canInviteUsers();
  const [createdInvitation, setCreatedInvitation] = useState<{
    id: string;
    email: string;
    expiresAt: string;
    delivered: boolean;
  } | null>(null);

  const form = useForm<TeamMemberFormValues>({
    resolver: standardSchemaResolver(teamMemberSchema),
    defaultValues: {
      email: "",
      role: "member",
    },
  });

  const onSubmit = async ({ email, role }: TeamMemberFormValues) => {
    if (!workspaceId) {
      toast.error(t("team:inviteModal.error"));
      return;
    }
    if (!canInvite || !roles.data?.some((item) => item.id === role)) {
      // Defense-in-depth: parent gates the trigger, but if the modal is
      // somehow open without permission we refuse rather than firing a
      // mutation the server will reject.
      toast.error(t("team:inviteModal.error"));
      return;
    }
    try {
      const invitation = await mutateAsync({
        email,
        workspaceId,
        role,
      });
      await queryClient.refetchQueries({
        queryKey: ["workspace-users", workspaceId],
      });

      if (invitation?.delivered !== false) {
        toast.success(t("team:inviteModal.success"));
      }

      if (invitation?.id) {
        setCreatedInvitation({
          id: invitation.id,
          email,
          expiresAt:
            typeof invitation.expiresAt === "string"
              ? invitation.expiresAt
              : "",
          delivered: Boolean(invitation.delivered),
        });
        form.reset();
        return;
      }

      resetInviteTeamMember();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("team:inviteModal.error"),
      );
    }
  };

  const resetInviteTeamMember = async () => {
    if (workspaceId) {
      await queryClient.invalidateQueries({
        queryKey: ["workspace-users", workspaceId],
      });
    }
    form.reset();
  };

  const resetAndCloseModal = () => {
    setCreatedInvitation(null);
    resetInviteTeamMember();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={resetAndCloseModal}>
      <DialogPopup
        className="w-full max-w-md"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {createdInvitation
              ? t("team:inviteModal.createdTitle")
              : t("team:inviteModal.title")}
          </DialogTitle>
        </DialogHeader>

        {createdInvitation ? (
          <>
            <DialogPanel className="space-y-3">
              <InvitationResultCard
                kind="staff"
                invitationId={createdInvitation.id}
                workspaceId={workspaceId}
                email={createdInvitation.email}
                delivered={createdInvitation.delivered}
                expiresAt={createdInvitation.expiresAt}
              />
            </DialogPanel>
            <DialogFooter>
              <Button size="sm" onClick={resetAndCloseModal}>
                {t("team:inviteModal.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="contents">
              <DialogPanel>
                <NoEmailNotice />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("team:inviteModal.emailLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("team:inviteModal.emailPlaceholder")}
                          autoFocus
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("team:inviteModal.roleLabel")}</FormLabel>
                      <FormControl>
                        <PickerPopover
                          value={field.value}
                          ariaLabel={t("team:inviteModal.roleLabel")}
                          placeholder={t("team:inviteModal.rolePlaceholder")}
                          options={(roles.data ?? []).map((item) => ({
                            value: item.id,
                            label: t(`team:roles.${item.id}`, {
                              defaultValue: item.name,
                            }),
                          }))}
                          onChange={field.onChange}
                          disabled={roles.isLoading || roles.isError}
                        />
                      </FormControl>
                      {roles.isError && (
                        <p role="alert">{t("team:inviteModal.rolesError")}</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </DialogPanel>

              <DialogFooter>
                <DialogClose
                  render={<Button variant="outline" size="sm" type="button" />}
                >
                  {t("common:actions.cancel")}
                </DialogClose>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !workspaceId ||
                    !canInvite ||
                    !roles.data?.some((item) => item.id === form.watch("role"))
                  }
                >
                  {t("team:inviteModal.sendInvitation")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export default InviteTeamMemberModal;
