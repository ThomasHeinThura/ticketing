import { Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { usePageLoadingAnnouncement } from "@/components/page-loading-announcer";

export function PageLoading({
  portal = false,
  frame,
}: {
  portal?: boolean;
  frame?: "inbox" | "backlog";
}) {
  const { t } = useTranslation();
  usePageLoadingAnnouncement();
  const pathname =
    typeof window === "undefined" ? "" : window.location.pathname;
  const effectiveFrame =
    frame ??
    (pathname === "/agent/inbox"
      ? "inbox"
      : pathname.endsWith("/backlog")
        ? "backlog"
        : undefined);
  const padding = portal
    ? "p-4 sm:p-6"
    : effectiveFrame === "inbox"
      ? "p-4"
      : effectiveFrame === "backlog"
        ? "p-6"
        : "p-4 md:p-6";
  return (
    <div
      className={`flex w-full flex-col gap-4 ${portal || !effectiveFrame ? "mx-auto max-w-6xl" : ""} ${padding}`}
      aria-busy="true"
      aria-label={t("common:pageLoading")}
      aria-live="polite"
      role="status"
      data-testid="page-loading"
    >
      <Skeleton
        aria-hidden="true"
        className="h-8 w-64 motion-reduce:animate-none"
      />
      <Skeleton
        aria-hidden="true"
        className="h-24 w-full motion-reduce:animate-none"
      />
    </div>
  );
}
