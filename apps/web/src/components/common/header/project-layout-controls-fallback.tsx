import { Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

type ProjectLayoutControlsFallbackProps = {
  projectName?: string;
  showViewSwitcher: boolean;
  viewLabels: string[];
};

export default function ProjectLayoutControlsFallback({
  projectName,
  showViewSwitcher,
  viewLabels,
}: ProjectLayoutControlsFallbackProps) {
  const { t } = useTranslation();
  const loadingLabel = [
    projectName
      ? `${t("navigation:projectViews.selectProject")}: ${projectName}`
      : t("navigation:projectViews.selectProject"),
    ...(showViewSwitcher ? viewLabels : []),
  ].join(". ");

  return (
    <div
      aria-busy="true"
      aria-label={`${t("common:empty.loading")} ${loadingLabel}`}
      className="flex min-w-0 flex-1 items-center gap-2"
      role="status"
    >
      <div className="hidden min-w-0 items-center gap-1 md:flex">
        {projectName ? (
          <span className="max-w-32 truncate text-xs text-foreground">
            {projectName}
          </span>
        ) : (
          <Skeleton className="h-7 w-28" />
        )}
      </div>
      <Skeleton className="size-7 md:hidden" />
      {showViewSwitcher ? (
        <div
          aria-hidden="true"
          className="hidden h-8 min-w-0 max-w-full shrink overflow-hidden rounded-lg border border-border/80 bg-background sm:block"
        >
          <div className="inline-flex h-full w-max min-w-max items-center gap-0.5 p-0.5">
            {viewLabels.map((label, index) => (
              <Skeleton
                key={label}
                className={index === 2 ? "h-6 w-24" : "h-6 w-16"}
              />
            ))}
          </div>
        </div>
      ) : null}
      <span className="sr-only">
        {showViewSwitcher
          ? viewLabels.join(", ")
          : t("navigation:projectViews.selectProject")}
      </span>
    </div>
  );
}
