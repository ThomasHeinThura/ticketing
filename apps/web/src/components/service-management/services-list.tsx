import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
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
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  createService,
  SUPPORT_LEVELS,
  type SupportLevel,
} from "@/fetchers/service-management";
import { useServiceCalendars } from "@/hooks/queries/service-calendar/use-service-calendars";
import {
  serviceManagementKeys,
  useCatalogueStatus,
  useServices,
} from "@/hooks/queries/service-management";
import { useTeams } from "@/hooks/queries/team/use-teams";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { routes } from "@/lib/routes";
import {
  LoadingRows,
  MutationError,
  PageFrame,
  QueryFailure,
  SectionNav,
  ServiceStatusBadge,
} from "./shared";

const NONE = "";

function CreateServiceDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const teams = useTeams(workspaceId);
  const calendars = useServiceCalendars(workspaceId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [ownerTeamId, setOwnerTeamId] = useState(NONE);
  const [calendarId, setCalendarId] = useState(NONE);
  const [supportLevel, setSupportLevel] = useState<SupportLevel>("L1");
  const mutation = useMutation({
    mutationFn: () =>
      createService(workspaceId, {
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        ownerTeamId: ownerTeamId || null,
        serviceCalendarId: calendarId || null,
        supportLevel,
      }),
    onSuccess: async (service) => {
      await queryClient.invalidateQueries({
        queryKey: serviceManagementKeys.all,
      });
      onClose();
      void navigate({
        to: routes.serviceManagementServiceDetail.path,
        params: { id: service.id },
      });
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
          <DialogTitle>{t("services.create.title")}</DialogTitle>
          <DialogDescription>
            {t("services.create.description")}
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
              <Label htmlFor="service-name">{t("services.fields.name")}</Label>
              <Input
                id="service-name"
                autoFocus
                required
                maxLength={160}
                value={name}
                disabled={mutation.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-description">
                {t("services.fields.description")}
              </Label>
              <Textarea
                id="service-description"
                value={description}
                disabled={mutation.isPending}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="service-category">
                  {t("services.fields.category")}
                </Label>
                <Input
                  id="service-category"
                  maxLength={80}
                  value={category}
                  disabled={mutation.isPending}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-support">
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
                  <SelectTrigger id="service-support">
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
                <Label htmlFor="service-owner">
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
                  <SelectTrigger id="service-owner">
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
                <Label htmlFor="service-calendar">
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
                  <SelectTrigger id="service-calendar">
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
              {t("services.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** `docs/screens.md` "Services list" (`SVC-1`..`SVC-4`): every service with its status and counts. */
export function ServicesList({ q }: { q?: string }) {
  const { t } = useTranslation("serviceManagement");
  const navigate = useNavigate();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const status = useCatalogueStatus(workspaceId);
  const services = useServices(workspaceId, q);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(q ?? "");
  const loading = workspaceLoading || services.isLoading;
  return (
    <>
      <PageTitle title={t("services.list.title")} />
      <PageFrame
        title={t("services.list.title")}
        description={t("services.list.description")}
        actions={
          status.data?.canManageServices ? (
            <Button onClick={() => setCreating(true)} disabled={!workspace}>
              <Plus aria-hidden="true" />
              {t("services.list.new")}
            </Button>
          ) : null
        }
      >
        <SectionNav active="services" />
        <search>
          <form
            className="flex max-w-md gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate({
                href: routes.serviceManagementServices.build({
                  q: draft.trim() || undefined,
                }),
              });
            }}
          >
            <Input
              aria-label={t("services.list.searchLabel")}
              placeholder={t("services.list.searchPlaceholder")}
              value={draft}
              maxLength={120}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" variant="outline">
              {t("services.list.search")}
            </Button>
          </form>
        </search>
        {loading ? (
          <LoadingRows />
        ) : services.isError ? (
          <QueryFailure
            error={services.error}
            onRetry={() => void services.refetch()}
          />
        ) : services.data?.length ? (
          <CardFrame>
            {services.data.map((service) => (
              <Card key={service.id}>
                <CardHeader>
                  <CardTitle className="truncate">
                    <Link
                      className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={routes.serviceManagementServiceDetail.path}
                      params={{ id: service.id }}
                    >
                      {service.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {service.ownerTeamName ?? t("services.list.noOwner")}
                    {" · "}
                    {t("services.list.incidents", {
                      count: service.incidentCount,
                    })}
                    {" · "}
                    {t("services.list.openChanges", {
                      count: service.openChangeCount,
                    })}
                  </CardDescription>
                  <CardAction className="flex items-center gap-2">
                    <Badge variant="outline">{service.supportLevel}</Badge>
                    <ServiceStatusBadge status={service.status} />
                  </CardAction>
                </CardHeader>
              </Card>
            ))}
          </CardFrame>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {q ? t("services.list.noMatch") : t("services.list.emptyTitle")}
              </EmptyTitle>
              <EmptyDescription>
                {q ? "" : t("services.list.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {status.data && !status.data.enabled ? (
          <Alert variant="warning">
            <AlertDescription>{t("disabled.description")}</AlertDescription>
          </Alert>
        ) : null}
      </PageFrame>
      {creating && workspace ? (
        <CreateServiceDialog
          workspaceId={workspace.id}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
