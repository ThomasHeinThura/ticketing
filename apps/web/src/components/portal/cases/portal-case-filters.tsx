import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetClose,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import {
  ArrowUpDown,
  CalendarRange,
  ChevronDown,
  ListFilter,
  Search,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { DateField } from "@/components/common/date-field";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import {
  PORTAL_CASE_PRIORITIES,
  PORTAL_CASE_SORTS,
  PORTAL_CASE_STATUSES,
  type PortalCaseFilterSearch,
  type PortalCaseSort,
} from "@/lib/routes";

/** A change to the URL filters; `undefined` clears a key. */
export type PortalCaseFilterPatch = {
  [Key in keyof PortalCaseFilterSearch]?:
    | PortalCaseFilterSearch[Key]
    | undefined;
};

function toggleIn(
  list: string | undefined,
  value: string,
  order: readonly string[],
) {
  const selected = new Set(list ? list.split(",") : []);
  if (selected.has(value)) selected.delete(value);
  else selected.add(value);
  const next = order.filter((item) => selected.has(item));
  return next.length ? next.join(",") : undefined;
}

function FilterMenu({
  label,
  values,
  selected,
  labelOf,
  onToggle,
}: {
  label: string;
  values: readonly string[];
  selected: string | undefined;
  labelOf: (value: string) => string;
  onToggle: (value: string) => void;
}) {
  const chosen = selected ? selected.split(",") : [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        {label}
        {chosen.length ? (
          <Badge variant="secondary" size="sm" className="tabular-nums">
            {chosen.length}
          </Badge>
        ) : null}
        <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {values.map((value) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={chosen.includes(value)}
            closeOnClick={false}
            onCheckedChange={() => onToggle(value)}
          >
            {labelOf(value)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from?: string;
  to?: string;
  onChange: (patch: PortalCaseFilterPatch) => void;
}) {
  const { t } = usePortalTranslation("portal");
  const id = useId();
  const active = Boolean(from || to);
  // Modal, like the Status and Severity menus: focus stays in the date fields until the
  // popover closes, and Base UI's focus guards are not left tabbable behind it (G4).
  return (
    <Popover modal>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        <CalendarRange className="size-3.5" aria-hidden="true" />
        {t("cases.filters.created")}
        {active ? (
          <Badge variant="secondary" size="sm">
            {t("cases.filters.on")}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-from`}>{t("cases.filters.from")}</Label>
            <DateField
              id={`${id}-from`}
              value={from ?? ""}
              max={to}
              label={t("cases.filters.from")}
              placeholder={t("cases.filters.anyDate")}
              onChange={(value) => onChange({ from: value || undefined })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-to`}>{t("cases.filters.to")}</Label>
            <DateField
              id={`${id}-to`}
              value={to ?? ""}
              min={from}
              label={t("cases.filters.to")}
              placeholder={t("cases.filters.anyDate")}
              onChange={(value) => onChange({ to: value || undefined })}
            />
          </div>
          {active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ from: undefined, to: undefined })}
            >
              {t("cases.filters.clearDates")}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Search box that writes `q` after a short pause, so typing does not navigate per key. */
function CaseSearch({
  value,
  onChange,
}: {
  value?: string;
  onChange: (q: string | undefined) => void;
}) {
  const { t } = usePortalTranslation("portal");
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  useEffect(() => {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    const timer = window.setTimeout(() => onChange(next || undefined), 300);
    return () => window.clearTimeout(timer);
  }, [draft, value, onChange]);
  return (
    <InputGroup className="w-full sm:w-64">
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label={t("cases.filters.search")}
        placeholder={t("cases.filters.searchPlaceholder")}
        value={draft}
        maxLength={200}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
    </InputGroup>
  );
}

function SortMenu({
  sort,
  onChange,
}: {
  sort: PortalCaseSort;
  onChange: (patch: PortalCaseFilterPatch) => void;
}) {
  const { t } = usePortalTranslation("portal");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        <ArrowUpDown className="size-3.5" aria-hidden="true" />
        {t(`cases.sort.${sort}`)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("cases.sort.label")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) =>
            onChange({
              sort:
                value === "updated_desc"
                  ? undefined
                  : (value as PortalCaseFilterSearch["sort"]),
            })
          }
        >
          {PORTAL_CASE_SORTS.map((value) => (
            <DropdownMenuRadioItem key={value} value={value} closeOnClick>
              {t(`cases.sort.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const CLEARED: PortalCaseFilterPatch = {
  status: undefined,
  priority: undefined,
  q: undefined,
  from: undefined,
  to: undefined,
};

/**
 * The cases toolbar (WSO2-style): an optional leading control (the request list's view tabs),
 * the My / All toggle, then Status and Severity filter menus, and on the full list a created-date
 * range, sort and search. Every value lives in the URL. Below `sm` the full list keeps the view
 * tabs, My / All and search in view and moves the menus behind one Filter button that opens a
 * bottom sheet (P5), so the toolbar takes two rows on a phone.
 */
export function PortalCaseFilters({
  filters,
  onChange,
  statuses = PORTAL_CASE_STATUSES,
  full = false,
  leading,
}: {
  filters: PortalCaseFilterSearch;
  onChange: (patch: PortalCaseFilterPatch) => void;
  /** The statuses offered; the dashboard offers only the outstanding ones. */
  statuses?: readonly string[];
  /** Search, created dates and sort (the request list). */
  full?: boolean;
  /** Rendered first in the same row, e.g. the request list's view tabs. */
  leading?: ReactNode;
}) {
  const { t } = usePortalTranslation("portal");
  const scope = filters.scope ?? "mine";
  const sort: PortalCaseSort = filters.sort ?? "updated_desc";
  const hasFilters = Boolean(
    filters.status ||
      filters.priority ||
      filters.q ||
      filters.from ||
      filters.to,
  );
  // Filter groups set inside the sheet; search stays outside it and sort is an order, not a filter.
  const sheetFilterCount = [
    filters.status,
    filters.priority,
    filters.from || filters.to,
  ].filter(Boolean).length;
  const menus = (
    <>
      <FilterMenu
        label={t("cases.columns.status")}
        values={statuses}
        selected={filters.status}
        labelOf={(value) => t(`request.status.${value}`)}
        onToggle={(value) =>
          onChange({
            status: toggleIn(filters.status, value, PORTAL_CASE_STATUSES),
          })
        }
      />
      <FilterMenu
        label={t("cases.columns.severity")}
        values={PORTAL_CASE_PRIORITIES}
        selected={filters.priority}
        labelOf={(value) => t(`request.priority.value.${value}`)}
        onToggle={(value) =>
          onChange({
            priority: toggleIn(filters.priority, value, PORTAL_CASE_PRIORITIES),
          })
        }
      />
      {full ? (
        <>
          <DateRangeFilter
            from={filters.from}
            to={filters.to}
            onChange={onChange}
          />
          <SortMenu sort={sort} onChange={onChange} />
        </>
      ) : null}
    </>
  );
  const clear = hasFilters ? (
    <Button variant="ghost" size="sm" onClick={() => onChange(CLEARED)}>
      {t("cases.filters.clear")}
    </Button>
  ) : null;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-slot="portal-case-toolbar"
    >
      {leading}
      {full ? (
        <Sheet>
          <SheetTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 sm:hidden"
              />
            }
          >
            <ListFilter className="size-3.5" aria-hidden="true" />
            {t("common:actions.filter")}
            {sheetFilterCount ? (
              <Badge variant="secondary" size="sm" className="tabular-nums">
                {sheetFilterCount}
              </Badge>
            ) : null}
          </SheetTrigger>
          <SheetPopup side="bottom" closeLabel={t("common:actions.close")}>
            <SheetHeader>
              <SheetTitle>{t("common:actions.filter")}</SheetTitle>
            </SheetHeader>
            <SheetPanel>
              <div className="flex flex-wrap items-center gap-2">{menus}</div>
            </SheetPanel>
            <SheetFooter variant="bare">
              {clear}
              <SheetClose render={<Button size="sm" />}>
                {t("common:actions.close")}
              </SheetClose>
            </SheetFooter>
          </SheetPopup>
        </Sheet>
      ) : null}
      <ToggleGroup
        variant="outline"
        size="sm"
        aria-label={t("cases.scope.label")}
        value={[scope]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "mine" || value === "all")
            onChange({ scope: value === "all" ? "all" : undefined });
        }}
      >
        <ToggleGroupItem value="mine">{t("cases.scope.mine")}</ToggleGroupItem>
        <ToggleGroupItem value="all">{t("cases.scope.all")}</ToggleGroupItem>
      </ToggleGroup>
      {full ? (
        <div className="flex flex-wrap items-center gap-2 max-sm:hidden">
          {menus}
          {clear}
        </div>
      ) : (
        <>
          {menus}
          {clear}
        </>
      )}
      {full ? (
        <div className="min-w-32 flex-1 sm:ms-auto sm:flex-none">
          <CaseSearch value={filters.q} onChange={(q) => onChange({ q })} />
        </div>
      ) : null}
    </div>
  );
}
