import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { SortConfig, SortDirection, SortField } from "@/lib/sort-tasks";

type SortControlMenuProps = {
  sort: SortConfig;
  fields?: readonly SortField[];
  onSortChange: (sort: SortConfig) => void;
};

function CheckSlot({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background"
      }`}
    >
      {checked ? "\u2713" : null}
    </span>
  );
}

export default function SortControlMenu({
  sort,
  fields,
  onSortChange,
}: SortControlMenuProps) {
  const { t } = useTranslation();
  const sortFields: readonly SortField[] = [
    "position",
    "createdAt",
    "priority",
    "dueDate",
    "title",
    "number",
  ];
  const availableFields = fields
    ? sortFields.filter((field) => fields.includes(field))
    : sortFields;
  const isActive = sort.field !== "position";
  const handleFieldChange = (field: SortField) => {
    if (field === "position" || field === sort.field) {
      const resetField = availableFields.includes("position")
        ? "position"
        : (availableFields.find((entry) => entry === "number") ?? sort.field);
      onSortChange({ field: resetField, direction: "asc" });
    } else {
      const defaultDirection: SortDirection =
        field === "priority" ? "desc" : "asc";
      onSortChange({ field, direction: defaultDirection });
    }
  };

  return (
    <DropdownMenuContent className="w-48" align="start">
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
          {t("tasks:sort.by")}
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      {availableFields.map((field) => (
        <DropdownMenuItem
          key={field}
          onClick={() => handleFieldChange(field)}
          className="h-8 rounded-md text-sm"
        >
          <CheckSlot checked={sort.field === field} />
          {t(`tasks:sort.fields.${field}`)}
        </DropdownMenuItem>
      ))}

      {isActive && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
              {t("tasks:sort.direction")}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => onSortChange({ ...sort, direction: "asc" })}
            className="h-8 rounded-md text-sm"
          >
            <CheckSlot checked={sort.direction === "asc"} />
            {t("tasks:sort.ascending")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onSortChange({ ...sort, direction: "desc" })}
            className="h-8 rounded-md text-sm"
          >
            <CheckSlot checked={sort.direction === "desc"} />
            {t("tasks:sort.descending")}
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );
}
