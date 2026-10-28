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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  requestServiceDeletion,
  SERVICE_STATUSES,
  type ServiceDetail,
  type ServiceLinkInput,
  type ServiceStatus,
  SUPPORT_LEVELS,
  type SupportLevel,
  setServiceStatus,
  updateService,
} from "@/fetchers/service-management";
import { useKbArticles } from "@/hooks/queries/kb";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useServiceCalendars } from "@/hooks/queries/service-calendar/use-service-calendars";
import {
  useCatalogueStatus,
  useInvalidateServiceManagement,
  useService,
  useServiceImpact,
  useServices,
} from "@/hooks/queries/service-management";
import { useTeams } from "@/hooks/queries/team/use-teams";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  LoadingRows,
  MutationError,
  QueryFailure,
  ServiceStatusBadge,
} from "./shared";

const NONE = "";

function StatusCard({
  service,
  canManage,
}: {
  service: ServiceDetail;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const [status, setStatus] = useState<ServiceStatus>(service.status);
  const [note, setNote] = useState(service.statusNote ?? "");
  const mutation = useMutation({
    mutationFn: () =>
      setServiceStatus(service.id, { status, note: note.trim() || null }),
    onSuccess: () => invalidate(),
  });
  const dirty =
    status !== service.status || note.trim() !== (service.statusNote ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("services.detail.status.title")}</CardTitle>
        <CardDescription>
          {t("services.detail.status.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <ServiceStatusBadge status={service.status} />
          {service.statusChangedAt ? (
            <span className="text-xs text-muted-foreground">
              {t("services.detail.status.changedAt", {
                when: formatDateTime(service.statusChangedAt),
              })}
            </span>
          ) : null}
          {service.statusNote ? (
            <span className="text-sm">{service.statusNote}</span>
          ) : null}
        </div>
        {canManage ? (
          <form
            className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (dirty && !mutation.isPending) mutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="service-status">
                {t("services.detail.status.label")}
              </Label>
              <Select
                items={SERVICE_STATUSES.map((value) => ({
                  value,
                  label: t(`status.${value}`),
                }))}
                value={status}
                onValueChange={(value) => {
                  if (value) setStatus(value as ServiceStatus);
                }}
              >
                <SelectTrigger id="service-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`status.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-status-note">
                {t("services.detail.status.note")}
              </Label>
              <Input
                id="service-status-note"
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={!dirty || mutation.isPending}>
              {t("services.detail.status.submit")}
            </Button>
          </form>
        ) : null}
        <MutationError error={mutation.error} />
      </CardContent>
    </Card>
  );
}

/** SVC-5: who is affected when this service changes, as an indented list (no graph). */
function ImpactCard({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation("serviceManagement");
  const impact = useServiceImpact(serviceId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("services.detail.impact.title")}</CardTitle>
        <CardDescription>
          {impact.data
            ? t("services.detail.impact.summary", {
                services: impact.data.impacted.length,
                customers: impact.data.customers.length,
              })
            : t("services.detail.impact.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {impact.isLoading ? <LoadingRows /> : null}
        {impact.isError ? (
          <QueryFailure
            error={impact.error}
            onRetry={() => void impact.refetch()}
          />
        ) : null}
        {impact.data?.cycleDetected ? (
          <Alert variant="warning">
            <AlertTitle>{t("services.detail.impact.cycleTitle")}</AlertTitle>
            <AlertDescription>
              {t("services.detail.impact.cycleDescription")}
            </AlertDescription>
          </Alert>
        ) : null}
        {impact.data && impact.data.impacted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("services.detail.impact.none")}
          </p>
        ) : null}
        {impact.data && impact.data.impacted.length > 0 ? (
          <ul className="space-y-1 text-sm">
            <li className="font-medium">{impact.data.service.name}</li>
            {impact.data.impacted.map((node) => (
              <li
                key={node.serviceId}
                className="flex flex-wrap items-center gap-2"
                style={{ paddingInlineStart: `${node.depth * 1.25}rem` }}
              >
                <span aria-hidden="true">{"└"}</span>
                <Link
                  className="underline-offset-4 hover:underline"
                  to={routes.serviceManagementServiceDetail.path}
                  params={{ id: node.serviceId }}
                >
                  {node.name}
                </Link>
                <ServiceStatusBadge status={node.status as ServiceStatus} />
                <span className="text-xs text-muted-foreground">
                  {t("services.detail.impact.via", { name: node.viaName })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {impact.data && impact.data.customers.length > 0 ? (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">
              {t("services.detail.impact.customers")}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {impact.data.customers.map((customer) => (
                <li key={customer.id}>
                  <Badge variant="outline">{customer.name}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EditServiceDialog({
  service,
  workspaceId,
  onClose,
}: {
  service: ServiceDetail;
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const teams = useTeams(workspaceId);
  const calendars = useServiceCalendars(workspaceId);
  const [name, setName] = useState(service.name);
  const [description, setDescription] = useState(service.description ?? "");
  const [category, setCategory] = useState(service.category ?? "");
  const [ownerTeamId, setOwnerTeamId] = useState(service.ownerTeamId ?? NONE);
  const [calendarId, setCalendarId] = useState(
    service.serviceCalendarId ?? NONE,
  );
  const [supportLevel, setSupportLevel] = useState<SupportLevel>(
    service.supportLevel,
  );
  const mutation = useMutation({
    mutationFn: () =>
      updateService(service.id, {
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        ownerTeamId: ownerTeamId || null,
        serviceCalendarId: calendarId || null,
        supportLevel,
        version: service.version,
      }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("services.detail.edit.title")}</DialogTitle>
          <DialogDescription>
            {t("services.detail.edit.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !mutation.isPending) mutation.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="edit-service-name">
                {t("services.fields.name")}
              </Label>
              <Input
                id="edit-service-name"
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-service-description">
                {t("services.fields.description")}
              </Label>
              <Textarea
                id="edit-service-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-service-category">
                  {t("services.fields.category")}
                </Label>
                <Input
                  id="edit-service-category"
                  maxLength={80}
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-service-support">
                  {t("services.fields.supportLevel")}
                </Label>
                <Select
                  items={SUPPORT_LEVELS.map((level) => ({
                    value: level,
                    label: t(`support.${level}`),
                  }))}
                  value={supportLevel}
                  onValueChange={(value) => {
                    if (value) setSupportLevel(value as SupportLevel);
                  }}
                >
                  <SelectTrigger id="edit-service-support">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORT_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {t(`support.${level}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-service-owner">
                  {t("services.fields.ownerTeam")}
                </Label>
                <Select
                  items={[
                    { value: NONE, label: t("services.fields.noOwnerTeam") },
                    ...(teams.data ?? []).map((team) => ({
                      value: team.id,
                      label: team.name,
                    })),
                  ]}
                  value={ownerTeamId}
                  onValueChange={(value) => setOwnerTeamId(value ?? NONE)}
                >
                  <SelectTrigger id="edit-service-owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {t("services.fields.noOwnerTeam")}
                    </SelectItem>
                    {(teams.data ?? []).map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-service-calendar">
                  {t("services.fields.calendar")}
                </Label>
                <Select
                  items={[
                    { value: NONE, label: t("services.fields.noCalendar") },
                    ...(calendars.data?.data ?? []).map((calendar) => ({
                      value: calendar.id,
                      label: calendar.name,
                    })),
                  ]}
                  value={calendarId}
                  onValueChange={(value) => setCalendarId(value ?? NONE)}
                >
                  <SelectTrigger id="edit-service-calendar">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {t("services.fields.noCalendar")}
                    </SelectItem>
                    {(calendars.data?.data ?? []).map((calendar) => (
                      <SelectItem key={calendar.id} value={calendar.id}>
                        {calendar.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <MutationError error={mutation.error} />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toLinkInput(link: ServiceDetail["links"][number]): ServiceLinkInput {
  if (link.kind === "documentation")
    return { kind: "documentation", url: link.url ?? "", label: link.label };
  if (link.kind === "project")
    return { kind: "project", projectId: link.projectId ?? "" };
  return { kind: "kb_article", kbArticleId: link.kbArticleId ?? "" };
}

/** SVC-2: documentation URLs, projects and knowledge base articles the service links to. */
function LinksCard({
  service,
  workspaceId,
  canManage,
}: {
  service: ServiceDetail;
  workspaceId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const projects = useGetProjects({ workspaceId }, canManage);
  const articles = useKbArticles({ workspaceId, limit: 100 });
  const [kind, setKind] = useState<ServiceLinkInput["kind"]>("documentation");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [targetId, setTargetId] = useState("");
  const save = useMutation({
    mutationFn: (links: ServiceLinkInput[]) =>
      updateService(service.id, { links }),
    onSuccess: () => invalidate(),
  });
  const existing = service.links.map(toLinkInput);
  const add = () => {
    const next: ServiceLinkInput | null =
      kind === "documentation"
        ? url.trim()
          ? { kind, url: url.trim(), label: label.trim() || null }
          : null
        : kind === "project"
          ? targetId
            ? { kind, projectId: targetId }
            : null
          : targetId
            ? { kind, kbArticleId: targetId }
            : null;
    if (!next) return;
    save.mutate([...existing, next], {
      onSuccess: () => {
        setUrl("");
        setLabel("");
        setTargetId("");
      },
    });
  };
  const options =
    kind === "project"
      ? (projects.data ?? []).map((project) => ({
          value: project.id,
          label: project.name,
        }))
      : (articles.data?.articles ?? []).map((article) => ({
          value: article.id,
          label: article.title,
        }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("services.detail.links.title")}</CardTitle>
        <CardDescription>
          {t("services.detail.links.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {service.links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("services.detail.links.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {service.links.map((link, index) => (
              <li key={link.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">
                  {t(`services.detail.links.kind.${link.kind}`)}
                </Badge>
                {link.kind === "documentation" ? (
                  <a
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    href={link.url ?? "#"}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {link.label || link.url}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : link.kind === "project" ? (
                  <span>{link.projectName ?? link.projectId}</span>
                ) : (
                  <Link
                    className="underline-offset-4 hover:underline"
                    to={routes.kbArticle.path}
                    params={{ id: link.kbArticleId ?? "" }}
                  >
                    {articles.data?.articles.find(
                      (article) => article.id === link.kbArticleId,
                    )?.title ?? link.kbArticleId}
                  </Link>
                )}
                {canManage ? (
                  <Button
                    className="ms-auto"
                    size="xs"
                    variant="ghost"
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutate(existing.filter((_, i) => i !== index))
                    }
                  >
                    {t("services.detail.links.remove")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <form
            className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="link-kind">
                {t("services.detail.links.kindLabel")}
              </Label>
              <Select
                items={(
                  ["documentation", "project", "kb_article"] as const
                ).map((value) => ({
                  value,
                  label: t(`services.detail.links.kind.${value}`),
                }))}
                value={kind}
                onValueChange={(value) => {
                  if (value) {
                    setKind(value as ServiceLinkInput["kind"]);
                    setTargetId("");
                  }
                }}
              >
                <SelectTrigger id="link-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["documentation", "project", "kb_article"] as const).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {t(`services.detail.links.kind.${value}`)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            {kind === "documentation" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="link-url">
                    {t("services.detail.links.url")}
                  </Label>
                  <Input
                    id="link-url"
                    type="url"
                    placeholder="https://"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="link-label">
                    {t("services.detail.links.labelField")}
                  </Label>
                  <Input
                    id="link-label"
                    maxLength={160}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="link-target">
                  {t("services.detail.links.target")}
                </Label>
                <Select
                  items={options}
                  value={targetId}
                  onValueChange={(value) => setTargetId(value ?? "")}
                >
                  <SelectTrigger id="link-target">
                    <SelectValue
                      placeholder={t("services.detail.links.choose")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button type="submit" variant="outline" disabled={save.isPending}>
              {t("services.detail.links.add")}
            </Button>
          </form>
        ) : null}
        <MutationError error={save.error} />
      </CardContent>
    </Card>
  );
}

function DependenciesDialog({
  service,
  workspaceId,
  onClose,
}: {
  service: ServiceDetail;
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const all = useServices(workspaceId);
  const [selected, setSelected] = useState(
    () => new Set(service.dependsOn.map((dependency) => dependency.id)),
  );
  const mutation = useMutation({
    mutationFn: () =>
      updateService(service.id, { dependsOnServiceIds: [...selected] }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  const others = (all.data ?? []).filter(
    (candidate) => candidate.id !== service.id,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {t("services.detail.dependencies.editTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("services.detail.dependencies.editDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending) mutation.mutate();
          }}
        >
          <div className="max-h-72 space-y-2 overflow-y-auto px-6">
            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("services.detail.dependencies.noOthers")}
              </p>
            ) : null}
            {others.map((candidate) => (
              <div key={candidate.id} className="flex items-center gap-2">
                <Checkbox
                  id={`dependency-${candidate.id}`}
                  checked={selected.has(candidate.id)}
                  onCheckedChange={(checked) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(candidate.id);
                      else next.delete(candidate.id);
                      return next;
                    })
                  }
                />
                <Label htmlFor={`dependency-${candidate.id}`}>
                  {candidate.name}
                </Label>
              </div>
            ))}
            <MutationError error={mutation.error} />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DependenciesCard({
  service,
  workspaceId,
  canManage,
}: {
  service: ServiceDetail;
  workspaceId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const [editing, setEditing] = useState(false);
  const list = (items: ServiceDetail["dependsOn"]) =>
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        {t("services.detail.dependencies.none")}
      </p>
    ) : (
      <ul className="space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <Link
              className="underline-offset-4 hover:underline"
              to={routes.serviceManagementServiceDetail.path}
              params={{ id: item.id }}
            >
              {item.name}
            </Link>
            <ServiceStatusBadge status={item.status as ServiceStatus} />
          </li>
        ))}
      </ul>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("services.detail.dependencies.title")}</CardTitle>
        <CardDescription>
          {t("services.detail.dependencies.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {service.cycleDetected ? (
          <Alert variant="warning">
            <AlertTitle>{t("services.detail.impact.cycleTitle")}</AlertTitle>
            <AlertDescription>
              {t("services.detail.impact.cycleDescription")}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              {t("services.detail.dependencies.dependsOn")}
            </h3>
            {list(service.dependsOn)}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              {t("services.detail.dependencies.usedBy")}
            </h3>
            {list(service.dependents)}
          </div>
        </div>
        {canManage ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" />
            {t("services.detail.dependencies.edit")}
          </Button>
        ) : null}
      </CardContent>
      {editing ? (
        <DependenciesDialog
          service={service}
          workspaceId={workspaceId}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Card>
  );
}

/** REL-3: the checklist the service defines; instantiated for each release of it. */
function ChecklistCard({
  service,
  canManage,
}: {
  service: ServiceDetail;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      updateService(service.id, {
        releaseChecklist: text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("services.detail.checklist.title")}</CardTitle>
        <CardDescription>
          {t("services.detail.checklist.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <Label htmlFor="checklist-text">
              {t("services.detail.checklist.editLabel")}
            </Label>
            <Textarea
              id="checklist-text"
              rows={6}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={mutation.isPending}>
                {t("common.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setEditing(false)}
              >
                {t("common.cancel")}
              </Button>
            </div>
            <MutationError error={mutation.error} />
          </form>
        ) : (
          <>
            {service.releaseChecklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("services.detail.checklist.empty")}
              </p>
            ) : (
              <ol className="list-decimal space-y-1 ps-5 text-sm">
                {service.releaseChecklist.map((item) => (
                  <li key={item.id}>{item.text}</li>
                ))}
              </ol>
            )}
            {canManage ? (
              <Button
                variant="outline"
                onClick={() => {
                  setText(
                    service.releaseChecklist
                      .map((item) => item.text)
                      .join("\n"),
                  );
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" />
                {t("services.detail.checklist.edit")}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteCard({ service }: { service: ServiceDetail }) {
  const { t } = useTranslation("serviceManagement");
  const openPendingAction = useOpenPendingAction();
  const request = useMutation({
    mutationFn: () => requestServiceDeletion(service.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(error.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("services.detail.delete.title")}</CardTitle>
        <CardDescription>
          {t("services.detail.delete.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {service.deletionBlockers.length > 0 ? (
          <Alert variant="info">
            <AlertTitle>{t("services.detail.delete.blockedTitle")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-5">
                {service.deletionBlockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <Button
          variant="destructive"
          disabled={service.deletionBlockers.length > 0 || request.isPending}
          onClick={() => request.mutate()}
        >
          {t("services.detail.delete.action")}
        </Button>
      </CardContent>
    </Card>
  );
}

/** `docs/screens.md` "Service detail": status, owners, links, dependencies, impact, checklist. */
export function ServiceDetailView({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation("serviceManagement");
  const { data: workspace } = useActiveWorkspace();
  const status = useCatalogueStatus(workspace?.id ?? "");
  const service = useService(serviceId);
  const [editing, setEditing] = useState(false);
  const canManage = status.data?.canManageServices === true;
  const data = service.data;
  return (
    <>
      <PageTitle title={data?.name ?? t("services.detail.pageTitle")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-2">
          <Button
            render={<Link to={routes.serviceManagementServices.path} />}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft aria-hidden="true" />
            {t("services.detail.allServices")}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {data?.name ?? t("services.detail.pageTitle")}
            </h1>
            {data ? <ServiceStatusBadge status={data.status} /> : null}
            {data ? <Badge variant="outline">{data.supportLevel}</Badge> : null}
            {data && canManage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden="true" />
                {t("services.detail.edit.action")}
              </Button>
            ) : null}
          </div>
          {data ? (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {data.description || t("services.detail.noDescription")}
            </p>
          ) : null}
          {data ? (
            <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">
                {t("services.fields.ownerTeam")}
              </dt>
              <dd>{data.ownerTeamName ?? t("services.list.noOwner")}</dd>
              <dt className="text-muted-foreground">
                {t("services.fields.category")}
              </dt>
              <dd>{data.category ?? t("services.detail.none")}</dd>
              <dt className="text-muted-foreground">
                {t("services.fields.calendar")}
              </dt>
              <dd>{data.calendarName ?? t("services.fields.noCalendar")}</dd>
              <dt className="text-muted-foreground">
                {t("services.detail.counts")}
              </dt>
              <dd>
                {t("services.list.incidents", { count: data.incidentCount })}
                {" · "}
                {t("services.list.openChanges", {
                  count: data.openChangeCount,
                })}
              </dd>
            </dl>
          ) : null}
        </div>
        {service.isLoading ? (
          <LoadingRows />
        ) : service.isError || !data ? (
          <QueryFailure
            error={service.error}
            onRetry={() => void service.refetch()}
          />
        ) : (
          <>
            <StatusCard
              key={`${data.id}:${data.version}`}
              service={data}
              canManage={canManage}
            />
            <ImpactCard serviceId={data.id} />
            <DependenciesCard
              service={data}
              workspaceId={data.workspaceId}
              canManage={canManage}
            />
            <LinksCard
              service={data}
              workspaceId={data.workspaceId}
              canManage={canManage}
            />
            <ChecklistCard service={data} canManage={canManage} />
            {canManage ? <DeleteCard service={data} /> : null}
            {editing ? (
              <EditServiceDialog
                service={data}
                workspaceId={data.workspaceId}
                onClose={() => setEditing(false)}
              />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
