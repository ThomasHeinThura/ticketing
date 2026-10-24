import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { ReportEnvelope } from "@/fetchers/report";
import useCustomerOrganisations from "@/hooks/queries/project/use-customer-organisations";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useTeams } from "@/hooks/queries/team/use-teams";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import {
  REPORT_PRIORITIES,
  REPORT_WINDOWS,
  type ReportSearch,
} from "@/lib/report-search";

const ALL = "__all__";

type Option = { value: string; label: string };

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
  allLabel,
  allowAll = true,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: Option[];
  onChange: (value: string | undefined) => void;
  allLabel: string;
  /** A report option always has a value; only a filter can be "all". */
  allowAll?: boolean;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? ALL}
        onValueChange={(next) =>
          onChange(next && next !== ALL ? next : undefined)
        }
      >
        <SelectTrigger id={id} className="w-44">
          <SelectValue>{chosen?.label ?? allLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowAll ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const FILTER_KEYS = [
  "projectId",
  "organisationId",
  "teamId",
  "typeId",
  "priority",
] as const;

/**
 * `RP-7`, `RP-8`: window, project, organisation, team, type and priority, plus the options of the
 * report itself. Every change is written to the URL by the caller, never held here.
 */
export function ReportFilters({
  workspaceId,
  search,
  onChange,
  live,
  choices,
}: {
  workspaceId: string;
  search: ReportSearch;
  onChange: (next: ReportSearch) => void;
  /** The report is always now: the window does not apply. */
  live: boolean;
  choices: ReportEnvelope["choices"];
}) {
  const { t } = useTranslation();
  const projects = useGetProjects({ workspaceId });
  const organisations = useCustomerOrganisations({ workspaceId });
  const teams = useTeams(workspaceId);
  const types = useGetWorkItemTypes({ workspaceId });
  const windowValue = search.window ?? "30";
  const active = FILTER_KEYS.some((key) => search[key]);
  return (
    <div
      className="flex flex-wrap items-end gap-4"
      data-testid="report-filters"
    >
      <div className="space-y-1">
        <Label id="report-window-label">{t("reports:filters.window")}</Label>
        <ToggleGroup
          aria-labelledby="report-window-label"
          value={[windowValue]}
          disabled={live}
          onValueChange={(values) => {
            const next = REPORT_WINDOWS.find(
              (candidate) => candidate === values[values.length - 1],
            );
            if (!next) return;
            const { from: _from, to: _to, ...rest } = search;
            onChange({ ...rest, window: next });
          }}
        >
          {REPORT_WINDOWS.map((candidate) => (
            <ToggleGroupItem key={candidate} value={candidate}>
              {candidate === "custom"
                ? t("reports:filters.custom")
                : t("reports:filters.days", { count: Number(candidate) })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {windowValue === "custom" && !live ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="report-from">{t("reports:filters.from")}</Label>
            <Input
              id="report-from"
              type="date"
              className="w-40"
              value={search.from ?? ""}
              onChange={(event) =>
                onChange({ ...search, from: event.target.value || undefined })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-to">{t("reports:filters.to")}</Label>
            <Input
              id="report-to"
              type="date"
              className="w-40"
              value={search.to ?? ""}
              onChange={(event) =>
                onChange({ ...search, to: event.target.value || undefined })
              }
            />
          </div>
        </>
      ) : null}
      <FilterSelect
        id="report-project"
        label={t("reports:filters.project")}
        allLabel={t("reports:filters.allProjects")}
        value={search.projectId}
        options={(projects.data ?? []).map((project) => ({
          value: project.id,
          label: project.name,
        }))}
        onChange={(projectId) => onChange({ ...search, projectId })}
      />
      <FilterSelect
        id="report-organisation"
        label={t("reports:filters.organisation")}
        allLabel={t("reports:filters.allOrganisations")}
        value={search.organisationId}
        options={(organisations.data ?? []).map((organisation) => ({
          value: organisation.id,
          label: organisation.name,
        }))}
        onChange={(organisationId) => onChange({ ...search, organisationId })}
      />
      <FilterSelect
        id="report-team"
        label={t("reports:filters.team")}
        allLabel={t("reports:filters.allTeams")}
        value={search.teamId}
        options={(teams.data ?? []).map((team) => ({
          value: team.id,
          label: team.name,
        }))}
        onChange={(teamId) => onChange({ ...search, teamId })}
      />
      <FilterSelect
        id="report-type"
        label={t("reports:filters.type")}
        allLabel={t("reports:filters.allTypes")}
        value={search.typeId}
        options={(types.data ?? []).map((type) => ({
          value: type.id,
          label: type.name,
        }))}
        onChange={(typeId) => onChange({ ...search, typeId })}
      />
      <FilterSelect
        id="report-priority"
        label={t("reports:filters.priority")}
        allLabel={t("reports:filters.allPriorities")}
        value={search.priority}
        options={REPORT_PRIORITIES.map((priority) => ({
          value: priority,
          label: t(`reports:priorities.${priority}`),
        }))}
        onChange={(priority) =>
          onChange({
            ...search,
            priority: priority as ReportSearch["priority"],
          })
        }
      />
      {choices.map((choice) => (
        <FilterSelect
          key={choice.key}
          id={`report-option-${choice.key}`}
          label={t(`reports:options.${choice.key}.label`, {
            defaultValue: choice.key,
          })}
          allLabel={choice.values[0]?.label ?? ""}
          allowAll={false}
          value={choice.selected ?? undefined}
          options={choice.values.map((entry) => ({
            value: entry.value,
            label: t(`reports:options.${choice.key}.${entry.value}`, {
              defaultValue: entry.label,
            }),
          }))}
          onChange={(value) =>
            onChange({ ...search, [choice.key]: value } as ReportSearch)
          }
        />
      ))}
      {active ? (
        <Button
          variant="ghost"
          onClick={() => {
            const next: ReportSearch = { ...search };
            for (const key of FILTER_KEYS) delete next[key];
            onChange(next);
          }}
        >
          {t("reports:filters.clear")}
        </Button>
      ) : null}
    </div>
  );
}
