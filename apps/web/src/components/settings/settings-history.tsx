import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  LoadingStatus,
  Skeleton,
} from "@taskdesk/ui";
import { ChevronDown, History } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getSettingsHistory,
  type SettingsHistoryScope,
  type SettingsHistoryTarget,
  settingsHistoryQueryKey,
} from "@/fetchers/settings/settings-history";
import { auditActionLabel, auditFieldLabel } from "@/lib/audit-history-format";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

// Closed field sets for types whose labels already exist on their own screens; the API
// projects only these names, so anything else is never rendered.
const LABELLED_FIELDS: Partial<Record<string, Record<string, string>>> = {
  instance_notification_provider: {
    configuration: "settings:history.providerConfiguration",
    credential: "settings:history.providerCredential",
  },
  workspace: {
    name: "settings:history.fields.name",
    slug: "settings:history.fields.workspaceSlug",
    logo: "settings:history.fields.logo",
    description: "settings:history.fields.description",
    defaultSlaPolicyId: "settings:history.fields.defaultSlaPolicy",
    defaultServiceCalendarId: "settings:history.fields.defaultServiceCalendar",
  },
  project: {
    name: "settings:history.fields.name",
    icon: "settings:history.fields.icon",
    slug: "settings:history.fields.key",
    description: "settings:history.fields.description",
    kind: "settings:history.fields.kind",
    supportLevel: "settings:history.fields.supportLevel",
    serviceCalendarId: "settings:history.fields.serviceCalendar",
    slaPolicy: "settings:history.fields.slaPolicy",
    serviceCalendar: "settings:history.fields.serviceCalendar",
    defaultCommentVisibility:
      "settings:history.fields.defaultCommentVisibility",
    managerId: "settings:history.fields.manager",
    startDate: "settings:history.fields.startDate",
    endDate: "settings:history.fields.endDate",
    defaultAssigneeId: "settings:history.fields.defaultAssignee",
    health: "settings:history.fields.health",
    stateSetMode: "settings:history.fields.stateSetMode",
    position: "settings:history.fields.position",
    isDefault: "settings:history.fields.isDefault",
  },
  workspace_member: { role: "settings:projectMembers.role" },
  project_membership: { role: "settings:projectMembers.role" },
  canned_response: {
    name: "settings:cannedResponses.name",
    body: "settings:cannedResponses.body",
    visibilityDefault: "settings:cannedResponses.visibility",
  },
  // The 18 keys the API projects for `instance.settings_changed`, labelled by the General settings form.
  instance: {
    approvalDefaultExpiryDays:
      "godModeSettings:fields.approvalDefaultExpiryDays.label",
    clarificationWindowDays:
      "godModeSettings:fields.clarificationWindowDays.label",
    reopenWindowDays: "godModeSettings:fields.reopenWindowDays.label",
    notificationRetentionDays:
      "godModeSettings:fields.notificationRetentionDays.label",
    cspMode: "godModeSettings:fields.cspMode.label",
    invitationLifetimeHours:
      "godModeSettings:fields.invitationLifetimeHours.label",
    customerInvitationCreateWindowMinutes:
      "godModeSettings:fields.customerInvitationCreateWindowMinutes.label",
    customerInvitationPerInviterLimit:
      "godModeSettings:fields.customerInvitationPerInviterLimit.label",
    customerInvitationPerOrganisationLimit:
      "godModeSettings:fields.customerInvitationPerOrganisationLimit.label",
    customerInvitationResendCooldownSeconds:
      "godModeSettings:fields.customerInvitationResendCooldownSeconds.label",
    anonymousRateLimitWindowMs:
      "godModeSettings:fields.anonymousRateLimitWindowMinutes.label",
    anonymousRateLimitMax: "godModeSettings:fields.anonymousRateLimitMax.label",
    mcpWriteCeilingPerMinute:
      "godModeSettings:fields.mcpWriteCeilingPerMinute.label",
    apiKeyBurstThreshold: "godModeSettings:fields.apiKeyBurstThreshold.label",
    timezone: "godModeSettings:fields.timezone.label",
    attachmentMaxBytes: "godModeSettings:fields.attachmentMaxBytes.label",
    attachmentMaxPerItem: "godModeSettings:fields.attachmentMaxPerItem.label",
    attachmentAllowedExtensions:
      "godModeSettings:fields.attachmentAllowedExtensions.label",
  },
  time_activity: {
    name: "settings:history.fields.activity",
    archived: "settings:history.fields.archived",
  },
  automation: {
    name: "automations:editor.name",
    enabled: "automations:list.enabled",
    trigger: "automations:editor.when",
    scheduleCron: "automations:editor.schedule",
    conditions: "automations:editor.if",
    actions: "automations:editor.then",
    effectiveRoleId: "automations:editor.runAs",
    stopProcessing: "automations:editor.stopProcessing",
  },
};

