import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
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
import { PickerPopover } from "@/components/common/picker-popover";
import PageTitle from "@/components/page-title";
import {
  createRelease,
  type ReleaseStatus,
} from "@/fetchers/service-management";
import {
  useCatalogueStatus,
  useInvalidateServiceManagement,
  useReleases,
  useServices,
} from "@/hooks/queries/service-management";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { formatDateMedium } from "@/lib/format";
import { type ReleaseListSearch, routes } from "@/lib/routes";
import {
  LoadingRows,
  MutationError,
  PageFrame,
  QueryFailure,
  SectionNav,
} from "./shared";

const ALL = "";

const STATUS_VARIANT = {
  planned: "outline",
  in_progress: "info",
  released: "success",
  cancelled: "secondary",
} as const satisfies Record<
  ReleaseStatus,
  "outline" | "info" | "success" | "secondary"
>;

export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  const { t } = useTranslation("serviceManagement");
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {t(`releases.status.${status}`)}
    </Badge>
  );
}

/** Work item keys separated by commas, spaces or new lines. */
export function parseChangeKeys(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/u)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
}

function CreateReleaseDialog({
  workspaceId,
  defaultServiceId,
  onClose,
}: {
  workspaceId: string;
  defaultServiceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const navigate = useNavigate();
  const invalidate = useInvalidateServiceManagement();
  const services = useServices(workspaceId);
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState(defaultServiceId);
  const [plannedDate, setPlannedDate] = useState("");
  const [keys, setKeys] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createRelease(workspaceId, {
        name: name.trim(),
        serviceId,
        plannedDate: plannedDate || null,
        changeKeys: parseChangeKeys(keys),
      }),
    onSuccess: async (release) => {
      await invalidate();
      onClose();
      void navigate({
        to: routes.serviceManagementReleaseDetail.path,
        params: { id: release.id },
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
          <DialogTitle>{t("releases.create.title")}</DialogTitle>
          <DialogDescription>
            {t("releases.create.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && serviceId && !mutation.isPending)
              mutation.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="release-name">{t("releases.fields.name")}</Label>
              <Input
                id="release-name"
                autoFocus
                required
                maxLength={160}
                value={name}
                disabled={mutation.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="release-service">
                  {t("releases.fields.service")}
                </Label>
                <Select
                  items={(services.data ?? []).map((service) => ({
                    value: service.id,
                    label: service.name,
                  }))}
                  value={serviceId}
                  onValueChange={(value) => setServiceId(value ?? "")}
                >
                  <SelectTrigger id="release-service">
                    <SelectValue
                      placeholder={t("releases.fields.chooseService")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(services.data ?? []).map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="release-date">
                  {t("releases.fields.plannedDate")}
                </Label>
                <Input
                  id="release-date"
                  type="date"
                  value={plannedDate}
                  disabled={mutation.isPending}
                  onChange={(event) => setPlannedDate(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="release-changes">
                {t("releases.fields.changes")}
              </Label>
              <Textarea
                id="release-changes"
                rows={3}
                placeholder="OPS-12, OPS-14"
                value={keys}
                disabled={mutation.isPending}
                onChange={(event) => setKeys(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("releases.fields.changesHelp")}
              </p>
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
            <Button
              type="submit"
              disabled={mutation.isPending || !name.trim() || !serviceId}
            >
              {t("releases.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** `docs/screens.md` "Releases" (`REL-1`..`REL-5`): releases grouped by target service. */
export function ReleasesList({ search }: { search: ReleaseListSearch }) {
  const { t } = useTranslation("serviceManagement");
  const navigate = useNavigate();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const status = useCatalogueStatus(workspaceId);
  const services = useServices(workspaceId);
  const releases = useReleases(workspaceId, search.serviceId);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageTitle title={t("releases.list.title")} />
      <PageFrame
        title={t("releases.list.title")}
        description={t("releases.list.description")}
        actions={
          status.data?.canManageReleases ? (
            <Button onClick={() => setCreating(true)} disabled={!workspace}>
              <Plus aria-hidden="true" />
              {t("releases.list.new")}
            </Button>
          ) : null
        }
      >
        <SectionNav active="releases" />
        <div className="max-w-xs space-y-2">
          <Label htmlFor="release-filter-service">
            {t("releases.list.filterService")}
          </Label>
          <PickerPopover
            id="release-filter-service"
            className="w-full"
            options={[
              { value: ALL, label: t("releases.list.allServices") },
              ...(services.data ?? []).map((service) => ({
                value: service.id,
                label: service.name,
              })),
            ]}
            value={search.serviceId ?? ALL}
            onChange={(value) =>
              void navigate({
                to: routes.serviceManagementReleases.path,
                search: value && value !== ALL ? { serviceId: value } : {},
              })
            }
          />
        </div>
        {releases.isLoading || !workspace ? (
          <LoadingRows />
        ) : releases.isError ? (
          <QueryFailure
            error={releases.error}
            onRetry={() => void releases.refetch()}
          />
        ) : releases.data?.length ? (
          <CardFrame>
            {releases.data.map((release) => (
              <Card key={release.id}>
                <CardHeader>
                  <CardTitle className="truncate">
                    <Link
                      className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={routes.serviceManagementReleaseDetail.path}
                      params={{ id: release.id }}
                    >
                      {release.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {release.serviceName}
                    {release.plannedDate
                      ? ` · ${formatDateMedium(release.plannedDate)}`
                      : ""}
                    {" · "}
                    {t("releases.list.changes", { count: release.changeCount })}
                    {release.checklistTotal > 0
                      ? ` · ${t("releases.list.checklist", {
                          done: release.checklistDone,
                          total: release.checklistTotal,
                        })}`
                      : ""}
                  </CardDescription>
                  <CardAction>
                    <ReleaseStatusBadge status={release.status} />
                  </CardAction>
                </CardHeader>
              </Card>
            ))}
          </CardFrame>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("releases.list.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("releases.list.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </PageFrame>
      {creating && workspace ? (
        <CreateReleaseDialog
          workspaceId={workspace.id}
          defaultServiceId={search.serviceId ?? services.data?.[0]?.id ?? ""}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
