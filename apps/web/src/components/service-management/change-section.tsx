import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateTimePicker } from "@/components/common/date-time-picker";
import { PickerPopover } from "@/components/common/picker-popover";
import {
  CHANGE_RISKS,
  type ChangeRisk,
  type ChangeView,
  patchChange,
  setWorkItemService,
} from "@/fetchers/service-management";
import {
  useCatalogueStatus,
  useChange,
  useInvalidateServiceManagement,
  useServices,
} from "@/hooks/queries/service-management";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { OverrideFreezeDialog } from "./override-freeze-dialog";
import {
  fromDateTimeLocal,
  MutationError,
  RiskBadge,
  toDateTimeLocal,
} from "./shared";

const UNSET = "";
const NO_SERVICE = "";

/** SVC-3: the service a work item references, for every type of work item. */
function ServiceReference({
  workItemKey,
  change,
  workspaceId,
  canEdit,
}: {
  workItemKey: string;
  change: ChangeView;
  workspaceId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const services = useServices(workspaceId);
  const mutation = useMutation({
    mutationFn: (serviceId: string | null) =>
      setWorkItemService(workItemKey, serviceId),
    onSuccess: () => invalidate(),
  });
  const options = [
    { value: NO_SERVICE, label: t("change.noService") },
    ...(services.data ?? []).map((service) => ({
      value: service.id,
      label: service.name,
    })),
  ];
  return (
    <div className="space-y-2">
      <Label htmlFor="work-item-service">{t("change.service")}</Label>
      {canEdit ? (
        <PickerPopover
          id="work-item-service"
          value={change.service?.id ?? NO_SERVICE}
          disabled={mutation.isPending}
          className="w-full"
          options={options}
          onChange={(value) => mutation.mutate(value || null)}
        />
      ) : change.service ? (
        <Link
          className="block text-sm underline-offset-4 hover:underline"
          to={routes.serviceManagementServiceDetail.path}
          params={{ id: change.service.id }}
        >
          {change.service.name}
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">{t("change.noService")}</p>
      )}
      <MutationError error={mutation.error} />
    </div>
  );
}

function ChangeForm({
  change,
  workspaceId,
  canManage,
}: {
  change: ChangeView;
  workspaceId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const services = useServices(workspaceId);
  const [overriding, setOverriding] = useState(false);
  const detail = change.detail;
  const [risk, setRisk] = useState<ChangeRisk | typeof UNSET>(
    detail?.risk ?? UNSET,
  );
  const [start, setStart] = useState(toDateTimeLocal(detail?.windowStart));
  const [end, setEnd] = useState(toDateTimeLocal(detail?.windowEnd));
  const [rollback, setRollback] = useState(detail?.rollbackPlan ?? "");
  const [serviceIds, setServiceIds] = useState(
    () => new Set(change.services.map((service) => service.id)),
  );
  const startIso = fromDateTimeLocal(start);
  const endIso = fromDateTimeLocal(end);
  const windowValid =
    (!start && !end) ||
    Boolean(startIso && endIso && new Date(endIso) > new Date(startIso));
  const save = useMutation({
    mutationFn: () =>
      patchChange(change.workItemKey, {
        risk: risk || null,
        windowStart: startIso,
        windowEnd: endIso,
        rollbackPlan: rollback.trim() || null,
        serviceIds: [...serviceIds],
        version: detail?.version ?? 1,
      }),
    onSuccess: () => invalidate(),
  });
  const riskItems = [
    { value: UNSET, label: t("risk.unset") },
    ...CHANGE_RISKS.map((value) => ({ value, label: t(`risk.${value}`) })),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge risk={detail?.risk ?? null} />
        <Badge variant={change.cabRequired ? "info" : "success"}>
          {change.cabRequired
            ? t("change.cabRequired")
            : t("change.preApproved")}
        </Badge>
        {change.retrospective ? (
          <Badge variant="secondary">{t("change.retrospective")}</Badge>
        ) : null}
        {change.services.length > 0 ? (
          <Badge variant="outline">
            {t("change.impact", {
              services: change.impact.services,
              customers: change.impact.customers,
            })}
          </Badge>
        ) : null}
        {detail?.release ? (
          <Link
            className="text-xs underline-offset-4 hover:underline"
            to={routes.serviceManagementReleaseDetail.path}
            params={{ id: detail.release.id }}
          >
            {t("change.release", { name: detail.release.name })}
          </Link>
        ) : null}
      </div>
      {!change.rollbackPlanPresent ? (
        <Alert variant="warning">
          <AlertTitle>{t("change.rollbackMissingTitle")}</AlertTitle>
          <AlertDescription>
            {t("change.rollbackMissingDescription")}
          </AlertDescription>
        </Alert>
      ) : null}
      {change.freeze.blocked ? (
        <Alert variant="error">
          <AlertTitle>{t("change.frozenTitle")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {t("change.frozenDescription", {
                names: change.freeze.freezes
                  .map((freeze) => freeze.name)
                  .join(", "),
              })}
            </p>
            {canManage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOverriding(true)}
              >
                {t("change.override")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {change.freeze.overridden && change.freeze.override ? (
        <Alert variant="warning">
          <AlertTitle>{t("change.overriddenTitle")}</AlertTitle>
          <AlertDescription>
            {t("change.overriddenDescription", {
              by: change.freeze.override.by ?? t("change.unknownPerson"),
              when: formatDateTime(change.freeze.override.at),
              reason: change.freeze.override.reason ?? "",
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {change.conflicts.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>{t("change.conflictTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5">
              {change.conflicts.map((conflict) => (
                <li key={conflict.key}>
                  <Link
                    className="underline-offset-4 hover:underline"
                    to={routes.workItemDetail.path}
                    params={{ key: conflict.key }}
                  >
                    {conflict.key}
                  </Link>{" "}
                  {conflict.title}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canManage && windowValid && !save.isPending) save.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="change-risk">{t("change.risk")}</Label>
          <Select
            items={riskItems}
            value={risk}
            disabled={!canManage}
            onValueChange={(value) =>
              setRisk(value ? (value as ChangeRisk) : UNSET)
            }
          >
            <SelectTrigger id="change-risk">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {riskItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="change-window-start">
              {t("change.windowStart")}
            </Label>
            <DateTimePicker
              id="change-window-start"
              label={t("change.windowStart")}
              value={startIso}
              disabled={!canManage}
              onChange={(value) => setStart(toDateTimeLocal(value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-window-end">{t("change.windowEnd")}</Label>
            <DateTimePicker
              id="change-window-end"
              label={t("change.windowEnd")}
              value={endIso}
              disabled={!canManage}
              onChange={(value) => setEnd(toDateTimeLocal(value))}
            />
          </div>
        </div>
        {!windowValid ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {t("change.windowInvalid")}
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="change-rollback">{t("change.rollback")}</Label>
          <Textarea
            id="change-rollback"
            rows={3}
            value={rollback}
            disabled={!canManage}
            onChange={(event) => setRollback(event.target.value)}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {t("change.affected")}
          </legend>
          {(services.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("change.noServicesDefined")}
            </p>
          ) : (
            <ScrollArea
              className="h-auto max-h-40 [&>[data-slot=scroll-area-viewport]]:max-h-40"
              role="region"
              aria-label={t("change.affected")}
            >
              <div className="space-y-2">
                {(services.data ?? []).map((service) => (
                  <div key={service.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`change-service-${service.id}`}
                      checked={serviceIds.has(service.id)}
                      disabled={!canManage}
                      onCheckedChange={(checked) =>
                        setServiceIds((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(service.id);
                          else next.delete(service.id);
                          return next;
                        })
                      }
                    />
                    <Label htmlFor={`change-service-${service.id}`}>
                      {service.name}
                    </Label>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </fieldset>
        {canManage ? (
          <Button type="submit" disabled={save.isPending || !windowValid}>
            {t("common.save")}
          </Button>
        ) : null}
        <MutationError error={save.error} />
      </form>
      {overriding ? (
        <OverrideFreezeDialog
          workspaceId={workspaceId}
          change={change}
          onClose={() => setOverriding(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The service and change section of a work item (`SVC-3`, `CH-1`..`CH-6`). It renders nothing
 * while the service catalogue is off. Every work item can reference a service; a change type
 * also carries risk, deployment window, rollback plan and affected services.
 */
export default function WorkItemChangeSection({
  workItemKey,
}: {
  workItemKey: string;
}) {
  const { t } = useTranslation("serviceManagement");
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const status = useCatalogueStatus(workspaceId);
  const change = useChange(workItemKey);
  const permission = useWorkspacePermission(workspaceId);
  if (!status.data?.enabled) return null;
  if (change.isLoading) return <Skeleton className="h-24 w-full" />;
  if (change.isError || !change.data)
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {t("change.loadError")}
      </p>
    );
  return (
    <section
      className="flex flex-col gap-4"
      aria-label={t("change.title")}
      data-testid="work-item-change"
    >
      <ServiceReference
        key={`${workItemKey}:${change.data.service?.id ?? ""}`}
        workItemKey={workItemKey}
        change={change.data}
        workspaceId={workspaceId}
        canEdit={
          !permission.isCheckingPermissions && permission.canUpdateTasks()
        }
      />
      {change.data.isChange ? (
        <ChangeForm
          key={`${workItemKey}:${change.data.detail?.version ?? 0}:${change.data.freeze.overridden}`}
          change={change.data}
          workspaceId={workspaceId}
          canManage={status.data.canManageChanges}
        />
      ) : null}
    </section>
  );
}

/** True when the section has anything to show; used by the detail disclosure list. */
export function useChangeSectionVisible() {
  const { data: workspace } = useActiveWorkspace();
  const status = useCatalogueStatus(workspace?.id ?? "");
  return status.data?.enabled === true;
}
