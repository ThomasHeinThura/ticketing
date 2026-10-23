import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ActiveFilterChip } from "@/components/board/board-toolbar";
import type { ProjectViewSearch } from "@/lib/project-board-search";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
  type WorkItemFilter,
} from "@/lib/work-item-filter";

/**
 * `VW-34`: the active filter is always visible as removable chips, on every layout. Calendar
 * and Gantt read the URL filter but have no editor of their own, so without these a filtered
 * schedule looks like a project that is missing work.
 */

const FIELD_LABEL_KEYS: Record<string, string> = {
  "state.group": "stateGroup",
  priority: "priority",
  assignee: "assignee",
  watcher: "watcher",
  dueDate: "dueDate",
  createdAt: "createdAt",
  project: "project",
  type: "type",
};

const KNOWN_OPERATORS = new Set([
  "eq",
  "in",
  "contains",
  "lt",
  "lte",
  "gt",
  "gte",
]);

const LEGACY_FACETS = [
  "status",
  "priority",
  "assignee",
  "dueDate",
  "labels",
] as const;

type LegacyFacet = (typeof LEGACY_FACETS)[number];

export type ScheduleFilterChip =
  | {
      kind: "structured";
      id: string;
      clause: Extract<WorkItemFilter, { field: string }>;
      /** The `filter` text that remains when this chip is removed. */
      remaining: string | undefined;
    }
  | { kind: "group"; id: string; text: string; remaining: string | undefined }
  | { kind: "legacy"; id: string; facet: LegacyFacet; count: number };

function isLeaf(
  node: WorkItemFilter,
): node is Extract<WorkItemFilter, { field: string }> {
  return "field" in node;
}

function printOrUndefined(filter: WorkItemFilter | undefined) {
  return filter ? printWorkItemFilterText(filter) : undefined;
}

/** Splits the URL filter into the clauses a person can remove one at a time. */
export function buildScheduleFilterChips(
  search: Pick<ProjectViewSearch, "filter" | LegacyFacet>,
): ScheduleFilterChip[] {
  const chips: ScheduleFilterChip[] = [];
  const text = search.filter?.trim();
  if (text) {
    let parsed: WorkItemFilter | undefined;
    try {
      parsed = parseWorkItemFilterText(text);
    } catch {
      parsed = undefined;
    }
    if (!parsed) {
      // Unparseable text still filters server-side; show it whole so it is never hidden.
      chips.push({
        kind: "group",
        id: "filter:raw",
        text,
        remaining: undefined,
      });
    } else if (isLeaf(parsed)) {
      chips.push({
        kind: "structured",
        id: "filter:0",
        clause: parsed,
        remaining: undefined,
      });
    } else if (parsed.op === "and") {
      parsed.clauses.forEach((clause, index) => {
        const rest = parsed.clauses.filter((_, i) => i !== index);
        const remaining =
          rest.length === 0
            ? undefined
            : printOrUndefined(
                rest.length === 1 ? rest[0] : { op: "and", clauses: rest },
              );
        chips.push(
          isLeaf(clause)
            ? { kind: "structured", id: `filter:${index}`, clause, remaining }
            : {
                kind: "group",
                id: `filter:${index}`,
                text: printWorkItemFilterText(clause),
                remaining,
              },
        );
      });
    } else {
      chips.push({
        kind: "group",
        id: "filter:group",
        text: printWorkItemFilterText(parsed),
        remaining: undefined,
      });
    }
  }
  for (const facet of LEGACY_FACETS) {
    const values = search[facet];
    if (values?.length)
      chips.push({
        kind: "legacy",
        id: `legacy:${facet}`,
        facet,
        count: values.length,
      });
  }
  return chips;
}

type ScheduleFilterChipsProps = {
  search: Pick<ProjectViewSearch, "filter" | LegacyFacet>;
  onChange: (patch: Partial<ProjectViewSearch>) => void;
};

export default function ScheduleFilterChips({
  search,
  onChange,
}: ScheduleFilterChipsProps): JSX.Element | null {
  const { t } = useTranslation();
  const chips = buildScheduleFilterChips(search);
  if (chips.length === 0) return null;

  return (
    <section
      className="flex flex-wrap items-center gap-1.5 border-b border-border/80 px-3 py-2 sm:px-4"
      aria-label={t("workItems:filter.formLabel")}
      data-testid="schedule-filter-chips"
    >
      {chips.map((chip) => {
        if (chip.kind === "structured") {
          const labelKey = FIELD_LABEL_KEYS[chip.clause.field];
          const subject = labelKey
            ? t(`workItems:filter.fields.${labelKey}`)
            : chip.clause.field;
          const operator = KNOWN_OPERATORS.has(chip.clause.op)
            ? t(`workItems:filter.operators.${chip.clause.op}`)
            : chip.clause.op;
          const value = Array.isArray(chip.clause.value)
            ? chip.clause.value.join(", ")
            : chip.clause.value;
          return (
            <ActiveFilterChip
              key={chip.id}
              subject={subject}
              operator={operator}
              value={value}
              clearLabel={t("workItems:filter.removeFilter", {
                field: subject,
              })}
              onClear={() => onChange({ filter: chip.remaining })}
            />
          );
        }
        if (chip.kind === "group") {
          return (
            <ActiveFilterChip
              key={chip.id}
              subject={t("workItems:filter.toggle")}
              operator={t("workItems:filter.match")}
              value={chip.text}
              clearLabel={t("workItems:filter.removeGroup")}
              onClear={() => onChange({ filter: chip.remaining })}
            />
          );
        }
        const subject = t(`tasks:boardFilters.subjects.${chip.facet}`);
        return (
          <ActiveFilterChip
            key={chip.id}
            subject={subject}
            operator={t("tasks:boardFilters.operators.isAnyOf")}
            value={t("tasks:boardFilters.selectedCount", { count: chip.count })}
            clearLabel={t("workItems:filter.removeFilter", { field: subject })}
            onClear={() => onChange({ [chip.facet]: undefined })}
          />
        );
      })}
    </section>
  );
}
