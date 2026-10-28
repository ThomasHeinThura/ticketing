import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Label,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { FlaskConical, History, Pencil, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  type Automation,
  type AutomationScope,
  createAutomation,
  listAutomations,
  setAutomationEnabled,
  updateAutomation,
} from "@/fetchers/automation/automations";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { AutomationDryRunDialog } from "./automation-dry-run-dialog";
import { AutomationEditorDialog } from "./automation-editor-dialog";
import type { draftToInput } from "./automation-model";
import { AutomationRunsDialog } from "./automation-runs-dialog";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type Dialog =
  | { kind: "edit"; rule: Automation | null }
  | { kind: "dry-run"; rule: Automation }
  | { kind: "runs"; rule: Automation }
  | null;

function RuleCard({
  rule,
  canManage,
  busy,
  onToggle,
  onOpen,
}: {
  rule: Automation;
  canManage: boolean;
  busy: boolean;
  onToggle: (rule: Automation, enabled: boolean) => void;
  onOpen: (dialog: NonNullable<Dialog>) => void;
}) {
  const { t } = useTranslation("automations");
  const switchId = `automation-enabled-${rule.id}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate">{rule.name}</span>
          <Badge variant={rule.enabled ? "success" : "secondary"}>
            {rule.enabled ? t("list.enabled") : t("list.disabled")}
          </Badge>
          {rule.flaggedReason ? (
            <Badge variant="warning">
              {t(`flags.${rule.flaggedReason}`, {
                defaultValue: t("flags.unknown"),
              })}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {t("list.summary", {
            trigger: t(`triggers.${rule.trigger}`, {
              defaultValue: rule.trigger,
            }),
            conditions: rule.conditions.length,
            actions: rule.actions.length,
          })}
        </CardDescription>
        <CardAction className="shrink-0">
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              checked={rule.enabled}
              disabled={!canManage || busy}
              onCheckedChange={(checked) => onToggle(rule, checked)}
            />
            <Label htmlFor={switchId} className="text-xs font-normal">
              {rule.enabled ? t("list.enabled") : t("list.enable")}
            </Label>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0">
        <p className="text-xs text-muted-foreground">
          {t("list.runAs", { role: rule.effectiveRoleName ?? "-" })}
          {" · "}
          {rule.lastRunAt
            ? t("list.lastRun", { when: formatRelativeTime(rule.lastRunAt) })
            : t("list.neverRun")}
          {" · "}
          {t("list.fired", { count: rule.fireCount })}
        </p>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen({ kind: "runs", rule })}
          >
            <History aria-hidden="true" />
            {t("list.history")}
          </Button>
          {canManage ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpen({ kind: "dry-run", rule })}
              >
                <FlaskConical aria-hidden="true" />
                {t("list.dryRun")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("list.editNamed", { name: rule.name })}
                onClick={() => onOpen({ kind: "edit", rule })}
              >
                <Pencil aria-hidden="true" />
                {t("list.edit")}
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The rule list shared by the workspace screen (`/agent/settings/automations`) and the project
 * screen (Kaneo project settings, `/agent/projects/{key}/settings/automations`). A rule list with
 * enabled state, last run and fire count; the editor, dry-run and run history open as dialogs
 * over the list, as the work item templates screen does.
 */
export function AutomationRulesPanel({
  scope,
  workspaceId,
  projectId,
  canManage,
  title,
  description,
}: {
  scope: AutomationScope;
  workspaceId: string;
  /** Project rules only: the roster project for people pickers. */
  projectId: string | null;
  canManage: boolean;
  title: string;
  description: string;
}) {
  const { t } = useTranslation("automations");
  const cache = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const scopeKey =
    scope.kind === "workspace" ? scope.workspaceId : scope.projectKey;
  const queryKey = ["automations", scope.kind, scopeKey];
  const query = useQuery({
    queryKey,
    queryFn: () => listAutomations(scope),
  });
  // The whole family, so a rule created or switched here also refreshes the other scope's list.
  const refresh = () =>
    cache.invalidateQueries({ queryKey: ["automations"], refetchType: "all" });

  const save = useMutation({
    mutationFn: async ({
      rule,
      input,
    }: {
      rule: Automation | null;
      input: ReturnType<typeof draftToInput>;
    }) =>
      rule
        ? updateAutomation(rule.id, { ...input, version: rule.version })
        : createAutomation(scope, input),
    onSuccess: async (saved, variables) => {
      await refresh();
      setDialog(null);
      toast.success(
        variables.rule
          ? saved.enabled
            ? t("toast.saved")
            : t("toast.savedDisabled")
          : t("toast.created"),
      );
    },
  });
  const toggle = useMutation({
    mutationFn: ({ rule, enabled }: { rule: Automation; enabled: boolean }) =>
      setAutomationEnabled(rule.id, enabled, rule.version),
    onSuccess: async (rule) => {
      await refresh();
      toast.success(rule.enabled ? t("toast.enabled") : t("toast.disabled"));
    },
    onError: (error) => toast.error(errorText(error, t("toast.toggleFailed"))),
  });

  const rules = query.data?.data ?? [];
  const meta = query.data?.meta;
  return (
    <>
      <PageTitle title={title} />
      <div className="flex w-full min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          </div>
          {canManage && query.data ? (
            <Button
              disabled={
                !meta?.featureEnabled || meta.assignableRoles.length === 0
              }
              onClick={() => {
                save.reset();
                setDialog({ kind: "edit", rule: null });
              }}
            >
              <Plus aria-hidden="true" />
              {t("list.new")}
            </Button>
          ) : null}
        </div>
        {!canManage ? (
          <Alert variant="info">
            <AlertTitle>{t("list.readOnlyTitle")}</AlertTitle>
            <AlertDescription>{t("list.readOnlyDescription")}</AlertDescription>
          </Alert>
        ) : null}
        {meta && !meta.featureEnabled ? (
          <Alert variant="warning">
            <AlertTitle>{t("list.featureOffTitle")}</AlertTitle>
            <AlertDescription>
              {t("list.featureOffDescription")}
            </AlertDescription>
          </Alert>
        ) : null}
        {meta?.featureEnabled &&
        canManage &&
        meta.assignableRoles.length === 0 ? (
          <Alert variant="warning">
            <AlertTitle>{t("list.noRolesTitle")}</AlertTitle>
            <AlertDescription>{t("list.noRolesDescription")}</AlertDescription>
          </Alert>
        ) : null}
        {query.isLoading ? (
          <div
            role="status"
            aria-label={t("list.loading")}
            className="space-y-3"
          >
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : query.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("list.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {errorText(query.error, t("list.loadErrorDescription"))}
              <Button className="w-fit" onClick={() => void query.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("list.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : rules.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("list.emptyDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <CardFrame>
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                canManage={canManage}
                busy={toggle.isPending}
                onToggle={(target, enabled) =>
                  toggle.mutate({ rule: target, enabled })
                }
                onOpen={(next) => {
                  save.reset();
                  setDialog(next);
                }}
              />
            ))}
          </CardFrame>
        )}
      </div>
      {dialog?.kind === "edit" && meta ? (
        <AutomationEditorDialog
          key={dialog.rule?.id ?? "new"}
          rule={dialog.rule ?? undefined}
          workspaceId={workspaceId}
          scopeProjectId={projectId}
          assignableRoles={meta.assignableRoles}
          pending={save.isPending}
          error={save.error}
          onSave={(input) => save.mutate({ rule: dialog.rule, input })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "dry-run" ? (
        <AutomationDryRunDialog
          rule={dialog.rule}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "runs" ? (
        <AutomationRunsDialog
          rule={dialog.rule}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