export function SettingsHistory({
  type,
  id,
  userId,
  selector,
}: {
  type: SettingsHistoryTarget;
  id: string;
  userId: string;
  selector?: SettingsHistoryScope;
}) {
  const { data: session } = authClient.useSession();
  const sessionId =
    session?.user?.id === userId ? session.session?.id : undefined;
  return (
    <SettingsHistoryForSession
      key={JSON.stringify([type, id, userId, sessionId, selector])}
      type={type}
      id={id}
      userId={userId}
      sessionId={sessionId}
      selector={selector}
    />
  );
}

function SettingsHistoryForSession({
  type,
  id,
  userId,
  sessionId,
  selector,
}: {
  type: SettingsHistoryTarget;
  id: string;
  userId: string;
  sessionId: string | undefined;
  selector?: SettingsHistoryScope;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [disclosureReady, setDisclosureReady] = useState(true);
  const disclosureRead = useRef(0);
  const queryKey = settingsHistoryQueryKey(
    type,
    id,
    userId,
    sessionId ?? "",
    selector,
  );
  const enabled = Boolean(id && userId && sessionId);
  const history = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const read = disclosureRead.current;
      try {
        const result = await (selector
          ? getSettingsHistory(type, id, signal, selector)
          : getSettingsHistory(type, id, signal));
        if (!signal.aborted && read === disclosureRead.current)
          setDisclosureReady(true);
        return result;
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof HttpError &&
          [401, 403, 404].includes(error.status)
        ) {
          queryClient.setQueryData(queryKey, null);
        }
        throw error;
      }
    },
    enabled,
    // The app client sets refetchOnMount: false; a cached entry is only shown after a read of this mount.
    refetchOnMount: "always",
  });
  const admitted =
    disclosureReady &&
    history.isFetchedAfterMount &&
    history.isSuccess &&
    history.fetchStatus === "idle";
  const data = admitted ? history.data : null;
  // A cancelled read leaves nothing running: offer Retry instead of a blank panel.
  const stranded =
    enabled &&
    !history.isError &&
    !admitted &&
    history.fetchStatus === "idle" &&
    !history.isPending;
  const actorLabel = (actor: {
    kind: "person" | "api_key" | "automation" | "system";
    name: string | null;
  }) => {
    switch (actor.kind) {
      case "person":
        return (
          (actor.name && !actor.name.includes("@") && actor.name.trim()) ||
          t("settings:history.personUnavailable", {
            defaultValue: "Person unavailable",
          })
        );
      case "api_key":
        return t("settings:history.apiKey", { defaultValue: "API key" });
      case "automation":
        return t("settings:history.automation", { defaultValue: "Automation" });
      case "system":
        return t("settings:history.system", { defaultValue: "System" });
    }
  };
  const labelled = LABELLED_FIELDS[type];
  const occurrences = new Map<string, number>();
  const rows = data?.rows.map((row) => {
    const value = JSON.stringify(row);
    const count = occurrences.get(value) ?? 0;
    occurrences.set(value, count + 1);
    return { row, key: `${value}-${count}` };
  });
  return (
    <HistoryPresentation
      loading={history.isLoading || history.isFetching}
      error={history.isError || stranded}
      retry={() => {
        ++disclosureRead.current;
        setDisclosureReady(false);
        void history.refetch();
      }}
      onOpen={() => {
        if (!enabled) return;
        const read = ++disclosureRead.current;
        setDisclosureReady(false);
        void queryClient.cancelQueries({ queryKey, exact: true }).then(() => {
          if (read !== disclosureRead.current) return;
          void history.refetch();
        });
      }}
      summary={
        data
          ? data.lastChanged
            ? t("settings:history.lastChanged", {
                defaultValue: "Last changed by {{actor}} on {{at}}",
                actor: actorLabel(data.lastChanged.actor),
                at: formatDateTime(data.lastChanged.at),
              })
            : t("settings:history.empty", {
                defaultValue: "No recorded changes yet.",
              })
          : undefined
      }
    >
      {rows?.map(({ row, key }) => (
        <div className="py-2 border-b border-border" key={key}>
          <p>
            {row.action === "membership.changed"
              ? t("settings:history.roleChanged")
              : type === "terminology_override" ||
                  type === "project_estimates" ||
                  type === "instance"
                ? t("common:actions.saved")
                : t(
                    `settings:history.actions.${row.action.replace(/\./g, "_")}`,
                    {
                      defaultValue: auditActionLabel(row.action, t),
                    },
                  )}{" "}
            · {actorLabel(row.actor)} · {formatDateTime(row.at)}
          </p>
          {row.changedFields.length > 0 &&
          type !== "terminology_override" &&
          type !== "project_estimates" ? (
            <p className="text-muted-foreground">
              {row.changedFields
                .filter((field) =>
                  row.action === "time_settings.updated"
                    ? (type === "workspace" && field === "backdateLimitDays") ||
                      (type === "project" && field === "projectDefaultBillable")
                    : (type === "workflow"
                        ? ["definition", "activeVersion"]
                        : labelled
                          ? Object.keys(labelled)
                          : ["name", "slug", "logo", "description"]
                      ).includes(field),
                )
                .map((field) =>
                  row.action === "time_settings.updated" &&
                  field === "backdateLimitDays" &&
                  type === "workspace"
                    ? t("settings:history.fields.backdateLimit")
                    : row.action === "time_settings.updated" &&
                        field === "projectDefaultBillable" &&
                        type === "project"
                      ? t("settings:history.fields.defaultBillable")
                      : type === "workflow"
                        ? t(
                            field === "definition"
                              ? "settings:history.fields.workflowDefinition"
                              : "settings:history.fields.workflowActiveVersion",
                          )
                        : labelled
                          ? t(labelled[field] ?? "")
                          : auditFieldLabel(field, t),
                )
                .join(", ")}
            </p>
          ) : null}
        </div>
      ))}
    </HistoryPresentation>
  );
}

export function HistoryPresentation({
  loading,
  error,
  retry,
  onOpen,
  summary,
  children,
}: {
  loading: boolean;
  error: boolean;
  retry: () => void;
  onOpen: () => void;
  summary?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2 text-sm">
      {loading ? (
        <LoadingStatus visible label={t("common:empty.loading")}>
          <Skeleton className="h-4 w-48" />
        </LoadingStatus>
      ) : null}
      {error ? (
        <div role="alert">
          <span>
            {t("settings:history.error", {
              defaultValue: "Could not load history.",
            })}
          </span>{" "}
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {t("settings:history.retry", { defaultValue: "Retry" })}
          </Button>
        </div>
      ) : null}
      {summary !== undefined ? (
        <p className="text-muted-foreground">{summary}</p>
      ) : null}
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          if (next) onOpen();
          setOpen(next);
        }}
      >
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="gap-2">
            <History className="size-4" />
            {t("settings:history.title", { defaultValue: "History" })}
            <ChevronDown className="size-4" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </div>
  );
}
