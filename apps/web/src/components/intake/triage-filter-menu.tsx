import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActiveFilterChip } from "@/components/board/board-toolbar";
import {
  INTAKE_AGE_FILTERS,
  INTAKE_ASSIGNEE_FILTERS,
  type IntakeAgeFilter,
  type IntakeAssigneeFilter,
} from "@/lib/routes";

export type TriageFilters = {
  requestType?: string;
  assignee?: IntakeAssigneeFilter;
  age?: IntakeAgeFilter;
};

type RequestTypeOption = { id: string; name: string };

/**
 * `IQ-19`/`IQ-21`: the triage queue's URL filters in Kaneo's board-toolbar pattern, a Filter
 * menu with one submenu per facet and removable chips for what is active.
 */
export function TriageFilterMenu({
  filters,
  requestTypes,
  onChange,
}: {
  filters: TriageFilters;
  requestTypes: RequestTypeOption[];
  onChange: (
    patch: Partial<Record<keyof TriageFilters, string | undefined>>,
  ) => void;
}) {
  const { t } = useTranslation("intake");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            aria-label={t("filters.menu", { defaultValue: "Filter queue" })}
          />
        }
      >
        <Filter className="size-3" />
        {t("filters.filter", { defaultValue: "Filter" })}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("filters.filterBy", { defaultValue: "Filter by" })}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("filters.requestType", { defaultValue: "Request type" })}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {requestTypes.map((type) => (
              <DropdownMenuCheckboxItem
                key={type.id}
                checked={filters.requestType === type.id}
                onCheckedChange={(checked) =>
                  onChange({ requestType: checked ? type.id : undefined })
                }
              >
                {type.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("filters.assignee", { defaultValue: "Assignee" })}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {INTAKE_ASSIGNEE_FILTERS.map((value) => (
              <DropdownMenuCheckboxItem
                key={value}
                checked={filters.assignee === value}
                onCheckedChange={(checked) =>
                  onChange({ assignee: checked ? value : undefined })
                }
              >
                {t(`filters.assigneeValue.${value}`, {
                  defaultValue: value === "claimed" ? "Claimed" : "Unclaimed",
                })}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("filters.age", { defaultValue: "Age" })}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {INTAKE_AGE_FILTERS.map((value) => (
              <DropdownMenuCheckboxItem
                key={value}
                checked={filters.age === value}
                onCheckedChange={(checked) =>
                  onChange({ age: checked ? value : undefined })
                }
              >
                {t("filters.ageValue", {
                  defaultValue: "Older than {{age}}",
                  age: value,
                })}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The active triage filters as removable chips (same chip the board toolbar uses). */
export function TriageFilterChips({
  filters,
  requestTypes,
  onChange,
}: {
  filters: TriageFilters;
  requestTypes: RequestTypeOption[];
  onChange: (
    patch: Partial<Record<keyof TriageFilters, string | undefined>>,
  ) => void;
}) {
  const { t } = useTranslation("intake");
  const is = t("filters.is", { defaultValue: "is" });
  const chips: Array<{
    key: keyof TriageFilters;
    subject: string;
    value: string;
  }> = [];
  if (filters.requestType)
    chips.push({
      key: "requestType",
      subject: t("filters.requestType", { defaultValue: "Request type" }),
      value:
        requestTypes.find((type) => type.id === filters.requestType)?.name ??
        filters.requestType,
    });
  if (filters.assignee)
    chips.push({
      key: "assignee",
      subject: t("filters.assignee", { defaultValue: "Assignee" }),
      value: t(`filters.assigneeValue.${filters.assignee}`, {
        defaultValue: filters.assignee === "claimed" ? "Claimed" : "Unclaimed",
      }),
    });
  if (filters.age)
    chips.push({
      key: "age",
      subject: t("filters.age", { defaultValue: "Age" }),
      value: t("filters.ageValue", {
        defaultValue: "Older than {{age}}",
        age: filters.age,
      }),
    });
  if (chips.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-4 py-2"
      data-testid="triage-filter-chips"
    >
      {chips.map((chip) => (
        <ActiveFilterChip
          key={chip.key}
          subject={chip.subject}
          operator={is}
          value={chip.value}
          clearLabel={t("filters.remove", {
            defaultValue: "Remove {{subject}} filter",
            subject: chip.subject,
          })}
          onClear={() => onChange({ [chip.key]: undefined })}
        />
      ))}
    </div>
  );
}
