import { useMutation, useQueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import deleteNotificationWorkspaceRule from "@/fetchers/notification-preferences/delete-notification-workspace-rule";
import updateNotificationPreferences, {
  type UpdateNotificationPreferencesRequest,
} from "@/fetchers/notification-preferences/update-notification-preferences";
import upsertNotificationWorkspaceRule, {
  type UpsertNotificationWorkspaceRuleRequest,
} from "@/fetchers/notification-preferences/upsert-notification-workspace-rule";
import { toast } from "@/lib/toast";

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (json: UpdateNotificationPreferencesRequest) => {
      return updateNotificationPreferences(json);
    },
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "staff", section: "notifications" },
        ],
      },
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
      toast.success(i18n.t("settings:notificationsPage.toastPreferencesSaved"));
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : i18n.t("settings:notificationsPage.toastPreferencesSaveFailed"),
      );
    },
  });
}

export function useUpsertNotificationWorkspaceRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workspaceId,
      json,
    }: {
      workspaceId: string;
      json: UpsertNotificationWorkspaceRuleRequest;
    }) => {
      return upsertNotificationWorkspaceRule(workspaceId, json);
    },
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "staff", section: "notifications" },
        ],
      },
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
      toast.success(i18n.t("settings:notificationsPage.toastRuleSavedGeneric"));
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : i18n.t("settings:notificationsPage.toastRuleSaveFailed", {}),
      );
    },
  });
}

export function useDeleteNotificationWorkspaceRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      return deleteNotificationWorkspaceRule(workspaceId);
    },
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "staff", section: "notifications" },
        ],
      },
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
      toast.success(
        i18n.t("settings:notificationsPage.toastRuleRemovedGeneric"),
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : i18n.t("settings:notificationsPage.toastRuleRemoveFailed", {}),
      );
    },
  });
}
