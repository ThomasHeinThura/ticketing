import { apiFetch } from "@taskdesk/libs";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { useEffect, useState } from "react";
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
  if (!response.ok) throw new Error("Unable to load identity event history");
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

  return (
    <section
      aria-labelledby="identity-event-history-title"
      className="space-y-3"
    >
      <h2 className="text-lg font-semibold" id="identity-event-history-title">
        Provisioning history
      </h2>
      {error ? (
        <Alert variant="error">
          <AlertDescription>
            Event history is unavailable. Your identity connection settings are
            unchanged.
          </AlertDescription>
        </Alert>
      ) : null}
      {loading ? <p role="status">Loading provisioning history…</p> : null}
      {!loading && !error && page?.data.length === 0 ? (
        <p>No provisioning events have been recorded for this connection.</p>
      ) : null}
      {events.length ? (
        <ol aria-label="Provisioning events" className="space-y-2">
          {events.map(({ event, key }) => (
            <li className="rounded-md border p-3" key={key}>
              <p className="font-medium">{event.kind}</p>
              <p className="text-sm text-muted-foreground">
                {event.outcome} · {event.actorType} ·{" "}
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString()}
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
          Older events
        </Button>
      ) : null}
      {cursor ? (
        <Button
          disabled={loading}
          onClick={() => onCursorChange(undefined)}
          type="button"
          variant="ghost"
        >
          Newest events
        </Button>
      ) : null}
    </section>
  );
}
