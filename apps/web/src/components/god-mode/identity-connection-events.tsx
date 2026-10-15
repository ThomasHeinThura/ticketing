import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { identityAdminFailureKind } from "@/fetchers/god-mode/identity-admin-error";
import { useIdentityConnectionEvents } from "@/hooks/queries/god-mode/use-identity-connections";

const KIND_KEYS: Record<string, string> = {
  "user.created": "userCreated",
  "user.updated": "userUpdated",
  "user.deactivated": "userDeactivated",
  "user.reactivated": "userReactivated",
  "group.directory_changed": "groupDirectoryChanged",
  "group.mapping_changed": "groupMappingChanged",
  "group.member_added": "groupMemberAdded",
  "group.member_removed": "groupMemberRemoved",
  "request.denied": "requestDenied",
  "auth.failed": "authFailed",
  "token.rotated": "tokenRotated",
  "token.revoked": "tokenRevoked",
  "connection.changed": "connectionChanged",
  "sync.failed": "syncFailed",
};
const OUTCOME_KEYS: Record<string, string> = {
  succeeded: "succeeded",
  success: "succeeded",
  denied: "denied",
  failed: "failed",
  failure: "failed",
};

export function IdentityConnectionEvents({
  connectionId,
  cursor,
  onCursorChange,
}: {
  connectionId: string;
  cursor: string | undefined;
  onCursorChange: (cursor: string | undefined) => void;
}) {
  const { t, i18n } = useTranslation("identityConnections");
  const events = useIdentityConnectionEvents(connectionId, cursor, true);
  const page = events.data;

  return (
    <section aria-labelledby="identity-events-heading" className="space-y-3">
      <h2 className="text-lg font-semibold" id="identity-events-heading">
        {t("events.title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("events.description")}</p>
      {events.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("events.unavailable")}</AlertTitle>
          <AlertDescription>
            <p>
              {identityAdminFailureKind(events.error) === "not_found"
                ? t("errors.not_found")
                : identityAdminFailureKind(events.error) === "denied"
                  ? t("errors.denied")
                  : t("events.loadFailed")}
            </p>
            <Button
              onClick={() => void events.refetch()}
              type="button"
              variant="outline"
            >
              {t("common.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {events.isPending ? (
        <div
          aria-label={t("events.loading")}
          className="space-y-2"
          role="status"
        >
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : null}
      {page && page.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("events.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("events.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {page && page.data.length > 0 ? (
        <ol aria-label={t("events.listLabel")} className="space-y-2">
          {page.data.map((event, index) => (
            <li
              className="rounded-md border p-3"
              // The summaries carry no id; position within one page is stable for that page.
              // biome-ignore lint/suspicious/noArrayIndexKey: id-less immutable summaries
              key={`${event.createdAt}:${event.kind}:${index}`}
            >
              <p className="font-medium">
                {KIND_KEYS[event.kind]
                  ? t(`events.kinds.${KIND_KEYS[event.kind]}`)
                  : t("events.unknown")}
              </p>
              <p className="text-sm text-muted-foreground">
                {OUTCOME_KEYS[event.outcome]
                  ? t(`events.outcomes.${OUTCOME_KEYS[event.outcome]}`)
                  : t("events.unknown")}{" "}
                · {t(`events.actors.${event.actorType}`)} ·{" "}
                <time dateTime={event.createdAt}>
                  {new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  }).format(new Date(event.createdAt))}
                </time>
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex gap-2">
        {page?.page.hasMore && page.page.nextCursor ? (
          <Button
            disabled={events.isFetching}
            onClick={() => onCursorChange(page.page.nextCursor ?? undefined)}
            type="button"
            variant="outline"
          >
            {t("events.older")}
          </Button>
        ) : null}
        {cursor ? (
          <Button
            disabled={events.isFetching}
            onClick={() => onCursorChange(undefined)}
            type="button"
            variant="ghost"
          >
            {t("events.newest")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
