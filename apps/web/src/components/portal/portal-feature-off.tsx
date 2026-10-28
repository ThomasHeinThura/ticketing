import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import type { PortalStateMarker } from "@/lib/portal-state";

/**
 * P3-R2-03: the portal while `feature.customer_portal` is off for this visitor, or could not be
 * read. The same library empty state the agent app uses for a switched-off feature, inside the
 * portal's own centred frame; "unavailable" offers a retry because it is temporary.
 */
export function PortalFeatureOff({ state }: { state: PortalStateMarker }) {
  const { t } = usePortalTranslation("portal");
  const key =
    state === "unavailable" ? "temporarilyUnavailable" : "unavailable";
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">
        <Empty data-testid={`portal-feature-off-${state}`}>
          <EmptyHeader>
            <EmptyTitle>{t(`${key}.title`)}</EmptyTitle>
            <EmptyDescription>{t(`${key}.description`)}</EmptyDescription>
          </EmptyHeader>
          {state === "unavailable" ? (
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                <RefreshCw aria-hidden="true" />
                {t("common:actions.tryAgain")}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </div>
    </main>
  );
}
