import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { ChevronLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import type { CustomQueryInput } from "@/fetchers/report";
import {
  createSavedView,
  getSavedView,
  getShareableViewTeams,
  updateSavedView,
} from "@/fetchers/saved-views";
import { useCustomFields } from "@/hooks/queries/custom-field/use-custom-fields";
import { reportKeys, useCustomPreview } from "@/hooks/queries/report";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { ReportBuilderSearch } from "@/lib/report-search";
import { routes } from "@/lib/routes";
import { savedViewKeys } from "@/lib/saved-view-keys";
import { toast } from "@/lib/toast";
import { ReportError } from "./report-detail";
import {
  ReportContextLine,
  ReportEmpty,
  ReportMetrics,
  ReportNotes,
  ReportVisual,
} from "./report-view";

type Entity = CustomQueryInput["entity"];
type ChartType = "bar" | "line" | "table" | "number";
type Visibility = "private" | "team" | "workspace";

const ITEM_GROUPS = [
  "project",
  "assignee",
  "type",
  "priority",
  "state",
  "week",
];
const TIME_GROUPS = ["project", "person", "activity", "week"];
const WINDOWS = ["7", "30", "60", "90"] as const;
const NONE = "__none__";

function Pick({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id={id} className="w-52">
          <SelectValue>{chosen?.label ?? ""}</SelectValue>
        </SelectTrigger>
        <SelectContent>
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

/**
 * `docs/screens.md` "Report builder" (tier 3): pick an entity, narrow it, group by, aggregate and
 * choose a chart, with a live preview. A saved result is a saved view with the `chart` layout:
 * one endpoint saves every report, not one per tier.
 */
export function ReportBuilder({ search }: { search: ReportBuilderSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const fields = useCustomFields(workspaceId);
  const [name, setName] = useState("");
  const [entity, setEntity] = useState<Entity>("work_item");
  const [groupBy, setGroupBy] = useState("priority");
  const [measure, setMeasure] = useState<"count" | "sum">("count");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>("30");
  const [priority, setPriority] = useState(NONE);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [teamId, setTeamId] = useState("");

  const existing = useQuery({
    queryKey: savedViewKeys.detail(user?.id, search.view ?? ""),
    queryFn: () => getSavedView(search.view ?? ""),
    enabled: Boolean(search.view),
  });
  const teams = useQuery({
    queryKey: savedViewKeys.teamAudiences(workspaceId, user?.id),
    queryFn: () => getShareableViewTeams(workspaceId),
    enabled: Boolean(workspaceId),
  });

  // A saved report opens with its own definition, once.
  const loadedId = existing.data?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: load the stored definition once per view
  useEffect(() => {
    const view = existing.data;
    if (!view) return;
    const stored = (view.query ?? {}) as Partial<CustomQueryInput> & {
      filter?: Record<string, string>;
    };
    setName(view.name);
    setEntity(stored.entity === "time_entry" ? "time_entry" : "work_item");
    setGroupBy(stored.groupBy ?? "");
    setMeasure(stored.aggregate?.fn === "sum" ? "sum" : "count");
    const storedWindow = stored.filter?.window;
    setWindow(WINDOWS.find((candidate) => candidate === storedWindow) ?? "30");
    setPriority(stored.filter?.priority ?? NONE);
    setVisibility(view.visibility as Visibility);
    setTeamId(view.sharedWithTeamId ?? "");
  }, [loadedId]);

  const groups = (entity === "work_item" ? ITEM_GROUPS : TIME_GROUPS).map(
    (value) => ({ value, label: t(`reports:builder.groups.${value}`) }),
  );
  const fieldGroups =
    entity === "work_item"
      ? (fields.data?.data ?? [])
          .filter((field) => field.deletedAt === null)
          .map((field) => ({ value: `field:${field.id}`, label: field.name }))
      : [];
  const groupOptions = [
    { value: "", label: t("reports:builder.groups.none") },
    ...groups,
    ...fieldGroups,
  ];
  const effectiveGroup = groupOptions.some((option) => option.value === groupBy)
    ? groupBy
    : "";

  const query: CustomQueryInput = {
    entity,
    filter: {
      window,
      ...(priority !== NONE && entity === "work_item" ? { priority } : {}),
    },
    ...(effectiveGroup ? { groupBy: effectiveGroup } : {}),
    aggregate:
      entity === "time_entry" && measure === "sum"
        ? { fn: "sum", field: "minutes" }
        : { fn: "count" },
  };
  const preview = useCustomPreview(workspaceId, {
    ...(name.trim() ? { name: name.trim() } : {}),
    query,
    chartType,
  });
  const save = useMutation({
    mutationFn: async () => {
      const shared =
        visibility === "team" && teamId ? { sharedWithTeamId: teamId } : {};
      if (search.view && existing.data)
        return updateSavedView({
          id: search.view,
          name: name.trim(),
          visibility,
          sharedWithTeamId: visibility === "team" ? teamId : null,
          layout: "chart",
          query,
        });
      return createSavedView({
        workspaceId,
        name: name.trim(),
        scope: "workspace",
        scopeId: workspaceId,
        visibility,
        ...shared,
        layout: "chart",
        query,
      });
    },
    onSuccess: async (view) => {
      await queryClient.invalidateQueries({ queryKey: savedViewKeys.all });
      await queryClient.invalidateQueries({
        queryKey: reportKeys.all(workspaceId),
      });
      toast.success(t("reports:builder.saved"));
      void navigate({
        to: routes.reportBuilder.path,
        search: { view: view.id },
        replace: true,
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const timeOnly = entity === "time_entry";
  return (
    <>
      <PageTitle title={t("reports:builder.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-1">
          <Link
            to={routes.reports.path}
            className="inline-flex items-center gap-1 rounded-sm text-muted-foreground text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {t("reports:detail.back")}
          </Link>
          <h1 className="font-semibold text-2xl">
            {t("reports:builder.title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            {t("reports:builder.description")}
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 p-4">
            <div className="space-y-1">
              <Label htmlFor="builder-name">{t("reports:builder.name")}</Label>
              <Input
                id="builder-name"
                className="w-64"
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Pick
              id="builder-entity"
              label={t("reports:builder.entity")}
              value={entity}
              options={[
                {
                  value: "work_item",
                  label: t("reports:builder.entities.work_item"),
                },
                {
                  value: "time_entry",
                  label: t("reports:builder.entities.time_entry"),
                },
              ]}
              onChange={(next) => {
                setEntity(next === "time_entry" ? "time_entry" : "work_item");
                setGroupBy("");
                setMeasure("count");
              }}
            />
            <Pick
              id="builder-group"
              label={t("reports:builder.groupBy")}
              value={effectiveGroup}
              options={groupOptions}
              onChange={setGroupBy}
            />
            {timeOnly ? (
              <Pick
                id="builder-measure"
                label={t("reports:builder.measure")}
                value={measure}
                options={[
                  {
                    value: "count",
                    label: t("reports:builder.measures.count"),
                  },
                  { value: "sum", label: t("reports:builder.measures.sum") },
                ]}
                onChange={(next) =>
                  setMeasure(next === "sum" ? "sum" : "count")
                }
              />
            ) : null}
            <div className="space-y-1">
              <Label id="builder-window-label">
                {t("reports:filters.window")}
              </Label>
              <ToggleGroup
                aria-labelledby="builder-window-label"
                value={[window]}
                onValueChange={(values) => {
                  const next = WINDOWS.find(
                    (candidate) => candidate === values[values.length - 1],
                  );
                  if (next) setWindow(next);
                }}
              >
                {WINDOWS.map((candidate) => (
                  <ToggleGroupItem key={candidate} value={candidate}>
                    {t("reports:filters.days", { count: Number(candidate) })}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {entity === "work_item" ? (
              <Pick
                id="builder-priority"
                label={t("reports:filters.priority")}
                value={priority}
                options={[
                  { value: NONE, label: t("reports:filters.allPriorities") },
                  ...(["low", "medium", "high", "urgent"] as const).map(
                    (value) => ({
                      value,
                      label: t(`reports:priorities.${value}`),
                    }),
                  ),
                ]}
                onChange={setPriority}
              />
            ) : null}
            <div className="space-y-1">
              <Label id="builder-chart-label">
                {t("reports:builder.chartType")}
              </Label>
              <ToggleGroup
                aria-labelledby="builder-chart-label"
                value={[chartType]}
                onValueChange={(values) => {
                  const next = (
                    ["bar", "line", "table", "number"] as const
                  ).find(
                    (candidate) => candidate === values[values.length - 1],
                  );
                  if (next) setChartType(next);
                }}
              >
                {(["bar", "line", "table", "number"] as const).map(
                  (candidate) => (
                    <ToggleGroupItem key={candidate} value={candidate}>
                      {t(`reports:builder.chartTypes.${candidate}`)}
                    </ToggleGroupItem>
                  ),
                )}
              </ToggleGroup>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4" aria-live="polite">
          {preview.isLoading || !workspace ? (
            <Skeleton className="h-48 w-full" />
          ) : preview.isError || !preview.data ? (
            <ReportError error={preview.error} />
          ) : (
            <>
              <ReportContextLine report={preview.data} />
              <ReportMetrics
                metrics={preview.data.metrics}
                empty={preview.data.empty !== null}
              />
              <ReportNotes notes={preview.data.notes} />
              <ReportEmpty report={preview.data} />
              <ReportVisual
                report={preview.data}
                view={
                  chartType === "table" || chartType === "number"
                    ? "table"
                    : "chart"
                }
              />
            </>
          )}
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 p-4">
            <Pick
              id="builder-visibility"
              label={t("reports:builder.visibility")}
              value={visibility}
              options={[
                {
                  value: "private",
                  label: t("reports:builder.visibilities.private"),
                },
                {
                  value: "team",
                  label: t("reports:builder.visibilities.team"),
                },
                {
                  value: "workspace",
                  label: t("reports:builder.visibilities.workspace"),
                },
              ]}
              onChange={(next) =>
                setVisibility(
                  next === "team" || next === "workspace" ? next : "private",
                )
              }
            />
            {visibility === "team" ? (
              <Pick
                id="builder-team"
                label={t("reports:builder.team")}
                value={teamId}
                options={(teams.data ?? []).map((team) => ({
                  value: team.id,
                  label: team.name,
                }))}
                onChange={setTeamId}
              />
            ) : null}
            <Button
              disabled={
                save.isPending ||
                !name.trim() ||
                !workspace ||
                (visibility === "team" && !teamId)
              }
              onClick={() => save.mutate()}
            >
              <Save aria-hidden="true" />
              {search.view
                ? t("reports:builder.update")
                : t("reports:builder.save")}
            </Button>
            {save.error ? (
              <Alert variant="error" className="w-full">
                <AlertDescription>{save.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
