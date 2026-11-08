import { useMutation } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
  Checkbox,
  CheckboxGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@taskdesk/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AnnouncementSeverityBadge,
  type AnnouncementState,
  announcementState,
} from "@/components/announcements/announcement-severity-badge";
import { DateTimePicker } from "@/components/common/date-time-picker";
import PageTitle from "@/components/page-title";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_SEVERITIES,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementSeverity,
  createAnnouncement,
  requestAnnouncementDeletion,
  setAnnouncementPublished,
  updateAnnouncement,
} from "@/fetchers/announcements";
import {
  useAnnouncementAudienceOptions,
  useAnnouncements,
} from "@/hooks/queries/announcements";
import {
  useCatalogueStatus,
  useInvalidateServiceManagement,
} from "@/hooks/queries/service-management";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import {
  CatalogueOff,
  LoadingRows,
  MutationError,
  PageFrame,
  QueryFailure,
  SectionNav,
} from "./shared";

const STATE_VARIANT = {
  draft: "outline",
  scheduled: "secondary",
  live: "success",
  ended: "secondary",
} as const satisfies Record<
  AnnouncementState,
  "outline" | "secondary" | "success"
>;

function AudiencePicker({
  id,
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  options: Array<{ id: string; name: string; hint?: string }>;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation("serviceManagement");
  if (options.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("announcements.fields.noTargets")}
      </p>
    );
  return (
    <CheckboxGroup
      aria-label={label}
      className="max-h-48 w-full gap-2 overflow-y-auto rounded-md border border-border p-3"
      value={value}
      onValueChange={(selected) =>
        onChange(
          selected.filter(
            (entry): entry is string => typeof entry === "string",
          ),
        )
      }
    >
      {options.map((option) => (
        <Label
          key={option.id}
          htmlFor={`${id}-${option.id}`}
          className="flex w-full items-center gap-2 font-normal"
        >
          <Checkbox
            id={`${id}-${option.id}`}
            value={option.id}
            disabled={disabled}
          />
          <span className="truncate">{option.name}</span>
          {option.hint ? (
            <span className="truncate text-xs text-muted-foreground">
              {option.hint}
            </span>
          ) : null}
        </Label>
      ))}
    </CheckboxGroup>
  );
}

