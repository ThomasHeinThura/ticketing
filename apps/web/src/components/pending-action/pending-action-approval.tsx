import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { parseAttachmentDeletionSummary } from "@/components/pending-action/attachment-deletion-summary";
import { parseCommentDeletionSummary } from "@/components/pending-action/comment-deletion-summary";
import { parseImportChunkSummary } from "@/components/pending-action/import-chunk-summary";
import { parseImportRunSummary } from "@/components/pending-action/import-run-summary";
import {
  getCurrentFactorStatus,
  getInstanceUser,
  type StepUpMethod,
} from "@/fetchers/god-mode/instance-users";
import {
  approveOwnPendingAction,
  cancelOwnPendingAction,
  createPendingActionProof,
  getOwnPendingAction,
} from "@/fetchers/pending-actions";
import { instanceUsersKey } from "@/hooks/queries/god-mode/use-instance-users";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import {
  PENDING_ACTION_TARGET_QUERY_PREFIXES,
  pendingActionLabelKey,
} from "./pending-action-label";
import { registeredDeletionTarget } from "./registered-deletion-targets";

/**
 * Deletions that moved behind the pending-action flow (registered targets). Their summary
 * carries the target `name`; project and workspace additionally require that exact name
 * to be typed together with a fresh step-up.
 */
/** Registered-target cache prefixes that an approved deletion makes stale. */
const REGISTERED_DELETION_QUERY_KEYS = [
  "projects",
  "workspaces",
  "workspace",
  "workspace-roles",
  "workspace-invites",
  "workspace-users",
  "active-workspace-users",
  "labels",
  "project-labels",
  "columns",
  "canned-responses",
  "tasks",
  "api-keys",
  "custom-fields",
  "teams",
  "service-management",
  "time-tracking",
  "webhooks",
  "automations",
  "kb",
  "agile",
  "reports",
  "pages",
  // S3 Overview: milestones, prerequisites and document links (all registered deletions).
  "project-overview",
] as const;

/** The Kaneo task page: `/dashboard/workspace/:workspaceId/project/:projectId/task/:taskId`. */
const TASK_PAGE_PATH =
  /^\/dashboard\/workspace\/([^/]+)\/project\/([^/]+)\/task\/([^/]+)\/?$/;

/** The canonical work-item page: `/agent/work-items/:key`. */
const CANONICAL_PAGE_PATH = /^\/agent\/work-items\/([^/]+)\/?$/;

/** The tasks of the active project that an executed work-item deletion removed, by key. */
function deletedProjectTasks(
  project: ProjectWithTasks | undefined,
  keys: ReadonlySet<string>,
): Task[] {
  if (!project?.slug) return [];
  const slug = project.slug;
  return [
    ...(project.columns ?? []).flatMap((column) => column.tasks),
    ...(project.plannedTasks ?? []),
    ...(project.archivedTasks ?? []),
  ].filter((task) => task.number != null && keys.has(`${slug}-${task.number}`));
}

function withoutTasks(
  project: ProjectWithTasks,
  removed: ReadonlySet<string>,
): ProjectWithTasks {
  return {
    ...project,
    columns: (project.columns ?? []).map((column) => ({
      ...column,
      tasks: column.tasks.filter((task) => !removed.has(task.id)),
    })),
    plannedTasks: (project.plannedTasks ?? []).filter(
      (task) => !removed.has(task.id),
    ),
    archivedTasks: (project.archivedTasks ?? []).filter(
      (task) => !removed.has(task.id),
    ),
  };
}

function summaryRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          row !== null && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

type OrganisationPurgeImpact = {
  organisations: number;
  projects: number;
  people: number;
  workItems: number;
  comments: number;
  submissions: number;
  attachments: number;
  storageObjectsQueued: number;
};

type HardPurgeSummary = {
  targetType: "work_item" | "project" | "organisation";
  label: string;
  workItems: number;
  comments: number;
  attachments: number;
  organisationImpact?: OrganisationPurgeImpact;
};

function isHardPurgeTargetType(
  value: string,
): value is HardPurgeSummary["targetType"] {
  return (
    value === "work_item" || value === "project" || value === "organisation"
  );
}

function parseHardPurgeSummary(action: {
  action: string;
  targetType: string;
  targetIds: string[];
  summary: Record<string, unknown> | undefined;
}): HardPurgeSummary | null {
  if (
    action.action !== "purge" ||
    !isHardPurgeTargetType(action.targetType) ||
    action.targetIds.length !== 1 ||
    !action.summary ||
    action.summary.targetType !== action.targetType ||
    action.summary.targetId !== action.targetIds[0] ||
    action.summary.legalHold !== "none" ||
    action.summary.retention !== "soft_deleted" ||
    typeof action.summary.label !== "string" ||
    action.summary.label.trim().length === 0
  )
    return null;
  const safeCount = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : null;
  const workItems = safeCount(action.summary.workItems);
  const comments = safeCount(action.summary.comments);
  const attachments = safeCount(action.summary.attachments);
  if (workItems === null || comments === null || attachments === null)
    return null;

  if (action.targetType !== "organisation") {
    return {
      targetType: action.targetType,
      label: action.summary.label,
      workItems,
      comments,
      attachments,
    };
  }

  const raw = action.summary.impact;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const count = (key: keyof OrganisationPurgeImpact) =>
    safeCount((raw as Record<string, unknown>)[key]);
  const organisationImpact = {
    organisations: count("organisations"),
    projects: count("projects"),
    people: count("people"),
    workItems: count("workItems"),
    comments: count("comments"),
    submissions: count("submissions"),
    attachments: count("attachments"),
    storageObjectsQueued: count("storageObjectsQueued"),
  };
  if (Object.values(organisationImpact).some((value) => value === null))
    return null;
  return {
    targetType: "organisation",
    label: action.summary.label,
    workItems,
    comments,
    attachments,
    organisationImpact: organisationImpact as OrganisationPurgeImpact,
  };
}

/** The i18n key that explains a failed approval attempt (proof or approve step). */
export function approvalErrorKey(
  cause: unknown,
  isRegisteredTypedName: boolean,
): string {
  const status = cause instanceof HttpError ? cause.status : undefined;
  if (status === 400)
    return isRegisteredTypedName
      ? "pendingActions:registered.nameMismatch"
      : "pendingActions:emailMismatch";
  if (status === 429) return "pendingActions:stepUp.attemptLimit";
  if (status === 403)
    return cause instanceof HttpError && cause.message === "step_up_unavailable"
      ? "pendingActions:stepUp.proofRejected"
      : "pendingActions:stepUp.forbidden";
  if (status === 409) return "pendingActions:staleApproval";
  return "pendingActions:approvalFailed";
}

type ApprovedAction = { state?: unknown };

