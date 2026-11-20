import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  assertNotificationHistorySession,
  getProfileHistory,
  profileHistoryKey,
} from "@/fetchers/settings/personal-history";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { HistoryPresentation } from "./settings-history";

export function PersonalProfileHistory({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const sessionId =
    session?.user?.id === userId ? session.session?.id : undefined;
  const host = window.location.host;
  const key = profileHistoryKey(userId, sessionId ?? "");
  const client = useQueryClient();
  const history = useQuery({
    queryKey: key,
    enabled: Boolean(userId && sessionId),
    queryFn: async ({ signal }) => {
      try {
        await assertNotificationHistorySession(
          "staff",
          userId,
          sessionId ?? "",
          host,
        );
        const result = await getProfileHistory(signal);
        await assertNotificationHistorySession(
          "staff",
          userId,
          sessionId ?? "",
          host,
        );
        return result;
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof HttpError &&
          [401, 403, 404].includes(error.status)
        )
          client.setQueryData(key, null);
        throw error;
      }
    },
  });
  const you = t("settings:history.profileYou");
  const labels: Record<string, string> = {
    name: t("settings:informationPage.fullName"),
    image: t("settings:informationPage.profilePicture"),
    locale: t("settings:history.profileLocale"),
  };
  const data =
    history.isFetchedAfterMount &&
    history.isSuccess &&
    history.fetchStatus === "idle"
      ? history.data
      : null;
  const occurrences = new Map<string, number>();
  const rows = data?.rows.map((row) => {
    const value = JSON.stringify(row);
    const count = occurrences.get(value) ?? 0;
    occurrences.set(value, count + 1);
    return { row, key: `${value}-${count}` };
  });
  return (
    <HistoryPresentation
      loading={history.isLoading}
      error={history.isError}
      retry={() => void history.refetch()}
      onOpen={() => {
        if (userId && sessionId && !history.isFetching) void history.refetch();
      }}
      summary={
        data
          ? data.lastChanged
            ? t("settings:history.lastChanged", {
                actor: you,
                at: formatDateTime(data.lastChanged.at),
              })
            : t("settings:history.empty")
          : undefined
      }
    >
      {rows?.map(({ row, key }) => (
        <div className="py-2 border-b border-border" key={key}>
          <p>
            {you} · {formatDateTime(row.at)}
          </p>
          <p className="text-muted-foreground">
            {row.changedFields
              ?.filter((field) => Object.hasOwn(labels, field))
              .map((field) => labels[field])
              .join(", ")}
          </p>
        </div>
      ))}
    </HistoryPresentation>
  );
}
