import { Button, DropdownMenu, DropdownMenuTrigger } from "@taskdesk/ui";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SortConfig, SortField } from "@/lib/sort-tasks";

const loadSortControlMenu = () => import("./sort-control-menu");
const SortControlMenu = lazy(loadSortControlMenu);

type SortControlProps = {
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
  fields?: readonly SortField[];
};

export default function SortControl({
  sort,
  onSortChange,
  fields,
}: SortControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [contentRequested, setContentRequested] = useState(false);
  const isActive = sort.field !== "position";

  const toggleDirection = () => {
    onSortChange({
      ...sort,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });
  };

  const preloadMenuContent = () => {
    void loadSortControlMenu().catch(() => {});
  };
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setContentRequested(true);
  };

  return (
    <div className="inline-flex items-center gap-1">
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          onFocus={preloadMenuContent}
          onPointerEnter={preloadMenuContent}
          render={
            <Button
              variant="ghost"
              type="button"
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none ring-0 ${
                isActive
                  ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                  : "border-border bg-background text-foreground hover:bg-accent/60"
              }`}
            />
          }
        >
          {sort.direction === "asc" ? (
            <ArrowUpAZ className="h-3 w-3" />
          ) : (
            <ArrowDownAZ className="h-3 w-3" />
          )}
          {isActive
            ? t(`tasks:sort.fields.${sort.field}`)
            : t("tasks:sort.label")}
        </DropdownMenuTrigger>
        {contentRequested ? (
          <Suspense fallback={null}>
            <SortControlMenu
              sort={sort}
              fields={fields}
              onSortChange={onSortChange}
            />
          </Suspense>
        ) : null}
      </DropdownMenu>

      {isActive && (
        <Button
          variant="ghost"
          type="button"
          onClick={toggleDirection}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent/60"
          title={
            sort.direction === "asc"
              ? t("tasks:sort.ascending")
              : t("tasks:sort.descending")
          }
        >
          {sort.direction === "asc" ? (
            <ArrowUpAZ className="h-3 w-3" />
          ) : (
            <ArrowDownAZ className="h-3 w-3" />
          )}
        </Button>
      )}
    </div>
  );
}