export type PendingActionApprovalProps = {
  id: string;
  /** `page` is the profile route; `dialog` renders inside a Kaneo Dialog on the current screen. */
  layout: "page" | "dialog";
  /** Dialog only: the approval reached `executed`; the host closes itself. */
  onExecuted?: () => void;
  /** Dialog only: the pending action was cancelled; the host closes itself. */
  onCancelled?: () => void;
};

export function PendingActionApproval({
  id,
  layout,
  onExecuted,
  onCancelled,
}: PendingActionApprovalProps) {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const setProject = useProjectStore((state) => state.setProject);
  const { data: activeWorkspace } = useActiveWorkspace();
  const isDialog = layout === "dialog";
  const [typedName, setTypedName] = useState("");
  const [typedCount, setTypedCount] = useState("");
  const [secret, setSecret] = useState("");
  const [method, setMethod] = useState<StepUpMethod>("password");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const intent = id;
  const actionLifecycle = useIntentLifecycle(intent, () => {
    setTypedName("");
    setTypedCount("");
    setSecret("");
    setError(null);
    setNotice(null);
  });
  const action = useQuery({
    queryKey: ["me", "pending-action", id],
    queryFn: () => getOwnPendingAction(id),
  });
  const isUserDeactivation =
    action.data?.action === "delete" && action.data.targetType === "user";
  const isHardPurge = action.data?.action === "purge";
  const hardPurgeSummary = action.data
    ? parseHardPurgeSummary(action.data)
    : null;
  const hardPurgeRedacted = isHardPurge && hardPurgeSummary === null;
  const isHardPurgeTypedName =
    isHardPurge &&
    action.data?.confirmation === "typed_name_step_up" &&
    hardPurgeSummary !== null;
  const isOrganisationHardPurge =
    isHardPurge && action.data?.targetType === "organisation";
  const registeredTarget =
    action.data?.action === "delete"
      ? registeredDeletionTarget(action.data.targetType)
      : null;
  const needsStepUp =
    isUserDeactivation ||
    (registeredTarget !== null &&
      action.data?.confirmation === "typed_name_step_up") ||
    isHardPurgeTypedName ||
    action.data?.confirmation === "typed_count_step_up";
  const targetUserId = isUserDeactivation
    ? action.data?.targetIds[0]
    : undefined;
  const currentTarget = useQuery({
    queryKey: [...instanceUsersKey, "detail", targetUserId],
    queryFn: () => getInstanceUser(targetUserId as string),
    enabled: Boolean(
      targetUserId &&
        action.data?.approvalSupported &&
        action.data.state === "pending",
    ),
  });
  const factor = useQuery({
    queryKey: ["god-mode", "step-up-factor"],
    queryFn: getCurrentFactorStatus,
    staleTime: 15_000,
    enabled: Boolean(
      needsStepUp &&
        action.data?.approvalSupported &&
        action.data.state === "pending",
    ),
  });
  useEffect(() => {
    if (factor.data) {
      setMethod(factor.data.availableMethods[0] ?? "password");
      setSecret("");
    }
  }, [factor.data]);
  const approve = useMutation({
    mutationFn: approveOwnPendingAction,
  });
  const cancel = useMutation({
    mutationFn: cancelOwnPendingAction,
  });

  if (action.isLoading) {
    if (isDialog)
      return (
        <>
          <DialogHeader>
            <DialogTitle>
              {t("pendingActions:dynamic.pendingAction")}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel aria-busy="true">
            <Skeleton className="h-32 w-full" />
          </DialogPanel>
        </>
      );
    return (
      <div className="w-full p-5 lg:p-8" aria-busy="true">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (action.isError || !action.data) {
    if (isDialog)
      return (
        <>
          <DialogHeader>
            <DialogTitle>
              {t("pendingActions:dynamic.pendingAction")}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <p role="alert" className="text-sm text-destructive">
              {t("pendingActions:copy.85baf535b480")}
            </p>
          </DialogPanel>
        </>
      );
    return (
      <div className="w-full space-y-4 p-5 lg:p-8">
        <PageTitle title={t("pendingActions:copy.a93eb80c8601")} />
        <p role="alert" className="text-sm text-destructive">
          {t("pendingActions:copy.85baf535b480")}
        </p>
        <Link to={routes.pendingActions.path as never}>
          {t("pendingActions:copy.c4c695a8da8e")}
        </Link>
      </div>
    );
  }

  const email = currentTarget.data?.email ?? null;
  const isPending = action.data.state === "pending";
  const isDeactivationContract =
    action.data.action === "delete" &&
    action.data.targetType === "user" &&
    action.data.confirmation === "typed_name_step_up";
  const isBulkDeletion =
    action.data.action === "bulk_delete" &&
    action.data.targetType === "work_item" &&
    (action.data.confirmation === "typed_count" ||
      action.data.confirmation === "typed_count_step_up");
  const isImportChunkTarget = action.data.targetType === "import_chunk";
  const importChunkSummary = parseImportChunkSummary(action.data);
  const isImportChunk = importChunkSummary !== null;
  const importChunkRedacted = isImportChunkTarget && !isImportChunk;
  const importRunSummary = parseImportRunSummary(action.data);
  const isImportRun = importRunSummary !== null;
  const importRunRedacted =
    action.data.targetType === "import_run" && !isImportRun;
  const bulkSummary =
    isBulkDeletion &&
    action.data.summary?.redacted !== true &&
    typeof action.data.summary?.affectedCount === "number" &&
    Number.isInteger(action.data.summary.affectedCount) &&
    action.data.summary.affectedCount > 0 &&
    action.data.summary.affectedCount <= 500
      ? {
          count: action.data.summary.affectedCount,
          childrenAffected:
            typeof action.data.summary.childrenAffected === "number"
              ? action.data.summary.childrenAffected
              : 0,
          keys:
            typeof action.data.summary.selection === "object" &&
            action.data.summary.selection !== null &&
            !Array.isArray(action.data.summary.selection) &&
            Array.isArray(action.data.summary.selection.keys)
              ? action.data.summary.selection.keys.filter(
                  (key): key is string => typeof key === "string",
                )
              : [],
        }
      : null;
  const bulkRedacted =
    isBulkDeletion &&
    (!bulkSummary ||
      bulkSummary.keys.length !== bulkSummary.count ||
      new Set(bulkSummary.keys).size !== bulkSummary.count);
  const bulkTargets =
    !bulkRedacted && isBulkDeletion
      ? summaryRows(action.data.summary?.representativeTargets).filter(
          (row) => typeof row.key === "string" && typeof row.title === "string",
        )
      : [];
  const bulkProjects =
    !bulkRedacted && isBulkDeletion
      ? summaryRows(action.data.summary?.projects).filter(
          (row) =>
            typeof row.name === "string" && typeof row.count === "number",
        )
      : [];
  const bulkExcluded =
    !bulkRedacted && isBulkDeletion
      ? summaryRows(action.data.summary?.failed).filter(
          (row) => typeof row.id === "string" && typeof row.reason === "string",
        )
      : [];
  const storedResult =
    !bulkRedacted && isBulkDeletion && action.data.state === "executed"
      ? action.data.summary?.result
      : null;
  const bulkResult =
    storedResult &&
    typeof storedResult === "object" &&
    !Array.isArray(storedResult) &&
    Array.isArray(storedResult.succeeded) &&
    storedResult.succeeded.every((key) => typeof key === "string") &&
    Array.isArray(storedResult.failed)
      ? {
          succeeded: storedResult.succeeded as string[],
          failed: summaryRows(storedResult.failed).filter(
            (row) =>
              typeof row.id === "string" && typeof row.reason === "string",
          ),
        }
      : null;
  const registeredName =
    registeredTarget &&
    action.data.summary?.redacted !== true &&
    typeof action.data.summary?.name === "string" &&
    action.data.summary.name.length > 0
      ? action.data.summary.name
      : null;
  const registeredProjectName =
    registeredName !== null &&
    typeof action.data.summary?.projectName === "string"
      ? action.data.summary.projectName
      : null;
  const registeredProjectImpact = (() => {
    const raw = action.data.summary?.impact;
    if (
      action.data.targetType !== "project" ||
      action.data.summary?.redacted === true ||
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    )
      return null;
    const count = (key: string) => {
      const value = (raw as Record<string, unknown>)[key];
      return typeof value === "number" && Number.isInteger(value) && value >= 0
        ? value
        : null;
    };
    const workItems = count("workItems");
    const legacyTasks = count("legacyTasks");
    const members = count("members");
    const attachments = count("attachments");
    const workflowRules = count("workflowRules");
    const sourceLinks = count("sourceLinks");
    if (
      workItems === null ||
      legacyTasks === null ||
      members === null ||
      attachments === null ||
      workflowRules === null ||
      sourceLinks === null
    )
      return null;
    return {
      workItems,
      legacyTasks,
      members,
      attachments,
      workflowRules,
      sourceLinks,
    };
  })();
  const registeredRedacted = registeredTarget !== null && !registeredName;
  const isRegisteredTypedName =
    registeredTarget !== null &&
    action.data.confirmation === "typed_name_step_up";
  const isRegisteredClick =
    registeredTarget !== null && action.data.confirmation === "click";
  const isClickContract =
    isRegisteredClick ||
    (action.data.action === "delete" &&
      (action.data.targetType === "service_calendar" ||
        action.data.targetType === "saved_view" ||
        action.data.targetType === "relation" ||
        action.data.targetType === "comment" ||
        action.data.targetType === "attachment" ||
        action.data.targetType === "work_item") &&
      action.data.confirmation === "click");
  const relationSummary =
    action.data.targetType === "relation" &&
    typeof action.data.summary?.sourceKey === "string" &&
    typeof action.data.summary?.targetKey === "string" &&
    typeof action.data.summary?.relationType === "string"
      ? {
          sourceKey: action.data.summary.sourceKey,
          targetKey: action.data.summary.targetKey,
          type: action.data.summary.relationType,
          sourceTitle:
            typeof action.data.summary.sourceTitle === "string"
              ? action.data.summary.sourceTitle
              : "",
          targetTitle:
            typeof action.data.summary.targetTitle === "string"
              ? action.data.summary.targetTitle
              : "",
        }
      : null;
  const relationRedacted =
    action.data.targetType === "relation" &&
    action.data.summary?.redacted === true;
  const workItemSummary =
    action.data.targetType === "work_item" &&
    typeof action.data.summary?.key === "string" &&
    typeof action.data.summary?.title === "string"
      ? {
          key: action.data.summary.key,
          title: action.data.summary.title,
          childrenAffected:
            typeof action.data.summary.childrenAffected === "number"
              ? action.data.summary.childrenAffected
              : 0,
          projectName:
            typeof action.data.summary.projectName === "string"
              ? action.data.summary.projectName
              : "",
          requesterName:
            typeof action.data.summary.customerRequesterName === "string"
              ? action.data.summary.customerRequesterName
              : "",
          requestedByName:
            typeof action.data.summary.requestedByName === "string"
              ? action.data.summary.requestedByName
              : "",
          customerVisibility:
            action.data.summary.customerVisibility === "organisation" ||
            action.data.summary.customerVisibility === "private"
              ? action.data.summary.customerVisibility
              : "private",
          // `WI-21`: the item is retained for 30 days, then purged (restore ships in P2).
          recoveryDays:
            typeof action.data.summary.recoveryDays === "number"
              ? action.data.summary.recoveryDays
              : 30,
        }
      : null;
  const workItemRedacted =
    action.data.action === "delete" &&
    action.data.targetType === "work_item" &&
    (action.data.summary?.redacted === true || !workItemSummary);
  const parsedCommentSummary =
    action.data.targetType === "comment"
      ? parseCommentDeletionSummary(action.data.summary)
      : null;
  const commentSummary =
    parsedCommentSummary &&
    action.data.targetIds.length === 1 &&
    action.data.targetIds[0] === parsedCommentSummary.commentId
      ? parsedCommentSummary
      : null;
  const commentRedacted =
    action.data.targetType === "comment" && !commentSummary;
  const parsedAttachmentSummary =
    action.data.targetType === "attachment"
      ? parseAttachmentDeletionSummary(action.data.summary)
      : null;
  const attachmentSummary =
    parsedAttachmentSummary &&
    action.data.targetIds.length === 1 &&
    action.data.targetIds[0] === parsedAttachmentSummary.attachmentId
      ? parsedAttachmentSummary
      : null;
  const attachmentRedacted =
    action.data.targetType === "attachment" && !attachmentSummary;
  const canApprove =
    action.data.approvalSupported &&
    isPending &&
    !workItemRedacted &&
    !commentRedacted &&
    !attachmentRedacted &&
    !relationRedacted &&
    !bulkRedacted &&
    !registeredRedacted &&
    !hardPurgeRedacted &&
    !importChunkRedacted &&
    !importRunRedacted &&
    ((isDeactivationContract && email !== null) ||
      isRegisteredTypedName ||
      isHardPurgeTypedName ||
      isClickContract ||
      isBulkDeletion ||
      isImportChunk ||
      isImportRun);
  const availableMethods = factor.data?.availableMethods ?? [];
  const effectiveMethod = method;
  const factorUnavailable =
    factor.isLoading ||
    factor.isError ||
    !factor.data ||
    availableMethods.length === 0 ||
    !availableMethods.includes(effectiveMethod);

  async function approveAction() {
    if (commentRedacted || attachmentRedacted) return;
    if (registeredRedacted) return;
    if (hardPurgeRedacted) return;
    if (isDeactivationContract && (!email || typedName !== email)) return;
    if (isRegisteredTypedName && typedName !== registeredName) return;
    if (isHardPurgeTypedName && typedName !== hardPurgeSummary?.label) return;
    if (
      isBulkDeletion &&
      (!bulkSummary || bulkRedacted || typedCount !== String(bulkSummary.count))
    )
      return;
    if (isImportChunk && typedCount !== String(importChunkSummary.recordCount))
      return;
    if (isImportRun && typedCount !== String(importRunSummary.totalCount))
      return;
    if (
      !isDeactivationContract &&
      !isRegisteredTypedName &&
      !isHardPurgeTypedName &&
      !isClickContract &&
      !isBulkDeletion &&
      !isImportChunk &&
      !isImportRun
    )
      return;
    const capturedIntent = actionLifecycle.capture();
    const isCurrentIntent = () => actionLifecycle.isCurrent(capturedIntent);
    setError(null);
    try {
      let approved: unknown;
      if (needsStepUp) {
        const stepUpToken = await createPendingActionProof({
          pendingActionId: id,
          method: effectiveMethod,
          secret,
        });
        if (!isCurrentIntent()) return;
        approved = await approve.mutateAsync({
          id,
          ...(isDeactivationContract ||
          isRegisteredTypedName ||
          isHardPurgeTypedName
            ? { typedName }
            : { typedCount }),
          stepUpToken,
        });
      } else {
        approved = await approve.mutateAsync({
          id,
          ...(isBulkDeletion ? { typedCount } : {}),
        });
      }
      const executed =
        (approved as ApprovedAction | null | undefined)?.state === "executed";
      // A deleted workspace or project must not stay the shell's active context. Leave
      // before the cache refetches below, so nothing re-reads the deleted record (404).
      if (executed && action.data?.targetType === "workspace") {
        setProject(undefined);
        await navigate({ to: "/dashboard" });
      } else if (executed && action.data?.targetType === "project") {
        setProject(undefined);
        if (activeWorkspace?.id)
          await navigate({
            to: "/dashboard/workspace/$workspaceId",
            params: { workspaceId: activeWorkspace.id },
          });
        else await navigate({ to: "/dashboard" });
      }
      // The role's page no longer exists: return to the roles list.
      if (executed && action.data?.targetType === "workspace_role") {
        await navigate({ to: "/dashboard/settings/workspace/roles" });
      }
      // The deleted calendar's editor would refetch into its 404: return to the list.
      if (
        executed &&
        action.data?.targetType === "service_calendar" &&
        action.data.targetIds.some(
          (targetId) =>
            location.pathname ===
            routes.serviceCalendarEditor.build({ id: targetId }),
        )
      ) {
        await navigate({ href: routes.serviceCalendars.build() });
      }
      const targetPrefixes = executed
        ? (PENDING_ACTION_TARGET_QUERY_PREFIXES[
            action.data?.targetType ?? ""
          ] ?? [])
        : [];
      const workItemDeleted =
        executed && action.data?.targetType === "work_item";
      if (workItemDeleted) await leaveDeletedWorkItems(action.data?.targetIds);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "pending-actions"] }),
        queryClient.invalidateQueries({
          queryKey: ["me", "pending-action", id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["work-items", "relations"],
        }),
        queryClient.invalidateQueries({ queryKey: ["work-items", "activity"] }),
        queryClient.invalidateQueries({ queryKey: ["task-relations"] }),
        queryClient.invalidateQueries({ queryKey: ["activities"] }),
        queryClient.invalidateQueries({
          queryKey: ["work-items", "attachments"],
        }),
        ...(workItemDeleted
          ? [
              queryClient.invalidateQueries({ queryKey: ["work-items"] }),
              queryClient.invalidateQueries({ queryKey: ["tasks"] }),
            ]
          : []),
        queryClient.invalidateQueries({
          queryKey: instanceUsersKey,
          refetchType: "all",
        }),
        ...(registeredTarget
          ? REGISTERED_DELETION_QUERY_KEYS.map((key) =>
              queryClient.invalidateQueries({
                queryKey: [key],
                refetchType: "all",
              }),
            )
          : []),
        ...targetPrefixes.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
        ...(executed && action.data?.targetType === "identity_connection"
          ? [
              queryClient.invalidateQueries({
                queryKey: ["god-mode", "identity-connections"],
                refetchType: "all",
              }),
            ]
          : []),
        ...(isOrganisationHardPurge
          ? [
              queryClient.invalidateQueries({
                queryKey: ["god-mode", "organisations"],
                refetchType: "all",
              }),
            ]
          : []),
      ]);
      if (!isCurrentIntent()) return;
      if (needsStepUp) setSecret("");
      if (isRegisteredTypedName || isHardPurgeTypedName) setTypedName("");
      if (isDeactivationContract) {
        setSecret("");
        setNotice(t("pendingActions:dynamic.deactivationApproved"));
      }
      if (executed) onExecuted?.();
    } catch (cause) {
      if (!isCurrentIntent()) return;
      setError(
        t(
          approvalErrorKey(
            cause,
            isRegisteredTypedName || isHardPurgeTypedName,
          ),
        ),
      );
      setSecret("");
    }
  }

  /**
   * An executed work-item (or bulk) deletion: leave the deleted task's page for the project
   * board (as Kaneo's delete did), then drop its cached task and remove it from the project
   * store, so nothing re-reads or shows the deleted record.
   */
  async function leaveDeletedWorkItems(targetIds: string[] | undefined) {
    const keys = new Set(targetIds ?? []);
    const { project } = useProjectStore.getState();
    const removedIds = new Set(
      deletedProjectTasks(project, keys).map((task) => task.id),
    );
    const onPage = TASK_PAGE_PATH.exec(location.pathname);
    if (onPage) {
      const [, workspaceId, projectId, taskId] = onPage;
      const current = queryClient.getQueryData<Pick<Task, "number">>([
        "task",
        taskId,
      ]);
      // The legacy task page never fills the project store: its project is in react-query.
      const cachedProject = queryClient.getQueryData<{ slug?: string }>([
        "projects",
        workspaceId,
        projectId,
      ]);
      const slug =
        cachedProject?.slug ?? (project?.id === projectId ? project.slug : "");
      const deletedHere =
        current?.number != null &&
        !!slug &&
        keys.has(`${slug}-${current.number}`);
      if (deletedHere) {
        await navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
          params: { workspaceId, projectId },
          replace: true,
        });
        removedIds.add(taskId);
      }
    }
    // The canonical page of a deleted item would refetch into its 404 state: return to the
    // project board first, then drop its cached detail.
    const canonicalKey = CANONICAL_PAGE_PATH.exec(location.pathname)?.[1];
    const openKey = canonicalKey ? decodeURIComponent(canonicalKey) : undefined;
    if (openKey && keys.has(openKey)) {
      const projectKey = openKey.slice(0, openKey.lastIndexOf("-"));
      if (projectKey)
        await navigate({
          href: routes.workItemList.build({ projectKey }, { layout: "board" }),
          replace: true,
        });
      queryClient.removeQueries({
        queryKey: ["work-items", "detail", openKey],
      });
    }
    for (const taskId of removedIds)
      queryClient.removeQueries({ queryKey: ["task", taskId] });
    if (project && removedIds.size > 0)
      setProject(withoutTasks(project, removedIds));
  }

  async function cancelAction() {
    const capturedIntent = actionLifecycle.capture();
    const isCurrentIntent = () => actionLifecycle.isCurrent(capturedIntent);
    setError(null);
    try {
      await cancel.mutateAsync(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "pending-actions"] }),
        queryClient.invalidateQueries({
          queryKey: ["me", "pending-action", id],
        }),
      ]);
      if (!isCurrentIntent()) return;
      setNotice(t("pendingActions:dynamic.cancelled"));
      onCancelled?.();
    } catch {
      if (!isCurrentIntent()) return;
      setError(t("pendingActions:dynamic.cancelFailed"));
    }
  }

  const actionButtons = (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={
          approve.isPending ||
          (isDeactivationContract && typedName !== email) ||
          (isRegisteredTypedName && typedName !== registeredName) ||
          (isHardPurgeTypedName && typedName !== hardPurgeSummary?.label) ||
          (isBulkDeletion && typedCount !== String(bulkSummary?.count)) ||
          (isImportChunk &&
            typedCount !== String(importChunkSummary.recordCount)) ||
          (isImportRun && typedCount !== String(importRunSummary.totalCount)) ||
          (needsStepUp &&
            (factorUnavailable ||
              (effectiveMethod !== "sso_prompt_login" && secret.length === 0)))
        }
        onClick={() => void approveAction()}
        variant={
          isClickContract ||
          isBulkDeletion ||
          isImportChunk ||
          isImportRun ||
          isRegisteredTypedName ||
          isHardPurgeTypedName
            ? "destructive"
            : "default"
        }
      >
        {isClickContract ||
        isBulkDeletion ||
        isImportChunk ||
        isImportRun ||
        isRegisteredTypedName ||
        isHardPurgeTypedName
          ? isImportRun
            ? t("pendingActions:importRun.approve")
            : isImportChunk
              ? t(
                  importChunkSummary.operation === "records"
                    ? "pendingActions:importChunk.approveRecords"
                    : "pendingActions:importChunk.approveLinks",
                )
              : t(
                  action.data.targetType === "relation"
                    ? "tasks:relations.removeRelation"
                    : "common:actions.delete",
                )
          : t("pendingActions:copy.a2b52d875e8b")}
      </Button>
      <Button
        variant="outline"
        disabled={cancel.isPending || approve.isPending}
        onClick={() => void cancelAction()}
      >
        {t("pendingActions:copy.84837a216817")}
      </Button>
    </div>
  );

  const actionLabel =
    isHardPurge && hardPurgeSummary
      ? t(
          hardPurgeSummary.targetType === "organisation"
            ? "pendingActions:hardPurge.organisationAction"
            : hardPurgeSummary.targetType === "project"
              ? "pendingActions:hardPurge.projectAction"
              : "pendingActions:hardPurge.workItemAction",
          {
            defaultValue:
              hardPurgeSummary.targetType === "organisation"
                ? "Permanently purge organisation"
                : hardPurgeSummary.targetType === "project"
                  ? "Permanently purge project"
                  : "Permanently purge request",
          },
        )
      : isHardPurge
        ? t("pendingActions:hardPurge.unavailableTitle", {
            defaultValue: "Purge summary unavailable",
          })
        : action.data.action === "delete" && action.data.targetType === "user"
          ? t("pendingActions:dynamic.deactivatePerson", { email: "" })
          : action.data.targetType === "attachment"
            ? t("pendingActions:attachment.action")
            : action.data.targetType === "comment"
              ? t("pendingActions:comment.action")
              : action.data.targetType === "relation"
                ? t("tasks:relations.removeRelation")
                : isBulkDeletion
                  ? t("pendingActions:bulk.action")
                  : action.data.targetType === "import_run"
                    ? t(
                        importRunSummary
                          ? "pendingActions:importRun.action"
                          : "pendingActions:importRun.unavailable",
                      )
                    : isImportChunkTarget
                      ? t(
                          importChunkSummary
                            ? importChunkSummary.operation === "records"
                              ? "pendingActions:importChunk.actionRecords"
                              : "pendingActions:importChunk.actionLinks"
                            : "pendingActions:importChunk.unavailable",
                        )
                      : registeredTarget
                        ? t(
                            `pendingActions:registered.actions.${registeredTarget}`,
                          )
                        : t(pendingActionLabelKey(action.data));
  // In place, the approval is the one confirmation: it is titled with the destructive
  // action (for example "Delete project"), not a generic "pending action".
  const heading =
    action.data.action === "delete" && action.data.targetType === "user"
      ? t("pendingActions:dynamic.approveDeactivation")
      : isDialog &&
          (isClickContract ||
            isBulkDeletion ||
            isImportChunk ||
            isImportRun ||
            isRegisteredTypedName ||
            isHardPurgeTypedName)
        ? actionLabel
        : t("pendingActions:dynamic.pendingAction");
  const requestedFrom = `${t("pendingActions:dynamic.requestedFrom", {
    origin: t(`pendingActions:dynamic.origins.${action.data.origin}`),
  })} ${new Date(action.data.expiresAt).toLocaleString(i18n.language)}.`;
  const content = (
    <>
      <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">
          {t("pendingActions:copy.97c89a4d6630")}
        </dt>
        <dd>{actionLabel} </dd>
        <dt className="text-muted-foreground">
          {t("pendingActions:copy.61ad50a9b918")}
        </dt>
        <dd>
          {importRunSummary ? (
            <div className="space-y-2">
              <p>
                {t("pendingActions:importRun.count", {
                  count: importRunSummary.totalCount,
                })}
              </p>
              <p>
                {t("pendingActions:importRun.writes", {
                  count: importRunSummary.writes,
                })}
              </p>
              <p className="text-muted-foreground">
                {t("pendingActions:importRun.source", {
                  plugin: importRunSummary.pluginId,
                  version: importRunSummary.mappingVersion,
                })}
              </p>
              <Link
                to={routes.godModeImportRun.path}
                params={{ id: importRunSummary.runId }}
                className="underline underline-offset-4"
              >
                {t("pendingActions:importRun.open")}
              </Link>
            </div>
          ) : importRunRedacted ? (
            t("pendingActions:importRun.hidden")
          ) : importChunkSummary ? (
            <p>
              {t(
                importChunkSummary.operation === "records"
                  ? "pendingActions:importChunk.countRecords"
                  : "pendingActions:importChunk.countLinks",
                { count: importChunkSummary.recordCount },
              )}
            </p>
          ) : importChunkRedacted ? (
            t("pendingActions:importChunk.hidden")
          ) : bulkSummary && !bulkRedacted ? (
            <div className="space-y-2">
              <p>
                {t("pendingActions:bulk.count", {
                  count: bulkSummary.count,
                })}
              </p>
              <ul
                className="max-h-64 overflow-y-auto"
                aria-label={t("pendingActions:bulk.targets")}
              >
                {bulkSummary.keys.map((key) => {
                  const target = bulkTargets.find((row) => row.key === key);
                  return (
                    <li key={key}>
                      {key}
                      {target ? ` · ${target.title}` : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : bulkRedacted ? (
            t("workItems:deletion.hidden")
          ) : attachmentSummary ? (
            <span>
              {attachmentSummary.key} · {attachmentSummary.title}
            </span>
          ) : attachmentRedacted ? (
            t("pendingActions:attachment.hidden")
          ) : commentSummary ? (
            <span>
              {commentSummary.key} · {commentSummary.title}
            </span>
          ) : commentRedacted ? (
            t("pendingActions:comment.hidden")
          ) : workItemSummary ? (
            <span>
              {workItemSummary.key} · {workItemSummary.title}
              {workItemSummary.projectName ? (
                <span className="block text-muted-foreground">
                  {t("workItems:deletion.project", {
                    project: workItemSummary.projectName,
                  })}
                </span>
              ) : null}
            </span>
          ) : workItemRedacted ? (
            t("workItems:deletion.hidden")
          ) : relationSummary ? (
            <span>
              {relationSummary.sourceKey} · {relationSummary.sourceTitle}
              {" — "}
              {t(`workItems:relations.types.${relationSummary.type}`)}
              {" — "}
              {relationSummary.targetKey} · {relationSummary.targetTitle}
            </span>
          ) : relationRedacted ? (
            t("workItems:relations.hidden", { count: 1 })
          ) : hardPurgeSummary ? (
            <span>{hardPurgeSummary.label}</span>
          ) : hardPurgeRedacted ? (
            t("pendingActions:registered.hidden")
          ) : registeredName ? (
            <span>
              {registeredName}
              {registeredProjectName ? ` · ${registeredProjectName}` : ""}
            </span>
          ) : registeredRedacted ? (
            t("pendingActions:registered.hidden")
          ) : (
            (email ?? action.data.targetIds.join(", "))
          )}
        </dd>
        <dt className="text-muted-foreground">
          {t("pendingActions:copy.bae7d5be7082")}
        </dt>
        <dd>{t(`pendingActions:dynamic.states.${action.data.state}`)}</dd>
        {action.data.invalidationReason && (
          <>
            <dt className="text-muted-foreground">
              {t("pendingActions:copy.f219cc0614ae")}
            </dt>
            <dd>
              {t(
                `pendingActions:dynamic.reasons.${action.data.invalidationReason}`,
              )}
            </dd>
          </>
        )}
      </dl>
      {attachmentSummary && (
        <section
          className="space-y-2 text-sm"
          aria-label={t("pendingActions:attachment.preview")}
        >
          <p className="break-words font-medium">
            {attachmentSummary.filename}
          </p>
          <p>
            {attachmentSummary.mimeType} ·{" "}
            {t("pendingActions:attachment.bytes", {
              count: attachmentSummary.size,
            })}
          </p>
          <p className="text-muted-foreground">
            {attachmentSummary.alreadyDeleted
              ? t("pendingActions:attachment.alreadyDeleted")
              : t("pendingActions:attachment.confirmation", {
                  hours: attachmentSummary.recoveryHours,
                })}
          </p>
          {!isDialog && (
            <Link
              to={routes.workItemDetail.path}
              params={{ key: attachmentSummary.key }}
              search={{
                sections: {
                  itemKey: attachmentSummary.key,
                  open: ["attachments"],
                },
              }}
              className="underline underline-offset-4"
            >
              {t("pendingActions:attachment.open")}
            </Link>
          )}
        </section>
      )}
      {commentSummary && (
        <section
          className="space-y-2 text-sm"
          aria-label={t("pendingActions:comment.preview")}
        >
          <p className="font-medium">
            {t(`pendingActions:comment.${commentSummary.visibility}`)}
          </p>
          <p className="whitespace-pre-wrap break-words">
            {commentSummary.alreadyDeleted
              ? t("pendingActions:comment.alreadyDeleted")
              : commentSummary.preview || t("pendingActions:comment.empty")}
          </p>
          {!isDialog && (
            <Link
              to={routes.workItemDetail.path}
              params={{ key: commentSummary.key }}
              search={{ comment: commentSummary.commentId }}
              className="underline underline-offset-4"
            >
              {t("pendingActions:comment.open")}
            </Link>
          )}
          <p className="text-muted-foreground">
            {t("pendingActions:comment.confirmation")}
          </p>
        </section>
      )}
      {bulkSummary && !bulkRedacted && (
        <div className="space-y-2 text-sm text-muted-foreground">
          {bulkProjects.length > 0 && (
            <ul>
              {bulkProjects.map((project) => (
                <li key={String(project.id ?? project.name)}>
                  {String(project.name)} · {String(project.count)}
                </li>
              ))}
            </ul>
          )}
          <p>{t("pendingActions:bulk.recovery")}</p>
          {bulkSummary.childrenAffected > 0 && (
            <p>
              {t("workItems:deletion.childrenAffected", {
                count: bulkSummary.childrenAffected,
              })}
            </p>
          )}
        </div>
      )}
      {bulkExcluded.length > 0 && (
        <section
          className="space-y-2 text-sm"
          aria-label={t("pendingActions:bulk.excluded")}
        >
          <h2 className="font-medium">{t("pendingActions:bulk.excluded")}</h2>
          <ul>
            {bulkExcluded.map((entry) => (
              <li key={String(entry.id)}>
                {String(entry.id)} · {String(entry.reason)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {bulkResult && (
        <section
          className="space-y-2 text-sm"
          role="status"
          aria-label={t("pendingActions:bulk.result", {
            succeeded: bulkResult.succeeded.length,
            failed: bulkResult.failed.length,
          })}
        >
          <h2 className="font-medium">
            {t("pendingActions:bulk.result", {
              succeeded: bulkResult.succeeded.length,
              failed: bulkResult.failed.length,
            })}
          </h2>
          <p>
            {t("pendingActions:bulk.succeeded", {
              count: bulkResult.succeeded.length,
            })}
          </p>
          <ul>
            {bulkResult.succeeded.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
          {bulkResult.failed.length > 0 && (
            <ul>
              {bulkResult.failed.map((entry) => (
                <li key={String(entry.id)}>
                  {String(entry.id)} · {String(entry.reason)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {workItemSummary && workItemSummary.childrenAffected > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("workItems:deletion.childrenAffected", {
            count: workItemSummary.childrenAffected,
          })}
        </p>
      )}
      {workItemSummary && (
        // `WI-23`: identify the customer requester, deleting actor, portal effect and retention.
        <section
          className="space-y-1 text-muted-foreground text-sm"
          aria-label={t("workItems:deletion.impact")}
        >
          {workItemSummary.requesterName ? (
            <p>
              {t("workItems:deletion.customerRequester", {
                name: workItemSummary.requesterName,
              })}
            </p>
          ) : null}
          {workItemSummary.requestedByName ? (
            <p>
              {t("workItems:deletion.requestedBy", {
                name: workItemSummary.requestedByName,
              })}
            </p>
          ) : null}
          <p>
            {t("workItems:deletion.portalVisibility", {
              visibility: t(
                `workItems:deletion.visibility.${workItemSummary.customerVisibility}`,
              ),
            })}
          </p>
          <p>
            {t(
              `workItems:deletion.portalRemoval.${workItemSummary.customerVisibility}`,
            )}
          </p>
          <p>
            {t("workItems:deletion.retention", {
              days: workItemSummary.recoveryDays,
            })}
          </p>
        </section>
      )}
      {registeredTarget === "project" && registeredProjectImpact && (
        <section
          className="space-y-1 text-muted-foreground text-sm"
          aria-label={t("pendingActions:registered.projectImpact")}
        >
          <p>
            {t("pendingActions:registered.projectWorkItems", {
              count: registeredProjectImpact.workItems,
            })}
          </p>
          <p>
            {t("pendingActions:registered.projectLegacyTasks", {
              count: registeredProjectImpact.legacyTasks,
            })}
          </p>
          <p>
            {t("pendingActions:registered.projectMembers", {
              count: registeredProjectImpact.members,
            })}
          </p>
          <p>
            {t("pendingActions:registered.projectAttachments", {
              count: registeredProjectImpact.attachments,
            })}
          </p>
          <p>
            {t("pendingActions:registered.projectWorkflowRules", {
              count: registeredProjectImpact.workflowRules,
            })}
          </p>
          <p>
            {t("pendingActions:registered.projectSourceLinks", {
              count: registeredProjectImpact.sourceLinks,
            })}
          </p>
          <p>
            {t("pendingActions:registered.projectRecovery", {
              days:
                typeof action.data.summary?.recoveryDays === "number"
                  ? action.data.summary.recoveryDays
                  : 30,
            })}
          </p>
        </section>
      )}
      {isHardPurge &&
        (hardPurgeSummary ? (
          <section
            className="space-y-3 text-sm"
            aria-label={t("pendingActions:hardPurge.impactTitle", {
              defaultValue: "Purge impact",
            })}
          >
            <Alert variant="warning">
              <AlertTitle>
                {t("pendingActions:hardPurge.impactTitle", {
                  defaultValue: "Purge impact",
                })}
              </AlertTitle>
              <AlertDescription>
                {t(
                  isOrganisationHardPurge
                    ? "pendingActions:hardPurge.irreversibleImpact"
                    : "pendingActions:hardPurge.irreversibleTargetImpact",
                  {
                    defaultValue: isOrganisationHardPurge
                      ? "This permanently removes the organisation and its customer data. Audit history is retained, and unrelated projects in shared workspaces are preserved."
                      : "This permanently removes the selected soft-deleted target and its retained data. Audit history is retained.",
                  },
                )}
              </AlertDescription>
            </Alert>
            <ul className="space-y-1 text-muted-foreground">
              <li>
                {t("pendingActions:hardPurge.workItemsCount", {
                  count: hardPurgeSummary.workItems,
                  defaultValue: `Requests and work items: ${hardPurgeSummary.workItems}`,
                })}
              </li>
              <li>
                {t("pendingActions:hardPurge.commentsCount", {
                  count: hardPurgeSummary.comments,
                  defaultValue: `Comments: ${hardPurgeSummary.comments}`,
                })}
              </li>
              <li>
                {t("pendingActions:hardPurge.attachmentsCount", {
                  count: hardPurgeSummary.attachments,
                  defaultValue: `Attachments: ${hardPurgeSummary.attachments}`,
                })}
              </li>
              {hardPurgeSummary.organisationImpact ? (
                <>
                  <li>
                    {t("pendingActions:hardPurge.organisationsCount", {
                      count: hardPurgeSummary.organisationImpact.organisations,
                      defaultValue: `Organisations: ${hardPurgeSummary.organisationImpact.organisations}`,
                    })}
                  </li>
                  <li>
                    {t("pendingActions:hardPurge.projectsCount", {
                      count: hardPurgeSummary.organisationImpact.projects,
                      defaultValue: `Projects: ${hardPurgeSummary.organisationImpact.projects}`,
                    })}
                  </li>
                  <li>
                    {t("pendingActions:hardPurge.peopleCount", {
                      count: hardPurgeSummary.organisationImpact.people,
                      defaultValue: `People: ${hardPurgeSummary.organisationImpact.people}`,
                    })}
                  </li>
                  <li>
                    {t("pendingActions:hardPurge.submissionsCount", {
                      count: hardPurgeSummary.organisationImpact.submissions,
                      defaultValue: `Portal submissions: ${hardPurgeSummary.organisationImpact.submissions}`,
                    })}
                  </li>
                  <li>
                    {t("pendingActions:hardPurge.storageObjectsCount", {
                      count:
                        hardPurgeSummary.organisationImpact
                          .storageObjectsQueued,
                      defaultValue: `Storage objects queued for cleanup: ${hardPurgeSummary.organisationImpact.storageObjectsQueued}`,
                    })}
                  </li>
                </>
              ) : null}
            </ul>
            <p>
              {t("pendingActions:hardPurge.noLegalHold", {
                defaultValue: "Legal hold check: none found.",
              })}
            </p>
            <p>
              {t("pendingActions:hardPurge.retention", {
                defaultValue:
                  "Retention check: this target is already soft-deleted.",
              })}
            </p>
          </section>
        ) : (
          <Alert variant="error">
            <AlertTitle>
              {t("pendingActions:hardPurge.unavailableTitle", {
                defaultValue: "Purge summary unavailable",
              })}
            </AlertTitle>
            <AlertDescription>
              {t("pendingActions:hardPurge.unavailableDescription", {
                defaultValue:
                  "Reload this pending action before approving. The target and eligibility details could not be verified.",
              })}
            </AlertDescription>
          </Alert>
        ))}
      {action.data.action === "delete" && action.data.targetType === "user" && (
        <p className="text-sm text-muted-foreground">
          {t("pendingActions:copy.71f269fe7eee")}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {action.data.action === "delete" &&
        action.data.targetType === "user" &&
        !isPending &&
        !isDialog && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("pendingActions:requestFreshDeactivation")}
            </p>
            <Button
              variant="outline"
              render={<Link to={routes.godModeUsers.path as never} />}
            >
              {t("pendingActions:openUsers")}
            </Button>
          </div>
        )}
      {canApprove && (
        <div className={isDialog ? "space-y-4" : "space-y-4 border-t pt-4"}>
          {isDeactivationContract && (
            <div className="space-y-2">
              <Label htmlFor="confirm-current-email">
                {t("pendingActions:copy.c65f42061785")}
              </Label>
              <Input
                id="confirm-current-email"
                autoComplete="off"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{email}</p>
            </div>
          )}
          {(isRegisteredTypedName && registeredName) ||
          (isHardPurgeTypedName && hardPurgeSummary) ? (
            <div className="space-y-2">
              <Label htmlFor="confirm-target-name">
                {t(
                  isHardPurgeTypedName
                    ? "pendingActions:hardPurge.confirmTarget"
                    : registeredTarget === "project"
                      ? "pendingActions:registered.confirmProjectKey"
                      : "pendingActions:registered.confirmName",
                  {
                    defaultValue: isHardPurgeTypedName
                      ? "Type the exact target label"
                      : "Type the exact name",
                  },
                )}
              </Label>
              <Input
                id="confirm-target-name"
                autoComplete="off"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {hardPurgeSummary?.label ?? registeredName}
              </p>
            </div>
          ) : null}
          {isBulkDeletion && bulkSummary && (
            <div className="space-y-2">
              <Label htmlFor="confirm-item-count">
                {t("pendingActions:bulk.confirmCount", {
                  count: bulkSummary.count,
                })}
              </Label>
              <Input
                id="confirm-item-count"
                inputMode="numeric"
                autoComplete="off"
                value={typedCount}
                onChange={(event) => setTypedCount(event.target.value)}
              />
            </div>
          )}
          {isImportChunk && importChunkSummary && (
            <div className="space-y-2">
              <Label htmlFor="confirm-import-chunk-count">
                {t(
                  importChunkSummary.operation === "records"
                    ? "pendingActions:importChunk.confirmRecords"
                    : "pendingActions:importChunk.confirmLinks",
                  { count: importChunkSummary.recordCount },
                )}
              </Label>
              <Input
                id="confirm-import-chunk-count"
                inputMode="numeric"
                autoComplete="off"
                value={typedCount}
                onChange={(event) => setTypedCount(event.currentTarget.value)}
              />
            </div>
          )}
          {isImportRun && importRunSummary && (
            <div className="space-y-2">
              <Label htmlFor="confirm-import-run-count">
                {t("pendingActions:importRun.confirm", {
                  count: importRunSummary.totalCount,
                })}
              </Label>
              <Input
                id="confirm-import-run-count"
                inputMode="numeric"
                autoComplete="off"
                value={typedCount}
                onChange={(event) => setTypedCount(event.currentTarget.value)}
              />
            </div>
          )}
          {needsStepUp && (
            <>
              {availableMethods.length > 1 && (
                <div className="space-y-2">
                  <Label htmlFor="pending-action-step-up-method">
                    {t("pendingActions:copy.3a725803c822")}
                  </Label>
                  <Select
                    value={method}
                    onValueChange={(value) => {
                      if (availableMethods.includes(value as StepUpMethod)) {
                        setMethod(value as StepUpMethod);
                        setSecret("");
                      }
                    }}
                  >
                    <SelectTrigger id="pending-action-step-up-method">
                      <SelectValue>
                        {method === "password"
                          ? t("pendingActions:dynamic.accountPassword")
                          : method === "totp"
                            ? t("pendingActions:copy.2908b4e9c428")
                            : method === "backup_code"
                              ? t("pendingActions:copy.2a8367498e23")
                              : t("identityConnections:stepUp.ssoPromptLogin")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {availableMethods.map((availableMethod) => (
                        <SelectItem
                          key={availableMethod}
                          value={availableMethod}
                        >
                          {availableMethod === "password"
                            ? t("pendingActions:dynamic.accountPassword")
                            : availableMethod === "totp"
                              ? t("pendingActions:copy.2908b4e9c428")
                              : availableMethod === "backup_code"
                                ? t("pendingActions:copy.2a8367498e23")
                                : t(
                                    "identityConnections:stepUp.ssoPromptLogin",
                                  )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {effectiveMethod === "sso_prompt_login" ? (
                <p className="text-sm text-muted-foreground">
                  {t("identityConnections:stepUp.ssoPromptLoginDescription")}
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="pending-action-step-up-secret">
                    {t(
                      effectiveMethod === "password"
                        ? "pendingActions:dynamic.accountPassword"
                        : effectiveMethod === "totp"
                          ? "pendingActions:dynamic.authenticatorCode"
                          : "pendingActions:dynamic.backupCode",
                    )}
                  </Label>
                  <Input
                    id="pending-action-step-up-secret"
                    type={effectiveMethod === "password" ? "password" : "text"}
                    autoComplete={
                      effectiveMethod === "password"
                        ? "current-password"
                        : "one-time-code"
                    }
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </div>
              )}
              {factorUnavailable && (
                <Alert variant="error">
                  <AlertTitle>
                    {t("pendingActions:copy.02c7fa45ff1a")}
                  </AlertTitle>
                  <AlertDescription>
                    {t("pendingActions:copy.8a8c6877113f")}
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
          {!isDialog && actionButtons}
        </div>
      )}
      {isPending && !canApprove && (
        <Alert>
          <AlertTitle>{t("pendingActions:copy.e76b511b0a44")}</AlertTitle>
          <AlertDescription>
            {t("pendingActions:copy.d3d84fb23a45")}
          </AlertDescription>
        </Alert>
      )}
      {!isPending && !isDialog && (
        <Link to={routes.pendingActions.path as never}>
          {t("pendingActions:copy.c4c695a8da8e")}
        </Link>
      )}
    </>
  );

  if (isDialog)
    return (
      <>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{requestedFrom}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">{content}</div>
        </DialogPanel>
        {canApprove && <DialogFooter>{actionButtons}</DialogFooter>}
      </>
    );

  return (
    <div className="flex min-h-full w-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title={t("pendingActions:copy.a93eb80c8601")} />
      <header>
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{requestedFrom}</p>
      </header>
      <Card>
        <CardContent className="space-y-4 py-5">{content}</CardContent>
      </Card>
    </div>
  );
}
