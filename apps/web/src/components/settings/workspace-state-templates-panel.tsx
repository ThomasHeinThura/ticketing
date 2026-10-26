import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Input,
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
import {
  createWorkspaceStateTemplate,
  getWorkspaceStateTemplates,
  patchWorkspaceStateTemplate,
  WorkspaceSettingsError,
  type WorkspaceStateTemplate,
} from "@/fetchers/project-settings-inheritance";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";

const GROUPS: WorkspaceStateTemplate["group"][] = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
];

type TemplateDraft = Pick<WorkspaceStateTemplate, "name" | "group">;

export function WorkspaceStateTemplatesPanel({
  workspaceId,
  showHeading = true,
}: {
  workspaceId: string;
  showHeading?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canManageWorkspaceSettings, isCheckingPermissions } =
    useWorkspacePermission(workspaceId);
  const canEdit = canManageWorkspaceSettings();
  const queryKey = ["workspace", workspaceId, "state-templates"] as const;
  const templatesQuery = useQuery({
    queryKey,
    queryFn: () => getWorkspaceStateTemplates(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const [drafts, setDrafts] = useState<Record<string, TemplateDraft>>({});
  const [hydratedVersion, setHydratedVersion] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] =
    useState<WorkspaceStateTemplate["group"]>("backlog");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<
    "stale" | "forbidden" | "generic" | null
  >(null);
  const [impact, setImpact] = useState<{
    items: WorkspaceSettingsError["affectedItems"];
    hasHidden: boolean;
  } | null>(null);

  useEffect(() => {
    const value = templatesQuery.data;
    if (!value || `${workspaceId}:${value.version}` === hydratedVersion) return;
    setDrafts(
      Object.fromEntries(
        value.templates.map((item) => [
          item.id,
          { name: item.name, group: item.group },
        ]),
      ),
    );
    setHydratedVersion(`${workspaceId}:${value.version}`);
    setFailure(null);
    setImpact(null);
  }, [templatesQuery.data, hydratedVersion, workspaceId]);
  useEffect(() => {
    if (
      templatesQuery.error instanceof HttpError &&
      templatesQuery.error.status === 403
    ) {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", workspaceId],
      });
    }
  }, [templatesQuery.error, queryClient, workspaceId]);

  const refreshCapabilities = () =>
    queryClient.invalidateQueries({
      queryKey: ["workspace-capabilities", workspaceId],
    });
  const handleError = (error: unknown) => {
    setFailure(
      error instanceof WorkspaceSettingsError && error.status === 409
        ? "stale"
        : error instanceof WorkspaceSettingsError && error.status === 403
          ? "forbidden"
          : "generic",
    );
    if (error instanceof WorkspaceSettingsError && error.status === 403) {
      void refreshCapabilities();
    }
    if (
      error instanceof WorkspaceSettingsError &&
      error.status === 409 &&
      error.code === "state_in_use"
    ) {
      setImpact({
        items: error.affectedItems,
        hasHidden: error.hasHiddenAffectedItems,
      });
      void templatesQuery.refetch();
    } else if (
      error instanceof WorkspaceSettingsError &&
      error.status === 409
    ) {
      void templatesQuery.refetch();
    }
  };
  const replaceData = async (
    value: Awaited<ReturnType<typeof getWorkspaceStateTemplates>>,
  ) => {
    queryClient.setQueryData(queryKey, value);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({
        queryKey: ["workspace", workspaceId, "project-settings"],
      }),
    ]);
    setHydratedVersion(`${workspaceId}:${value.version}`);
    setDrafts(
      Object.fromEntries(
        value.templates.map((item) => [
          item.id,
          { name: item.name, group: item.group },
        ]),
      ),
    );
    setImpact(null);
    setFailure(null);
  };
  const saveTemplate = async (item: WorkspaceStateTemplate) => {
    const current = templatesQuery.data;
    const draft = drafts[item.id];
    if (!current || !draft || !canEdit || savingId) return;
    const changed = draft.name !== item.name || draft.group !== item.group;
    if (!changed) return;
    setSavingId(item.id);
    setFailure(null);
    try {
      await patchWorkspaceStateTemplate(workspaceId, item.id, {
        expectedVersion: current.version,
        ...(draft.name !== item.name ? { name: draft.name } : {}),
        ...(draft.group !== item.group ? { group: draft.group } : {}),
      });
      const refreshed = await templatesQuery.refetch();
      if (refreshed.data) await replaceData(refreshed.data);
    } catch (error) {
      handleError(error);
    } finally {
      setSavingId(null);
    }
  };
  const toggleEnabled = async (item: WorkspaceStateTemplate) => {
    const current = templatesQuery.data;
    if (!current || !canEdit || savingId) return;
    setSavingId(item.id);
    setFailure(null);
    setImpact(null);
    try {
      await patchWorkspaceStateTemplate(workspaceId, item.id, {
        expectedVersion: current.version,
        enabled: !item.enabled,
      });
      const refreshed = await templatesQuery.refetch();
      if (refreshed.data) await replaceData(refreshed.data);
    } catch (error) {
      handleError(error);
    } finally {
      setSavingId(null);
    }
  };
  const createTemplate = async () => {
    const current = templatesQuery.data;
    if (!current || !canEdit || creating) return;
    setCreating(true);
    setFailure(null);
    try {
      await createWorkspaceStateTemplate(workspaceId, {
        expectedVersion: current.version,
        key: newKey.trim(),
        name: newName.trim(),
        group: newGroup,
      });
      const refreshed = await templatesQuery.refetch();
      if (refreshed.data) await replaceData(refreshed.data);
      setNewKey("");
      setNewName("");
      setNewGroup("backlog");
    } catch (error) {
      handleError(error);
    } finally {
      setCreating(false);
    }
  };

  if (templatesQuery.isLoading) {
    return (
      <section
        className="space-y-3"
        aria-busy="true"
        data-testid="workspace-state-templates-loading"
      >
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </section>
    );
  }

  if (templatesQuery.isError || !templatesQuery.data) {
    return (
      <section
        className="space-y-3"
        aria-labelledby="workspace-state-templates-title"
      >
        {showHeading && (
          <h2
            id="workspace-state-templates-title"
            className="text-md font-medium"
          >
            {t("settings:workspaceStateTemplates.title")}
          </h2>
        )}
        <Alert variant="error" role="alert">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {templatesQuery.error instanceof HttpError &&
            templatesQuery.error.status === 403
              ? t("settings:workspaceStateTemplates.forbidden")
              : t("settings:workspaceStateTemplates.loadError")}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void templatesQuery.refetch()}
            >
              {t("settings:workspaceStateTemplates.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const stateTemplates = templatesQuery.data.templates;
  return (
    <section
      className="space-y-4"
      aria-labelledby="workspace-state-templates-title"
      data-testid="workspace-state-templates"
    >
      {showHeading && (
        <div className="space-y-1">
          <h2
            id="workspace-state-templates-title"
            className="text-md font-medium"
          >
            {t("settings:workspaceStateTemplates.title")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("settings:workspaceStateTemplates.description")}
          </p>
        </div>
      )}
      <div className="space-y-2">
        {stateTemplates.map((item) => {
          const draft = drafts[item.id] ?? {
            name: item.name,
            group: item.group,
          };
          const dirty = draft.name !== item.name || draft.group !== item.group;
          return (
            <div
              key={item.id}
              className="grid gap-3 rounded-md border border-border bg-sidebar p-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_auto_auto] sm:items-center"
              data-testid={`state-template-${item.id}`}
            >
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">
                  {item.key}
                </p>
                <Input
                  aria-label={t("settings:workspaceStateTemplates.name")}
                  value={draft.name}
                  disabled={!canEdit || !item.enabled || savingId === item.id}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [item.id]: { ...draft, name: event.target.value },
                    }))
                  }
                />
              </div>
              <Select
                items={GROUPS.map((group) => ({
                  value: group,
                  label: t(`settings:workspaceStateTemplates.groups.${group}`),
                }))}
                value={draft.group}
                disabled={!canEdit || !item.enabled || savingId === item.id}
                onValueChange={(value) => {
                  if (GROUPS.includes(value as WorkspaceStateTemplate["group"]))
                    setDrafts((current) => ({
                      ...current,
                      [item.id]: {
                        ...draft,
                        group: value as WorkspaceStateTemplate["group"],
                      },
                    }));
                }}
              >
                <SelectTrigger
                  aria-label={t("settings:workspaceStateTemplates.group")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUPS.map((group) => (
                    <SelectItem key={group} value={group}>
                      {t(`settings:workspaceStateTemplates.groups.${group}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    !dirty || savingId === item.id || isCheckingPermissions
                  }
                  onClick={() => void saveTemplate(item)}
                >
                  {t("settings:workspaceStateTemplates.save")}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {item.enabled
                  ? t("settings:workspaceStateTemplates.enabled")
                  : t("settings:workspaceStateTemplates.disabled")}
              </span>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={
                    dirty || savingId === item.id || isCheckingPermissions
                  }
                  onClick={() => void toggleEnabled(item)}
                >
                  {item.enabled
                    ? t("settings:workspaceStateTemplates.disable")
                    : t("settings:workspaceStateTemplates.enable")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <div className="grid gap-3 rounded-md border border-border bg-sidebar p-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_auto] sm:items-end">
          <div className="space-y-1">
            <label
              className="text-xs font-medium"
              htmlFor="new-state-template-key"
            >
              {t("settings:workspaceStateTemplates.key")}
            </label>
            <Input
              id="new-state-template-key"
              value={newKey}
              disabled={creating}
              onChange={(event) => setNewKey(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-xs font-medium"
              htmlFor="new-state-template-name"
            >
              {t("settings:workspaceStateTemplates.name")}
            </label>
            <Input
              id="new-state-template-name"
              value={newName}
              disabled={creating}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <Select
            items={GROUPS.map((group) => ({
              value: group,
              label: t(`settings:workspaceStateTemplates.groups.${group}`),
            }))}
            value={newGroup}
            disabled={creating}
            onValueChange={(value) => {
              if (GROUPS.includes(value as WorkspaceStateTemplate["group"]))
                setNewGroup(value as WorkspaceStateTemplate["group"]);
            }}
          >
            <SelectTrigger
              aria-label={t("settings:workspaceStateTemplates.group")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map((group) => (
                <SelectItem key={group} value={group}>
                  {t(`settings:workspaceStateTemplates.groups.${group}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={
              !newKey.trim() ||
              !newName.trim() ||
              creating ||
              isCheckingPermissions
            }
            onClick={() => void createTemplate()}
          >
            {t("settings:workspaceStateTemplates.create")}
          </Button>
        </div>
      )}
      {failure && (
        <Alert variant="error" role="alert">
          <AlertDescription>
            {t(`settings:workspaceStateTemplates.${failure}`)}
          </AlertDescription>
        </Alert>
      )}
      {impact && (
        <Alert
          variant="error"
          role="alert"
          data-testid="state-template-disable-impact"
        >
          <AlertDescription className="space-y-2">
            <p>{t("settings:workspaceStateTemplates.disableImpact")}</p>
            {impact.items.length > 0 && (
              <ul className="list-disc pl-5">
                {impact.items.map((item) => (
                  <li key={item.id}>
                    {item.projectName}: {item.key} — {item.title}
                  </li>
                ))}
              </ul>
            )}
            {impact.hasHidden && (
              <p>{t("settings:workspaceStateTemplates.hiddenAffectedItems")}</p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

export function WorkspaceStateTemplatesPage() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  return (
    <>
      <PageTitle title={t("settings:workspaceStateTemplates.title")} />
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1
            id="workspace-state-templates-title"
            className="text-2xl font-semibold"
          >
            {t("settings:workspaceStateTemplates.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceStateTemplates.description")}
          </p>
        </div>
        {workspace?.id ? (
          <WorkspaceStateTemplatesPanel
            workspaceId={workspace.id}
            showHeading={false}
          />
        ) : null}
      </div>
    </>
  );
}
