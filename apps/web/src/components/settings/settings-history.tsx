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
    name: "settings:history.fields.name",
    body: "settings:history.fields.body",
    visibilityDefault: "settings:history.fields.visibilityDefault",
  },
  // The 18 keys the API projects for `instance.settings_changed`.
  instance: {
    approvalDefaultExpiryDays:
      "settings:history.fields.approvalDefaultExpiryDays",
    clarificationWindowDays: "settings:history.fields.clarificationWindowDays",
    reopenWindowDays: "settings:history.fields.reopenWindowDays",
    notificationRetentionDays:
      "settings:history.fields.notificationRetentionDays",
    cspMode: "settings:history.fields.cspMode",
    invitationLifetimeHours: "settings:history.fields.invitationLifetimeHours",
    customerInvitationCreateWindowMinutes:
      "settings:history.fields.customerInvitationCreateWindowMinutes",
    customerInvitationPerInviterLimit:
      "settings:history.fields.customerInvitationPerInviterLimit",
    customerInvitationPerOrganisationLimit:
      "settings:history.fields.customerInvitationPerOrganisationLimit",
    customerInvitationResendCooldownSeconds:
      "settings:history.fields.customerInvitationResendCooldownSeconds",
    anonymousRateLimitWindowMs:
      "settings:history.fields.anonymousRateLimitWindowMs",
    anonymousRateLimitMax: "settings:history.fields.anonymousRateLimitMax",
    mcpWriteCeilingPerMinute:
      "settings:history.fields.mcpWriteCeilingPerMinute",
    apiKeyBurstThreshold: "settings:history.fields.apiKeyBurstThreshold",
    timezone: "settings:history.fields.timezone",
    attachmentMaxBytes: "settings:history.fields.attachmentMaxBytes",
    attachmentMaxPerItem: "settings:history.fields.attachmentMaxPerItem",
    attachmentAllowedExtensions:
      "settings:history.fields.attachmentAllowedExtensions",
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

// Types without their own set show the four general fields.
const DEFAULT_FIELDS: Record<string, string> = {
  name: "settings:history.fields.name",
  slug: "settings:history.fields.workspaceSlug",
  logo: "settings:history.fields.logo",
  description: "settings:history.fields.description",
};
// The API splits time settings by scope: each scope owns exactly one marker.
const TIME_SETTINGS_FIELDS: Partial<Record<string, Record<string, string>>> = {
  workspace: { backdateLimitDays: "settings:history.fields.backdateLimit" },
  project: {
    projectDefaultBillable: "settings:history.fields.defaultBillable",
  },
};
const WORKFLOW_FIELDS: Record<string, string> = {
  definition: "settings:history.fields.workflowDefinition",
  activeVersion: "settings:history.fields.workflowActiveVersion",
};
const UNKNOWN_FIELD = "settings:history.fields.unknown";

/** Catalog key of a changed-field marker; an unmapped marker gets the localized generic label, never its raw key. */
function fieldLabelKey(
  type: SettingsHistoryTarget,
  action: string,
  field: string,
): string {
  const map =
    action === "time_settings.updated"
      ? (TIME_SETTINGS_FIELDS[type] ?? {})
      : type === "workflow"
        ? WORKFLOW_FIELDS
        : (LABELLED_FIELDS[type] ?? DEFAULT_FIELDS);
  return (Object.hasOwn(map, field) ? map[field] : undefined) ?? UNKNOWN_FIELD;
}

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
  const { t, i18n } = useTranslation();
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
  // Settings label first, then a work-item style label, else the localized generic one (never a raw or humanized key).
  const actionLabelKey = (action: string) => {
    const name = action.replace(/\./g, "_");
    const own = `settings:history.actions.${name}`;
    const workItem = `workItems:auditHistory.actions.${name}`;
    return i18n.exists(own)
      ? own
      : i18n.exists(workItem)
        ? workItem
        : "settings:history.actions.unknown";
  };
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
              : type === "terminology_override" || type === "project_estimates"
                ? t("common:actions.saved")
                : t(actionLabelKey(row.action))}{" "}
            · {actorLabel(row.actor)} · {formatDateTime(row.at)}
          </p>
          {row.changedFields.length > 0 &&
          type !== "terminology_override" &&
          type !== "project_estimates" ? (
            <p className="text-muted-foreground">
              {[
                ...new Set(
                  row.changedFields.map((field) =>
                    t(fieldLabelKey(type, row.action, field)),
                  ),
                ),
              ].join(", ")}
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
