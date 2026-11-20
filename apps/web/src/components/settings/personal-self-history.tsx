import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  assertNotificationHistorySession,
  getPersonalSelfHistory,
  type PersonalHistoryAudience,
  type PersonalSelfHistorySection,
  personalSelfHistoryKey,
} from "@/fetchers/settings/personal-history";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { HistoryPresentation } from "./settings-history";

export function PersonalSelfHistory({
  section,
  audience,
  userId,
  sessionId,
}: {
  section: PersonalSelfHistorySection;
  audience: PersonalHistoryAudience;
  userId?: string;
  sessionId?: string;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const host = window.location.host;
  const key = personalSelfHistoryKey(
    section,
    audience,
    userId ?? "",
    sessionId ?? "",
    host,
  );
  const history = useQuery({
    queryKey: key,
    enabled: Boolean(
      userId && sessionId && (section !== "apiKeys" || audience === "staff"),
    ),
    queryFn: async ({ signal }) => {
      try {
        await assertNotificationHistorySession(
          audience,
          userId ?? "",
          sessionId ?? "",
          host,
        );
        const result = await getPersonalSelfHistory(section, audience, signal);
        await assertNotificationHistorySession(
          audience,
          userId ?? "",
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
  const labels = {
    password: t("settings:history.securityPassword"),
    mfa: t("settings:history.securityMfa"),
    personalKey: t("settings:history.personalKey"),
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
      loading={history.isLoading || history.isFetching}
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
            {row.changedCategories
              .map((category) => labels[category])
              .join(", ")}
          </p>
        </div>
      ))}
    </HistoryPresentation>
  );
}
