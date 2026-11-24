import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  LoadingStatus,
  Skeleton,
} from "@taskdesk/ui";
import { ChevronDown, History } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsHistoryTarget } from "@/fetchers/settings/settings-history";
import {
  type HistoryTarget,
  useSettingsHistory,
} from "@/hooks/queries/settings/use-settings-history";
import { formatDateTime } from "@/lib/format";

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
    // One marker for a feature-switch change, never which switch.
    featureFlag: "settings:history.fields.featureFlag",
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
    featureFlag: "settings:history.fields.featureFlag",
  },
  // The six `portal.method` markers the API projects for the local sign-in switches.
  instance_auth_methods: {
    "agent.password": "settings:history.fields.authAgentPassword",
    "agent.magicLink": "settings:history.fields.authAgentMagicLink",
    "agent.emailOtp": "settings:history.fields.authAgentEmailOtp",
    "customer.password": "settings:history.fields.authCustomerPassword",
    "customer.magicLink": "settings:history.fields.authCustomerMagicLink",
    "customer.emailOtp": "settings:history.fields.authCustomerEmailOtp",
  },
  staff_self_registration: {
    enabled: "settings:history.fields.staffSelfRegistration",
  },
  instance_job: {
    pattern: "settings:history.fields.schedule",
    enabled: "settings:history.fields.enabled",
  },
  workspace_member: { role: "settings:projectMembers.role" },
  project_membership: { role: "settings:projectMembers.role" },
  canned_response: {
    name: "settings:history.fields.name",
    body: "settings:history.fields.body",
    visibilityDefault: "settings:history.fields.visibilityDefault",
  },
  state_template: {
    created: "settings:history.fields.created",
    enabled: "settings:history.fields.enabled",
    name: "settings:history.fields.name",
    group: "settings:history.fields.group",
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
  workspace_label: {
    name: "settings:history.fields.name",
    color: "settings:history.fields.color",
  },
  project_label: {
    name: "settings:history.fields.name",
    color: "settings:history.fields.color",
  },
  state: { wipLimit: "settings:history.fields.wipLimit" },
  cost_type: {
    name: "settings:history.fields.name",
    unit: "settings:history.fields.unit",
    currency: "settings:history.fields.currency",
    billable: "settings:history.fields.billable",
    hasDefaultRate: "settings:history.fields.hasDefaultRate",
    archived: "settings:history.fields.archived",
  },
  hourly_rate: { rateSet: "settings:history.fields.rateSet" },
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

// Labels of the closed change markers of each personal section.
const SELF_LABELS: Record<string, (marker: string) => string> = {
  profile: (marker) =>
    ({
      name: "settings:informationPage.fullName",
      image: "settings:informationPage.profilePicture",
      locale: "settings:history.profileLocale",
    })[marker] ?? UNKNOWN_FIELD,
  preferences: (marker) => `settings:history.preferenceFields.${marker}`,
  notifications: (marker) =>
    ({
      delivery: "settings:history.notificationDelivery",
      digest: "settings:history.notificationDigest",
      quietHours: "settings:history.notificationQuietHours",
      workspaceRule: "settings:history.notificationWorkspaceRule",
    })[marker] ?? UNKNOWN_FIELD,
  security: (marker) =>
    ({
      password: "settings:history.securityPassword",
      mfa: "settings:history.securityMfa",
    })[marker] ?? UNKNOWN_FIELD,
  apiKeys: () => "settings:history.personalKey",
};

/** Lazy-load this component; screens pass a target and nothing else. */
export function SettingsHistory({ target }: { target: HistoryTarget }) {
  const { t, i18n } = useTranslation();
  const { state, revalidate } = useSettingsHistory(target);
  if (state.status === "hidden") return null;
  const data = state.status === "ready" ? state.data : null;
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
  const you = t("settings:history.profileYou");
  const type: SettingsHistoryTarget | null =
    data && "entityType" in data ? data.entityType : null;
  const lines = !data
    ? []
    : "section" in data
      ? data.rows.map((row) => ({
          title: `${you} · ${formatDateTime(row.at)}`,
          detail: row.changed
            .map((marker) =>
              t(SELF_LABELS[data.section]?.(marker) ?? UNKNOWN_FIELD),
            )
            .join(", "),
          value: JSON.stringify(row),
        }))
      : data.rows.map((row) => {
          const flat =
            type === "terminology_override" || type === "project_estimates";
          return {
            title: `${
              row.action === "membership.changed"
                ? t("settings:history.roleChanged")
                : flat
                  ? t("common:actions.saved")
                  : t(actionLabelKey(row.action))
            } · ${actorLabel(row.actor)} · ${formatDateTime(row.at)}`,
            detail:
              row.changedFields.length > 0 && !flat && type
                ? [
                    ...new Set(
                      row.changedFields.map((field) =>
                        t(fieldLabelKey(type, row.action, field)),
                      ),
                    ),
                  ].join(", ")
                : "",
            value: JSON.stringify(row),
          };
        });
  const occurrences = new Map<string, number>();
  const rows = lines.map((line) => {
    const count = occurrences.get(line.value) ?? 0;
    occurrences.set(line.value, count + 1);
    return { ...line, key: `${line.value}-${count}` };
  });
  const last = data?.lastChanged;
  return (
    <HistoryPresentation
      loading={state.status === "checking"}
      error={state.status === "error"}
      retry={revalidate}
      onOpen={revalidate}
      summary={
        data
          ? last
            ? t("settings:history.lastChanged", {
                defaultValue: "Last changed by {{actor}} on {{at}}",
                actor:
                  typeof last.actor === "string" ? you : actorLabel(last.actor),
                at: formatDateTime(last.at),
              })
            : t("settings:history.empty", {
                defaultValue: "No recorded changes yet.",
              })
          : undefined
      }
    >
      {rows.map(({ key, title, detail }) => (
        <div className="py-2 border-b border-border" key={key}>
          <p>{title}</p>
          {detail ? <p className="text-muted-foreground">{detail}</p> : null}
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
