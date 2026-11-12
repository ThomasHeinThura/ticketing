import { useRouter } from "@tanstack/react-router";
import {
  type EmptyStateProps,
  ErrorState,
  type ErrorStateProps,
  NoAccess,
} from "@taskdesk/ui";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { routes } from "@/lib/routes";

type Texts = Partial<Pick<EmptyStateProps, "title" | "description">>;

/** A whole-page denial, with focus and a safe fallback for a direct link. */
export function NoAccessPage() {
  const { t } = useTranslation("common");
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const heading = container.current?.querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, []);
  return (
    <div ref={container} data-testid="settings-access-denied">
      <PageTitle title={t("states.noAccess.title")} />
      <NoAccessState
        headingLevel={1}
        onBack={() => {
          if (router.history.canGoBack()) router.history.back();
          else void router.navigate({ to: routes.agentHome.path });
        }}
      />
    </div>
  );
}

/**
 * "You don't have access. Ask a workspace admin." with a Back action (UX-1a): the shared
 * `NoAccess` with its default texts from i18n. A screen with a more specific reason passes its own
 * `title` and `description`; `onBack` replaces the browser-history Back.
 */
export function NoAccessState({
  title,
  description,
  onBack,
  ...props
}: Texts &
  Omit<EmptyStateProps, "title" | "description" | "action"> & {
    onBack?: () => void;
  }) {
  const { t } = useTranslation("common");
  const router = useRouter();
  return (
    <NoAccess
      action={{
        label: t("states.back"),
        onClick: onBack ?? (() => router.history.back()),
      }}
      description={description ?? t("states.noAccess.description")}
      title={title ?? t("states.noAccess.title")}
      {...props}
    />
  );
}

/** "This could not be loaded" with Retry (UX-1a): the shared `ErrorState` with i18n default texts. */
export function LoadErrorState({
  title,
  description,
  onRetry,
  ...props
}: Texts & Omit<ErrorStateProps, "title" | "description" | "retryLabel">) {
  const { t } = useTranslation("common");
  return (
    <ErrorState
      description={description ?? t("states.error.description")}
      onRetry={onRetry}
      retryLabel={t("actions.retry")}
      title={title ?? t("states.error.title")}
      {...props}
    />
  );
}
