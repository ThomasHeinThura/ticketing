import { apiFetch } from "@taskdesk/libs";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";

type EventSummary = {
  kind: string;
  outcome: string;
  actorType: "person" | "scim" | "oidc";
  createdAt: string;
};

type EventPage = {
  data: EventSummary[];
  page: { nextCursor: string | null; hasMore: boolean };
};

async function loadEventPage(connectionId: string, cursor?: string) {
  const query = new URLSearchParams({ limit: "25" });
  if (cursor) query.set("cursor", cursor);
  const response = await apiFetch(
    getApiUrl(
      `instance/identity-connections/${encodeURIComponent(connectionId)}/events?${query.toString()}`,
    ),
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) throw new Error("identity event history unavailable");
  return (await response.json()) as EventPage;
}

export function IdentityConnectionEvents({
  connectionId,
  cursor,
  onCursorChange,
}: {
  connectionId: string;
  cursor?: string;
  onCursorChange: (cursor?: string) => void;
}) {
  const { t, i18n } = useTranslation("identityConnections");
  const [page, setPage] = useState<EventPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setPage(null);
    setLoading(true);
    setError(false);
    void loadEventPage(connectionId, cursor)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionId, cursor]);

  const duplicateKeys = new Map<string, number>();
  const events = (page?.data ?? []).map((event) => {
    const fingerprint = JSON.stringify(event);
    const duplicate = duplicateKeys.get(fingerprint) ?? 0;
    duplicateKeys.set(fingerprint, duplicate + 1);
    return { event, key: `${fingerprint}:${duplicate}` };
  });

  const eventLabel = (kind: string) => {
    const keys: Record<string, string> = {
      "user.created": "events.kinds.userCreated",
      "user.updated": "events.kinds.userUpdated",
      "user.deactivated": "events.kinds.userDeactivated",
      "user.reactivated": "events.kinds.userReactivated",
      "group.directory_changed": "events.kinds.groupDirectoryChanged",
      "group.mapping_changed": "events.kinds.groupMappingChanged",
      "group.member_added": "events.kinds.groupMemberAdded",
      "group.member_removed": "events.kinds.groupMemberRemoved",
      "request.denied": "events.kinds.requestDenied",
      "auth.failed": "events.kinds.authFailed",
      "token.rotated": "events.kinds.tokenRotated",
      "token.revoked": "events.kinds.tokenRevoked",
      "connection.changed": "events.kinds.connectionChanged",
      "sync.failed": "events.kinds.syncFailed",
    };
    return t(keys[kind] ?? "events.unknown");
  };
  const outcomeLabel = (outcome: string) =>
    t(
      (
        {
          success: "events.outcomes.success",
          denied: "events.outcomes.denied",
          failure: "events.outcomes.failure",
        } as Record<string, string>
      )[outcome] ?? "events.unknown",
    );
  const actorLabel = (actor: EventSummary["actorType"]) =>
    t(`events.actors.${actor}`);

  return (
    <section
      aria-labelledby="identity-event-history-title"
      className="space-y-3"
    >
      <h2 className="text-lg font-semibold" id="identity-event-history-title">
        {t("events.title")}
      </h2>
      {error ? (
        <Alert variant="error">
          <AlertDescription>{t("events.loadFailed")}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? <p role="status">{t("events.loading")}</p> : null}
      {!loading && !error && page?.data.length === 0 ? (
        <p>{t("events.empty")}</p>
      ) : null}
      {events.length ? (
        <ol aria-label={t("events.listLabel")} className="space-y-2">
          {events.map(({ event, key }) => (
            <li className="rounded-md border p-3" key={key}>
              <p className="font-medium">{eventLabel(event.kind)}</p>
              <p className="text-sm text-muted-foreground">
                {outcomeLabel(event.outcome)} · {actorLabel(event.actorType)} ·{" "}
                <time dateTime={event.createdAt}>
                  {new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.createdAt))}
                </time>
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {!error && page?.page.hasMore && page.page.nextCursor ? (
        <Button
          disabled={loading}
          onClick={() => onCursorChange(page.page.nextCursor ?? undefined)}
          type="button"
          variant="outline"
        >
          {t("events.older")}
        </Button>
      ) : null}
      {cursor ? (
        <Button
          disabled={loading}
          onClick={() => onCursorChange(undefined)}
          type="button"
          variant="ghost"
        >
          {t("events.newest")}
        </Button>
      ) : null}
    </section>
  );
}
