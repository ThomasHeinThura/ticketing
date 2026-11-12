import { useMutation, useQueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import getNotifications, {
  type NotificationInboxPage,
} from "@/fetchers/notification/get-notifications";
import { toast } from "@/lib/toast";
import {
  beginNotificationUpdate,
  commitNotificationUpdate,
  endNotificationUpdate,
} from "./optimistic-notifications";

export function useOptimisticNotification<T>(
  mutationFn: (value: T) => Promise<unknown>,
  operation: (value: T) => { id?: string; read: boolean },
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: (value) => beginNotificationUpdate(client, operation(value)),
    onError: (_error, _value, context) => {
      if (context) endNotificationUpdate(client, context);
      toast.error(i18n.t("common:error.messages.unknown"));
    },
    onSettled: async (_data, error, _value, context) => {
      if (!error && context) commitNotificationUpdate(client, context);
      const allKey = ["notifications", "inbox", "all"] as const;
      // A read started before this write settled cannot establish the final unread count.
      await client.cancelQueries({ queryKey: allKey, exact: true });
      await client.invalidateQueries({
        queryKey: allKey,
        exact: true,
        refetchType: "none",
      });
      await Promise.allSettled([
        client.invalidateQueries({
          queryKey: ["notifications"],
          predicate: (query) =>
            !(
              query.queryKey[0] === "notifications" &&
              query.queryKey[1] === "inbox" &&
              query.queryKey[2] === "all" &&
              query.queryKey.length === 3
            ),
        }),
        client.fetchInfiniteQuery({
          queryKey: allKey,
          initialPageParam: undefined as string | undefined,
          queryFn: ({ pageParam }) => getNotifications("all", pageParam),
          getNextPageParam: (lastPage: NotificationInboxPage) =>
            lastPage.nextCursor ?? undefined,
        }),
      ]);
      if (context) endNotificationUpdate(client, context);
    },
  });
}
