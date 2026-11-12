import { useRouter } from "@tanstack/react-router";
import {
  type EmptyStateProps,
  ErrorState,
  type ErrorStateProps,
  NoAccess,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

type Texts = Partial<Pick<EmptyStateProps, "title" | "description">>;

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