/** D7: write or edit an announcement. Saving never publishes; publishing is a separate action. */
function AnnouncementDialog({
  workspaceId,
  announcement,
  onClose,
}: {
  workspaceId: string;
  announcement?: Announcement;
  onClose: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const options = useAnnouncementAudienceOptions(workspaceId);
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [severity, setSeverity] = useState<AnnouncementSeverity>(
    announcement?.severity ?? "info",
  );
  // "All customers" needs reach to every customer project; a new notice by anyone else starts
  // with specific organisations. A stored workspace audience stays selectable when editing.
  const canAddressWorkspace = options.data?.canAddressWorkspace !== false;
  const workspaceSelectable =
    canAddressWorkspace || announcement?.audience === "workspace";
  const [chosenAudience, setAudience] = useState<AnnouncementAudience | null>(
    announcement?.audience ?? null,
  );
  const audience: AnnouncementAudience =
    chosenAudience ?? (canAddressWorkspace ? "workspace" : "organisations");
  const [organisationIds, setOrganisationIds] = useState<string[]>(
    announcement?.organisations.map((entry) => entry.id) ?? [],
  );
  const [projectIds, setProjectIds] = useState<string[]>(
    announcement?.projects.map((entry) => entry.id) ?? [],
  );
  const [startsAt, setStartsAt] = useState<string | null>(
    announcement?.startsAt ?? new Date().toISOString(),
  );
  const [endsAt, setEndsAt] = useState<string | null>(
    announcement?.endsAt ?? null,
  );
  const rangeValid =
    Boolean(startsAt) &&
    (!endsAt || new Date(endsAt).getTime() > new Date(startsAt ?? 0).getTime());
  const targetsValid =
    audience === "workspace" ||
    (audience === "organisations" && organisationIds.length > 0) ||
    (audience === "projects" && projectIds.length > 0);
  const canSave = Boolean(title.trim()) && rangeValid && targetsValid;
  const save = useMutation({
    mutationFn: () => {
      const input = {
        title: title.trim(),
        body,
        severity,
        audience,
        organisationIds: audience === "organisations" ? organisationIds : [],
        projectIds: audience === "projects" ? projectIds : [],
        startsAt: startsAt ?? undefined,
        endsAt,
      };
      return announcement
        ? updateAnnouncement(announcement.id, {
            ...input,
            version: announcement.version,
          })
        : createAnnouncement(workspaceId, input);
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {announcement
              ? t("announcements.edit.title")
              : t("announcements.create.title")}
          </DialogTitle>
          <DialogDescription>
            {t("announcements.create.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave && !save.isPending) save.mutate();
          }}
        >
          <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6">
            <div className="space-y-2">
              <Label htmlFor="announcement-title">
                {t("announcements.fields.title")}
              </Label>
              <Input
                id="announcement-title"
                autoFocus
                required
                maxLength={200}
                value={title}
                disabled={save.isPending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="announcement-severity">
                  {t("announcements.fields.severity")}
                </Label>
                <Select
                  items={ANNOUNCEMENT_SEVERITIES.map((value) => ({
                    value,
                    label: t(`announcements.severity.${value}`),
                  }))}
                  value={severity}
                  onValueChange={(value) =>
                    value && setSeverity(value as AnnouncementSeverity)
                  }
                >
                  <SelectTrigger id="announcement-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANNOUNCEMENT_SEVERITIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`announcements.severity.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="announcement-audience">
                  {t("announcements.fields.audience")}
                </Label>
                <Select
                  items={ANNOUNCEMENT_AUDIENCES.map((value) => ({
                    value,
                    label: t(`announcements.audience.${value}`),
                  }))}
                  value={audience}
                  onValueChange={(value) =>
                    value && setAudience(value as AnnouncementAudience)
                  }
                >
                  <SelectTrigger id="announcement-audience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANNOUNCEMENT_AUDIENCES.map((value) => (
                      <SelectItem
                        key={value}
                        value={value}
                        disabled={value === "workspace" && !workspaceSelectable}
                      >
                        {t(`announcements.audience.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {canAddressWorkspace ? null : (
              <p className="text-muted-foreground text-sm">
                {t("announcements.fields.workspaceNeedsReach")}
              </p>
            )}
            {audience === "organisations" ? (
              <div className="space-y-2">
                <p className="font-medium text-sm">
                  {t("announcements.fields.organisations")}
                </p>
                <AudiencePicker
                  id="announcement-organisation"
                  label={t("announcements.fields.organisations")}
                  options={options.data?.organisations ?? []}
                  value={organisationIds}
                  disabled={save.isPending}
                  onChange={setOrganisationIds}
                />
              </div>
            ) : null}
            {audience === "projects" ? (
              <div className="space-y-2">
                <p className="font-medium text-sm">
                  {t("announcements.fields.projects")}
                </p>
                <AudiencePicker
                  id="announcement-project"
                  label={t("announcements.fields.projects")}
                  options={(options.data?.projects ?? []).map((project) => ({
                    id: project.id,
                    name: project.name,
                    hint: project.organisationName,
                  }))}
                  value={projectIds}
                  disabled={save.isPending}
                  onChange={setProjectIds}
                />
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="announcement-start">
                  {t("announcements.fields.startsAt")}
                </Label>
                <DateTimePicker
                  id="announcement-start"
                  label={t("announcements.fields.startsAt")}
                  value={startsAt}
                  disabled={save.isPending}
                  onChange={setStartsAt}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="announcement-end">
                  {t("announcements.fields.endsAt")}
                </Label>
                <div className="flex items-center gap-2">
                  <DateTimePicker
                    id="announcement-end"
                    label={t("announcements.fields.endsAt")}
                    value={endsAt}
                    disabled={save.isPending}
                    onChange={setEndsAt}
                  />
                  {endsAt ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={save.isPending}
                      onClick={() => setEndsAt(null)}
                    >
                      {t("announcements.fields.noEnd")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            {!rangeValid ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {t("announcements.rangeInvalid")}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="announcement-body">
                {t("announcements.fields.body")}
              </Label>
              <Textarea
                id="announcement-body"
                rows={6}
                maxLength={20000}
                value={body}
                disabled={save.isPending}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            <MutationError error={save.error} />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={save.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || !canSave}>
              {announcement
                ? t("common.save")
                : t("announcements.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function audienceSummary(
  announcement: Announcement,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (announcement.audience === "organisations")
    return announcement.organisations.map((entry) => entry.name).join(", ");
  if (announcement.audience === "projects")
    return announcement.projects.map((entry) => entry.name).join(", ");
  return t("announcements.audience.workspace");
}

/**
 * A control the caller may not use on this notice: disabled, with the reason in a tooltip on
 * hover. The trigger wraps the button because a disabled button receives no pointer events;
 * keyboard and screen-reader users get the same reason from the card (`aria-describedby`).
 */
function ReachLocked({
  locked,
  reason,
  children,
}: {
  locked: boolean;
  reason: string;
  children: ReactElement;
}) {
  if (!locked) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function AnnouncementCard({
  announcement,
  onEdit,
}: {
  announcement: Announcement;
  onEdit: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const openPendingAction = useOpenPendingAction();
  const state = announcementState(announcement);
  // The API refuses (422) publishing a notice, and changing a published one, unless the caller
  // reaches every customer it addresses; `reachesAudience` is that rule from the server.
  const beyondReach = !announcement.reachesAudience;
  const published = announcement.publishedAt !== null;
  const changeBeyondReach = beyondReach && published;
  const reasonId = useId();
  const reachReason = changeBeyondReach
    ? t("announcements.fields.publishedNeedsReach")
    : announcement.audience === "workspace"
      ? t("announcements.fields.workspaceNeedsReach")
      : t("announcements.fields.publishNeedsReach");
  const publish = useMutation({
    mutationFn: () =>
      setAnnouncementPublished(
        announcement.id,
        announcement.version,
        !announcement.publishedAt,
      ),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => requestAnnouncementDeletion(announcement.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(error.message),
  });
  const window = announcement.endsAt
    ? t("announcements.list.window", {
        start: formatDateTime(announcement.startsAt),
        end: formatDateTime(announcement.endsAt),
      })
    : t("announcements.list.from", {
        start: formatDateTime(announcement.startsAt),
      });
  return (
    <Card>
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-words sm:truncate">
            {announcement.title}
          </span>
          <AnnouncementSeverityBadge
            severity={announcement.severity}
            label={t(`announcements.severity.${announcement.severity}`)}
          />
          <Badge variant={STATE_VARIANT[state]}>
            {t(`announcements.state.${state}`)}
          </Badge>
        </CardTitle>
        <CardDescription>
          {audienceSummary(announcement, t)} · {window}
          {beyondReach ? (
            <span id={reasonId} className="block">
              {reachReason}
            </span>
          ) : null}
        </CardDescription>
        {/* Below `sm` the actions sit on their own row under the text, so the title, audience
            and reach reason get the full card width on phones (as in custom-fields-list). */}
        <CardAction className="col-start-1 row-span-1 row-start-3 flex flex-wrap gap-1 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
          <ReachLocked locked={beyondReach} reason={reachReason}>
            <Button
              variant={published ? "outline" : "default"}
              size="sm"
              disabled={publish.isPending || beyondReach}
              aria-describedby={beyondReach ? reasonId : undefined}
              onClick={() => publish.mutate()}
            >
              {published
                ? t("announcements.actions.unpublish")
                : t("announcements.actions.publish")}
            </Button>
          </ReachLocked>
          <ReachLocked locked={changeBeyondReach} reason={reachReason}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("announcements.actions.edit", {
                title: announcement.title,
              })}
              disabled={changeBeyondReach}
              aria-describedby={changeBeyondReach ? reasonId : undefined}
              onClick={onEdit}
            >
              <Pencil aria-hidden="true" />
            </Button>
          </ReachLocked>
          <ReachLocked locked={changeBeyondReach} reason={reachReason}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("announcements.actions.delete", {
                title: announcement.title,
              })}
              disabled={remove.isPending || changeBeyondReach}
              aria-describedby={changeBeyondReach ? reasonId : undefined}
              onClick={() => remove.mutate()}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </ReachLocked>
        </CardAction>
      </CardHeader>
      {announcement.body ? (
        <CardPanel>
          <p className="line-clamp-3 whitespace-pre-line text-muted-foreground text-sm">
            {announcement.body}
          </p>
        </CardPanel>
      ) : null}
    </Card>
  );
}

/** D7 "Announcements": notices customers see in the portal, managed under `service:manage`. */
export function AnnouncementsList() {
  const { t } = useTranslation("serviceManagement");
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const status = useCatalogueStatus(workspaceId);
  // With the catalogue off `GET /api/announcements` answers 409: no request, no New button.
  const catalogueOff = status.data?.enabled === false;
  const canManage = status.data?.canManageServices === true && !catalogueOff;
  const { canManageWorkspaceSettings } = useWorkspacePermission();
  const announcements = useAnnouncements(workspaceId, canManage);
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  return (
    <>
      <PageTitle title={t("announcements.list.title")} />
      <PageFrame
        title={t("announcements.list.title")}
        description={t("announcements.list.description")}
        actions={
          canManage ? (
            <Button onClick={() => setEditing("new")} disabled={!workspace}>
              <Plus aria-hidden="true" />
              {t("announcements.list.new")}
            </Button>
          ) : null
        }
      >
        <SectionNav active="announcements" />
        {status.isLoading || !workspace ? (
          <LoadingRows />
        ) : catalogueOff ? (
          <CatalogueOff canManageFeatures={canManageWorkspaceSettings()} />
        ) : !canManage ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("announcements.forbidden.title")}</EmptyTitle>
              <EmptyDescription>
                {t("announcements.forbidden.description")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : announcements.isLoading ? (
          <LoadingRows />
        ) : announcements.isError ? (
          <QueryFailure
            error={announcements.error}
            onRetry={() => void announcements.refetch()}
          />
        ) : announcements.data?.length ? (
          <CardFrame>
            {announcements.data.map((announcement) => (
              <AnnouncementCard
                key={announcement.id}
                announcement={announcement}
                onEdit={() => setEditing(announcement)}
              />
            ))}
          </CardFrame>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("announcements.list.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("announcements.list.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </PageFrame>
      {editing && workspace ? (
        <AnnouncementDialog
          workspaceId={workspace.id}
          announcement={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
