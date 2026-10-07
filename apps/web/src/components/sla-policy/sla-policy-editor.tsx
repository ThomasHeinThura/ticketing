import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@taskdesk/ui";
import { ArrowLeft, RefreshCw, Save, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import type {
  SlaPolicy,
  SlaPolicyGoal,
  SlaPolicyInput,
} from "@/fetchers/sla-policy";
import { useCreateSlaPolicy } from "@/hooks/mutations/sla-policy/use-create-sla-policy";
import { usePublishSlaPolicy } from "@/hooks/mutations/sla-policy/use-publish-sla-policy";
import { useUpdateSlaPolicy } from "@/hooks/mutations/sla-policy/use-update-sla-policy";
import { useServiceCalendars } from "@/hooks/queries/service-calendar/use-service-calendars";
import { useSlaPolicy } from "@/hooks/queries/sla-policy/use-sla-policy";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";

const METRICS = ["first_response", "resolution"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const MAX_TARGET_MINUTES = 2_147_483_647;
type Metric = (typeof METRICS)[number];
type Priority = (typeof PRIORITIES)[number];
type TargetInput = Record<string, string>;

function goalKey(typeId: string, metric: Metric, priority: Priority) {
  return `${typeId}\u0000${metric}\u0000${priority}`;
}

function goalsToInputs(goals: SlaPolicyGoal[]): TargetInput {
  return Object.fromEntries(
    goals.map((goal) => [
      goalKey(goal.workItemTypeId, goal.metric, goal.priority),
      String(goal.targetMinutes),
    ]),
  );
}

function makeGoals(typeIds: string[], values: TargetInput): SlaPolicyGoal[] {
  const goals: SlaPolicyGoal[] = [];
  for (const typeId of typeIds) {
    for (const metric of METRICS) {
      for (const priority of PRIORITIES) {
        const value = values[goalKey(typeId, metric, priority)]?.trim();
        if (!value) continue;
        const targetMinutes = Number(value);
        if (
          Number.isInteger(targetMinutes) &&
          targetMinutes > 0 &&
          targetMinutes <= MAX_TARGET_MINUTES
        ) {
          goals.push({
            metric,
            workItemTypeId: typeId,
            priority,
            targetMinutes,
          });
        }
      }
    }
  }
  return goals;
}

function sourceVersion(policy: SlaPolicy | undefined) {
  return policy?.draftVersion ?? policy?.activeVersion ?? null;
}

export function SlaPolicyEditor({ id }: { id: string }) {
  const { t } = useTranslation("slaPolicies");
  const navigate = useNavigate();
  const isNew = id === "new";
  const { data: workspace } = useActiveWorkspace();
  const {
    data: policy,
    isLoading,
    isError,
    refetch,
  } = useSlaPolicy(id, !isNew);
  const { data: calendars, isLoading: calendarsLoading } = useServiceCalendars(
    workspace?.id ?? "",
  );
  const {
    data: types,
    isLoading: typesLoading,
    isError: typesError,
  } = useGetWorkItemTypes({ workspaceId: workspace?.id });
  const { canManageServiceCalendars, isCheckingPermissions } =
    useWorkspacePermission(workspace?.id ?? null);
  const canManage = canManageServiceCalendars();
  const createPolicy = useCreateSlaPolicy(workspace?.id ?? "");
  const updatePolicy = useUpdateSlaPolicy();
  const publishPolicy = usePublishSlaPolicy();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [threshold, setThreshold] = useState("75");
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<TargetInput>({});
  const [conflict, setConflict] = useState(false);
  const hydratedPolicyId = useRef<string | null>(null);
  const loading = !isNew && isLoading;
  const saving = createPolicy.isPending || updatePolicy.isPending;
  const publishing = publishPolicy.isPending;
  const hasInvalidTarget = selectedTypeIds.some((typeId) =>
    METRICS.some((metric) =>
      PRIORITIES.some((priority) => {
        const value = targets[goalKey(typeId, metric, priority)]?.trim();
        if (!value) return false;
        const target = Number(value);
        return (
          !Number.isInteger(target) || target < 1 || target > MAX_TARGET_MINUTES
        );
      }),
    ),
  );
  const canSubmit = Boolean(
    canManage &&
      !isCheckingPermissions &&
      !hasInvalidTarget &&
      name.trim() &&
      calendarId &&
      Number.isInteger(Number(threshold)) &&
      Number(threshold) >= 1 &&
      Number(threshold) <= 99,
  );
  const draft = sourceVersion(policy);
  const hasIncompleteTarget =
    makeGoals(selectedTypeIds, targets).length !== selectedTypeIds.length * 8;

  const hydrate = useCallback((nextPolicy: SlaPolicy) => {
    const version = sourceVersion(nextPolicy);
    setName(nextPolicy.name);
    setDescription(nextPolicy.description ?? "");
    setCalendarId(version?.calendarId ?? "");
    setThreshold(String(version?.atRiskThresholdPct ?? 75));
    setTargets(goalsToInputs(version?.goals ?? []));
    setSelectedTypeIds([
      ...new Set((version?.goals ?? []).map((goal) => goal.workItemTypeId)),
    ]);
  }, []);

  useEffect(() => {
    if (isNew || !policy || hydratedPolicyId.current === policy.id) return;
    hydratedPolicyId.current = policy.id;
    hydrate(policy);
  }, [hydrate, isNew, policy]);

  async function reloadLatest() {
    const result = await refetch();
    if (result.data) hydrate(result.data);
    setConflict(false);
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const data: SlaPolicyInput = {
      name: name.trim(),
      description: description.trim() || null,
      calendarId,
      atRiskThresholdPct: Number(threshold),
      goals: makeGoals(selectedTypeIds, targets),
    };
    try {
      if (isNew) {
        if (!workspace?.id) return;
        const created = await createPolicy.mutateAsync(data);
        toast.success(t("editor.saved"));
        await navigate({
          to: routes.slaPolicyEditor.path,
          params: { id: created.id },
          replace: true,
        });
      } else if (policy) {
        await updatePolicy.mutateAsync({
          id: policy.id,
          version: policy.version,
          data,
        });
        setConflict(false);
        toast.success(t("editor.saved"));
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) setConflict(true);
      toast.error(t("editor.saveError"));
    }
  }

  async function publishDraft() {
    if (
      !policy ||
      !draft ||
      hasIncompleteTarget ||
      selectedTypeIds.length === 0
    )
      return;
    try {
      await publishPolicy.mutateAsync({
        id: policy.id,
        version: policy.version,
      });
      setConflict(false);
      toast.success(t("editor.published"));
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) setConflict(true);
      toast.error(t("editor.publishError"));
    }
  }

  function toggleType(typeId: string, checked: boolean | "indeterminate") {
    setSelectedTypeIds((current) =>
      checked
        ? current.includes(typeId)
          ? current
          : [...current, typeId]
        : current.filter((idValue) => idValue !== typeId),
    );
    if (!checked) {
      setTargets((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([key]) => !key.startsWith(`${typeId}\u0000`),
          ),
        ),
      );
    }
  }

  if (loading) {
    return (
      <main className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title={t("editor.title")} />
        <div role="status" aria-label={t("editor.loading")}>
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="mt-4 h-72 w-full" />
        </div>
      </main>
    );
  }

  if (!isNew && (isError || !policy)) {
    return (
      <main className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title={t("editor.title")} />
        <Alert variant="error">
          <AlertTitle>{t("editor.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("editor.loadError")}
            <Button className="w-fit" onClick={() => void refetch()}>
              <RefreshCw aria-hidden="true" />
              {t("list.retry")}
            </Button>
            <Button
              className="w-fit"
              variant="outline"
              render={<Link to={routes.slaPolicies.path} />}
            >
              {t("editor.back")}
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <>
      <PageTitle
        title={
          isNew ? t("editor.newTitle") : (policy?.name ?? t("editor.title"))
        }
      />
      <main className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Button
              variant="ghost"
              render={<Link to={routes.slaPolicies.path} />}
            >
              <ArrowLeft aria-hidden="true" />
              {t("editor.back")}
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">
                {isNew ? t("editor.newTitle") : policy?.name}
              </h1>
              {policy ? (
                <p className="text-sm text-muted-foreground">
                  {policy.activeVersion
                    ? t("list.active", { version: policy.activeVersion.number })
                    : t("list.unpublished")}
                </p>
              ) : null}
            </div>
          </div>
          {policy?.draftVersion ? (
            <Button
              onClick={() => void publishDraft()}
              disabled={
                !canManage ||
                !selectedTypeIds.length ||
                hasIncompleteTarget ||
                saving ||
                publishing
              }
            >
              <Send aria-hidden="true" />
              {publishing ? t("editor.publishing") : t("editor.publish")}
            </Button>
          ) : null}
        </div>

        {!canManage && !isCheckingPermissions ? (
          <Alert variant="info">
            <AlertTitle>{t("list.readOnlyTitle")}</AlertTitle>
            <AlertDescription>{t("list.readOnlyDescription")}</AlertDescription>
          </Alert>
        ) : null}

        {conflict ? (
          <Alert variant="error">
            <AlertTitle>{t("editor.conflictTitle")}</AlertTitle>
            <AlertDescription>
              {t("editor.conflict")}
              <Button
                className="w-fit"
                variant="outline"
                onClick={() => void reloadLatest()}
              >
                <RefreshCw aria-hidden="true" />
                {t("editor.reload")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={saveDraft} className="flex flex-col gap-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>{t("editor.detailsTitle")}</CardTitle>
              <CardDescription>{t("editor.draftHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field className="bg-card">
                <FieldLabel htmlFor="sla-policy-name">
                  {t("editor.name")}
                </FieldLabel>
                <Input
                  id="sla-policy-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  required
                  disabled={!canManage || isCheckingPermissions}
                />
              </Field>
              <Field className="bg-card">
                <FieldLabel htmlFor="sla-policy-description">
                  {t("editor.description")}
                </FieldLabel>
                <Textarea
                  id="sla-policy-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2_000}
                  disabled={!canManage || isCheckingPermissions}
                />
              </Field>
              <Field className="bg-card">
                <FieldLabel htmlFor="sla-policy-calendar">
                  {t("editor.calendar")}
                </FieldLabel>
                <Select
                  value={calendarId || null}
                  onValueChange={(value) => setCalendarId(value ?? "")}
                  disabled={!canManage || calendarsLoading}
                >
                  <SelectTrigger id="sla-policy-calendar" className="w-full">
                    <SelectValue
                      placeholder={t("editor.calendarPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(calendars?.data ?? []).map((calendar) => (
                      <SelectItem key={calendar.id} value={calendar.id}>
                        {calendar.name} · {calendar.timezone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="bg-card">
                <FieldLabel htmlFor="sla-policy-threshold">
                  {t("editor.threshold")}
                </FieldLabel>
                <Input
                  id="sla-policy-threshold"
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                  disabled={!canManage || isCheckingPermissions}
                />
              </Field>
              <fieldset className="flex flex-col items-start gap-2 sm:col-span-2">
                <legend className="font-medium text-foreground text-sm/4.5">
                  {t("editor.types")}
                </legend>
                <p className="text-muted-foreground text-xs">
                  {t("editor.typesHelp")}
                </p>
                {typesLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : typesError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {t("editor.typesError")}
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(types ?? []).map((type) => (
                      <Label
                        key={type.id}
                        className="flex items-center gap-2 rounded-md border border-border p-3"
                      >
                        <Checkbox
                          checked={selectedTypeIds.includes(type.id)}
                          onCheckedChange={(checked) =>
                            toggleType(type.id, checked)
                          }
                          disabled={!canManage || isCheckingPermissions}
                          aria-label={type.name}
                        />
                        <span>{type.name}</span>
                      </Label>
                    ))}
                  </div>
                )}
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("editor.goals")}</CardTitle>
              <CardDescription>{t("editor.publishHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {selectedTypeIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("editor.noTypes")}
                </p>
              ) : (
                selectedTypeIds.map((typeId) => {
                  const type = types?.find((item) => item.id === typeId);
                  return (
                    <section
                      key={typeId}
                      className="space-y-4 rounded-lg border border-border p-4"
                      aria-label={type?.name ?? typeId}
                    >
                      <h3 className="font-medium">{type?.name ?? typeId}</h3>
                      {METRICS.map((metric) => (
                        <div key={metric} className="space-y-2">
                          <h4 className="text-sm font-medium">
                            {t(`editor.metrics.${metric}`)}
                          </h4>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {PRIORITIES.map((priority) => {
                              const inputId = `sla-goal-${typeId}-${metric}-${priority}`;
                              const value =
                                targets[goalKey(typeId, metric, priority)] ??
                                "";
                              const numericValue = Number(value);
                              const invalid = Boolean(
                                value.trim() &&
                                  (!Number.isInteger(numericValue) ||
                                    numericValue < 1 ||
                                    numericValue > MAX_TARGET_MINUTES),
                              );
                              return (
                                <Field key={priority} className="bg-card">
                                  <FieldLabel htmlFor={inputId}>
                                    {t(`editor.priorities.${priority}`)}
                                  </FieldLabel>
                                  <Input
                                    id={inputId}
                                    type="number"
                                    min={1}
                                    max={MAX_TARGET_MINUTES}
                                    step={1}
                                    inputMode="numeric"
                                    value={value}
                                    onChange={(event) =>
                                      setTargets((current) => ({
                                        ...current,
                                        [goalKey(typeId, metric, priority)]:
                                          event.target.value,
                                      }))
                                    }
                                    disabled={
                                      !canManage || isCheckingPermissions
                                    }
                                    aria-describedby="sla-goal-unit"
                                    aria-invalid={invalid}
                                  />
                                  {invalid ? (
                                    <FieldError>
                                      {t("editor.invalidTarget")}
                                    </FieldError>
                                  ) : null}
                                </Field>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </section>
                  );
                })
              )}
              <p id="sla-goal-unit" className="text-xs text-muted-foreground">
                {t("editor.targetUnit")}
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!canSubmit || saving || publishing}>
              <Save aria-hidden="true" />
              {saving ? t("editor.saving") : t("editor.save")}
            </Button>
            {hasInvalidTarget ? (
              <p className="text-destructive text-xs" role="alert">
                {t("editor.invalidTarget")}
              </p>
            ) : policy?.draftVersion && selectedTypeIds.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                {hasIncompleteTarget
                  ? t("editor.incomplete")
                  : t("editor.readyToPublish")}
              </p>
            ) : null}
          </div>
        </form>
      </main>
    </>
  );
}
