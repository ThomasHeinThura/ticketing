import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@taskdesk/ui";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  RELEASE_STATUSES,
  type ReleaseDetail,
  type ReleaseStatus,
  setReleaseNotes,
  toggleReleaseChecklistItem,
  updateRelease,
} from "@/fetchers/service-management";
import {
  useCatalogueStatus,
  useInvalidateServiceManagement,
  useRelease,
} from "@/hooks/queries/service-management";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { formatDateMedium, formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { parseChangeKeys, ReleaseStatusBadge } from "./releases-list";
import { LoadingRows, MutationError, QueryFailure, RiskBadge } from "./shared";

function DetailsCard({
  release,
  canManage,
}: {
  release: ReleaseDetail;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const [name, setName] = useState(release.name);
  const [plannedDate, setPlannedDate] = useState(release.plannedDate ?? "");
  const [status, setStatus] = useState<ReleaseStatus>(release.status);
  const [publish, setPublish] = useState(release.publishToPortal);
  const [keys, setKeys] = useState(
    release.changes.map((change) => change.key).join(", "),
  );
  const mutation = useMutation({
    mutationFn: () =>
      updateRelease(release.id, {
        name: name.trim(),
        plannedDate: plannedDate || null,
        status,
        publishToPortal: publish,
        changeKeys: parseChangeKeys(keys),
        version: release.version,
      }),
    onSuccess: () => invalidate(),
  });
  const dirty =
    name.trim() !== release.name ||
    (plannedDate || null) !== release.plannedDate ||
    status !== release.status ||
    publish !== release.publishToPortal ||
    parseChangeKeys(keys).join(",") !==
      release.changes.map((change) => change.key).join(",");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("releases.detail.details.title")}</CardTitle>
        <CardDescription>
          {t("releases.detail.details.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && name.trim() && !mutation.isPending) mutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="release-edit-name">
                {t("releases.fields.name")}
              </Label>
              <Input
                id="release-edit-name"
                maxLength={160}
                value={name}
                disabled={!canManage}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="release-edit-date">
                {t("releases.fields.plannedDate")}
              </Label>
              <Input
                id="release-edit-date"
                type="date"
                value={plannedDate}
                disabled={!canManage}
                onChange={(event) => setPlannedDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="release-edit-status">
                {t("releases.fields.status")}
              </Label>
              <Select
                items={RELEASE_STATUSES.map((value) => ({
                  value,
                  label: t(`releases.status.${value}`),
                }))}
                value={status}
                disabled={!canManage}
                onValueChange={(value) => {
                  if (value) setStatus(value as ReleaseStatus);
                }}
              >
                <SelectTrigger id="release-edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELEASE_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`releases.status.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="release-edit-changes">
              {t("releases.fields.changes")}
            </Label>
            <Textarea
              id="release-edit-changes"
              rows={2}
              value={keys}
              disabled={!canManage}
              onChange={(event) => setKeys(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("releases.fields.changesHelp")}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="release-publish"
              checked={publish}
              disabled={!canManage}
              onCheckedChange={setPublish}
            />
            <div className="space-y-1">
              <Label htmlFor="release-publish">
                {t("releases.detail.publish.label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {release.publishedAt
                  ? t("releases.detail.publish.published", {
                      when: formatDateTime(release.publishedAt),
                    })
                  : t("releases.detail.publish.help")}
              </p>
            </div>
          </div>
          {canManage ? (
            <Button type="submit" disabled={!dirty || mutation.isPending}>
              {t("common.save")}
            </Button>
          ) : null}
          <MutationError error={mutation.error} />
        </form>
      </CardContent>
    </Card>
  );
}

function ChangesCard({ release }: { release: ReleaseDetail }) {
  const { t } = useTranslation("serviceManagement");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("releases.detail.changes.title")}</CardTitle>
        <CardDescription>
          {t("releases.detail.changes.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {release.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("releases.detail.changes.empty")}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {release.changes.map((change) => (
              <li
                key={change.key}
                className="flex flex-wrap items-center gap-2"
              >
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  to={routes.workItemDetail.path}
                  params={{ key: change.key }}
                >
                  {change.key}
                </Link>
                <span>{change.title}</span>
                <Badge variant="outline">{change.stateName}</Badge>
                <RiskBadge risk={change.risk} />
              </li>
            ))}
          </ul>
        )}
        {release.hiddenChangeCount > 0 ? (
          <Alert variant="info">
            <AlertDescription>
              {t("releases.detail.changes.hidden", {
                count: release.hiddenChangeCount,
              })}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChecklistCard({
  release,
  canManage,
}: {
  release: ReleaseDetail;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const toggle = useMutation({
    mutationFn: (input: { itemId: string; done: boolean }) =>
      toggleReleaseChecklistItem(release.id, input.itemId, input.done),
    onSuccess: () => invalidate(),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("releases.detail.checklist.title")}</CardTitle>
        <CardDescription>
          {t("releases.detail.checklist.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {release.checklist.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("releases.detail.checklist.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {release.checklist.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={`checklist-${item.id}`}
                  checked={item.done}
                  disabled={!canManage || toggle.isPending}
                  onCheckedChange={(checked) =>
                    toggle.mutate({ itemId: item.id, done: checked === true })
                  }
                />
                <Label htmlFor={`checklist-${item.id}`}>{item.text}</Label>
              </li>
            ))}
          </ul>
        )}
        <MutationError error={toggle.error} />
      </CardContent>
    </Card>
  );
}

/** REL-4: notes generated from the changes, editable until the release is published. */
function NotesCard({
  release,
  canManage,
}: {
  release: ReleaseDetail;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const [notes, setNotes] = useState(release.notes ?? "");
  const save = useMutation({
    mutationFn: () => setReleaseNotes(release.id, { notes }),
    onSuccess: () => invalidate(),
  });
  const regenerate = useMutation({
    mutationFn: () => setReleaseNotes(release.id, { regenerate: true }),
    onSuccess: async (updated) => {
      setNotes(updated.notes ?? "");
      await invalidate();
    },
  });
  const editable = canManage && !release.notesLocked;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("releases.detail.notes.title")}</CardTitle>
        <CardDescription>
          {t("releases.detail.notes.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {release.notesLocked ? (
          <Alert variant="info">
            <AlertTitle>{t("releases.detail.notes.lockedTitle")}</AlertTitle>
            <AlertDescription>
              {t("releases.detail.notes.lockedDescription")}
            </AlertDescription>
          </Alert>
        ) : null}
        <Label htmlFor="release-notes" className="sr-only">
          {t("releases.detail.notes.title")}
        </Label>
        <Textarea
          id="release-notes"
          rows={10}
          className="font-mono"
          value={notes}
          disabled={!editable}
          placeholder={t("releases.detail.notes.empty")}
          onChange={(event) => setNotes(event.target.value)}
        />
        {release.notesEditedAt ? (
          <p className="text-xs text-muted-foreground">
            {t("releases.detail.notes.edited", {
              when: formatDateTime(release.notesEditedAt),
            })}
          </p>
        ) : release.notesGeneratedAt ? (
          <p className="text-xs text-muted-foreground">
            {t("releases.detail.notes.generated", {
              when: formatDateTime(release.notesGeneratedAt),
            })}
          </p>
        ) : null}
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={save.isPending || notes === (release.notes ?? "")}
              onClick={() => save.mutate()}
            >
              {t("releases.detail.notes.save")}
            </Button>
            <Button
              variant="outline"
              disabled={regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              {t("releases.detail.notes.regenerate")}
            </Button>
          </div>
        ) : null}
        <MutationError error={save.error ?? regenerate.error} />
      </CardContent>
    </Card>
  );
}

/** `docs/screens.md` "Releases": one release with its changes, checklist and notes. */
export function ReleaseDetailView({ releaseId }: { releaseId: string }) {
  const { t } = useTranslation("serviceManagement");
  const { data: workspace } = useActiveWorkspace();
  const status = useCatalogueStatus(workspace?.id ?? "");
  const release = useRelease(releaseId);
  const canManage = status.data?.canManageReleases === true;
  const data = release.data;
  return (
    <>
      <PageTitle title={data?.name ?? t("releases.detail.pageTitle")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-2">
          <Button
            render={<Link to={routes.serviceManagementReleases.path} />}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft aria-hidden="true" />
            {t("releases.detail.allReleases")}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {data?.name ?? t("releases.detail.pageTitle")}
            </h1>
            {data ? <ReleaseStatusBadge status={data.status} /> : null}
          </div>
          {data ? (
            <p className="text-sm text-muted-foreground">
              <Link
                className="underline-offset-4 hover:underline"
                to={routes.serviceManagementServiceDetail.path}
                params={{ id: data.serviceId }}
              >
                {data.serviceName}
              </Link>
              {data.plannedDate
                ? ` · ${formatDateMedium(data.plannedDate)}`
                : ""}
            </p>
          ) : null}
        </div>
        {release.isLoading ? (
          <LoadingRows />
        ) : release.isError || !data ? (
          <QueryFailure
            error={release.error}
            onRetry={() => void release.refetch()}
          />
        ) : (
          <>
            <DetailsCard
              key={`${data.id}:${data.version}`}
              release={data}
              canManage={canManage}
            />
            <ChangesCard release={data} />
            <ChecklistCard release={data} canManage={canManage} />
            <NotesCard
              key={`notes:${data.id}:${data.version}`}
              release={data}
              canManage={canManage}
            />
          </>
        )}
      </div>
    </>
  );
}
