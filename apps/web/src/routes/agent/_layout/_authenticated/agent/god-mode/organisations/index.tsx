import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  Separator,
  Skeleton,
} from "@taskdesk/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { OrganisationProfileEditor } from "@/components/god-mode/organisation-profile-editor";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import PageTitle from "@/components/page-title";
import {
  type CustomerOrganisation,
  getOrganisations,
  type OrganisationCatalogueItem,
  replaceOrganisationCatalogue,
  requestOrganisationHardPurge,
  restoreOrganisation,
} from "@/fetchers/god-mode/organisations";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { HttpError } from "@/lib/http-error";
import { parseGodModeOrganisationsSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/organisations/",
)({
  validateSearch: parseGodModeOrganisationsSearch,
  component: GodModeOrganisationsRoute,
});

const queryKey = ["god-mode", "organisations"] as const;

function GodModeOrganisationsRoute() {
  const { t } = useTranslation("godModeOrganisations");
  const isAdmin = useInstanceAdminSignal();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey,
    queryFn: getOrganisations,
    enabled: isAdmin,
    staleTime: 15_000,
  });
  if (!isAdmin)
    return (
      <>
        <PageTitle title={t("title")} />
        <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
          <IdentityAccessDenied />
        </div>
      </>
    );

  const selected =
    query.data?.data.find(
      (organisation) => organisation.id === search.organisationId,
    ) ??
    query.data?.data[0] ??
    null;

  return (
    <>
      <PageTitle title={t("title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("description")}
          </p>
        </header>

        <div>
          <Button
            onClick={() => setCreating(true)}
            type="button"
            variant="outline"
          >
            {t("createTitle")}
          </Button>
        </div>

        {query.isPending ? (
          <div aria-label={t("loading")} className="space-y-3" role="status">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : null}

        {query.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("unavailable")}</AlertTitle>
            <AlertDescription>
              <p>{t("loadFailed")}</p>
              <Button
                onClick={() => void query.refetch()}
                type="button"
                variant="outline"
              >
                {t("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {query.isSuccess && query.data.data.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              {t("empty")}
            </CardContent>
          </Card>
        ) : null}

        {query.data?.data.length ? (
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.6fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t("organisations")}</CardTitle>
                <CardDescription>{t("selectOrganisation")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {query.data?.data.map((organisation) => (
                  <Button
                    aria-pressed={organisation.id === selected?.id}
                    className="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
                    key={organisation.id}
                    onClick={() => {
                      setCreating(false);
                      void navigate({
                        search: { organisationId: organisation.id },
                        replace: true,
                      });
                    }}
                    type="button"
                    variant={
                      organisation.id === selected?.id ? "secondary" : "ghost"
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {organisation.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {organisation.key}
                      </span>
                    </span>
                    <Badge
                      variant={
                        organisation.deletedAt
                          ? "destructive"
                          : organisation.active
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {organisation.deletedAt
                        ? t("deleted", { defaultValue: "Deleted" })
                        : organisation.active
                          ? organisation.catalogue.requestTypeIds.length
                          : t("suspended")}
                    </Badge>
                  </Button>
                ))}
              </CardContent>
            </Card>

            <div className="min-w-0 space-y-6">
              {creating && query.data ? (
                <OrganisationProfileEditor
                  key="new-organisation"
                  organisation={null}
                  projectDefaultOptions={query.data.projectDefaultOptions}
                  requestTypeOptions={query.data.options}
                  onReload={async () => {
                    await query.refetch();
                  }}
                  onSaved={async (profile) => {
                    setCreating(false);
                    await query.refetch();
                    await navigate({
                      search: { organisationId: profile.id },
                      replace: true,
                    });
                  }}
                />
              ) : null}
              {!creating && selected ? (
                selected.deletedAt ? (
                  <DeletedOrganisationCard
                    organisation={selected}
                    onRestored={async () => {
                      await query.refetch();
                    }}
                  />
                ) : (
                  <>
                    <OrganisationProfileEditor
                      key={`${selected.id}:${selected.profileEtag}`}
                      organisation={selected}
                      projectDefaultOptions={
                        query.data?.projectDefaultOptions ?? []
                      }
                      requestTypeOptions={query.data?.options ?? []}
                      onReload={async () => {
                        await query.refetch();
                      }}
                      onSaved={async () => {
                        await query.refetch();
                      }}
                    />
                    <CatalogueEditor
                      key={`${selected.id}:${selected.catalogue.etag}`}
                      organisation={selected}
                      options={query.data?.options ?? []}
                      readOnly={!selected.active}
                      onSaved={async () => {
                        await query.refetch();
                      }}
                    />
                  </>
                )
              ) : null}
            </div>
          </div>
        ) : null}
        {!query.data?.data.length && creating && query.data ? (
          <OrganisationProfileEditor
            key="new-organisation"
            organisation={null}
            projectDefaultOptions={query.data.projectDefaultOptions}
            requestTypeOptions={query.data.options}
            onReload={async () => {
              await query.refetch();
            }}
            onSaved={async (profile) => {
              setCreating(false);
              await query.refetch();
              await navigate({
                search: { organisationId: profile.id },
                replace: true,
              });
            }}
          />
        ) : null}
      </div>
    </>
  );
}

function DeletedOrganisationCard({
  organisation,
  onRestored,
}: {
  organisation: CustomerOrganisation;
  onRestored: () => Promise<void>;
}) {
  const { t } = useTranslation("godModeOrganisations");
  const stepUp = useStepUpAction();
  const openPendingAction = useOpenPendingAction();
  const [restored, setRestored] = useState(false);
  const purgeRequest = useMutation({
    mutationFn: () => requestOrganisationHardPurge(organisation.id),
    onSuccess: openPendingAction,
  });
  const operationId = organisation.deletionOperationId;
  const withinRecoveryWindow =
    organisation.purgeAfter !== null &&
    Number.isFinite(Date.parse(organisation.purgeAfter)) &&
    Date.parse(organisation.purgeAfter) > Date.now();
  const restore = async () => {
    if (!operationId) return;
    const result = await stepUp.run(
      {
        operation: "organisation_restore",
        organisationId: organisation.id,
        expectedOperationId: operationId,
        expectedGeneration: organisation.deletionGeneration,
      },
      (token) =>
        restoreOrganisation({
          organisationId: organisation.id,
          expectedOperationId: operationId,
          expectedGeneration: organisation.deletionGeneration,
          stepUpToken: token,
        }),
    );
    if (!result.ok) return;
    setRestored(true);
    await onRestored();
  };
  const purgeDate = organisation.purgeAfter
    ? new Date(organisation.purgeAfter).toLocaleString()
    : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {t("restoreTitle", { defaultValue: "Restore organisation" })}
          </CardTitle>
          <CardDescription>
            {t("restoreDescription", {
              defaultValue:
                "Restore this organisation and eligible projects before the recovery window expires.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning">
            <AlertTitle>{organisation.name}</AlertTitle>
            <AlertDescription>
              {t("deletionRecovery", {
                date:
                  purgeDate ?? t("unknownDate", { defaultValue: "unknown" }),
                defaultValue: `Recovery window ends ${purgeDate ?? "unknown"}.`,
              })}
            </AlertDescription>
          </Alert>
          {restored ? (
            <Alert variant="success">
              <AlertDescription>
                {t("restoreSucceeded", {
                  defaultValue: "Organisation restored.",
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          {operationId ? (
            withinRecoveryWindow ? (
              <StepUpFields action={stepUp} idPrefix="organisation-restore" />
            ) : (
              <Alert variant="error">
                <AlertTitle>
                  {t("restoreFailed", { defaultValue: "Restore unavailable" })}
                </AlertTitle>
                <AlertDescription>
                  {t("restoreExpired", {
                    defaultValue: "The recovery window has expired.",
                  })}
                </AlertDescription>
              </Alert>
            )
          ) : (
            <Alert variant="error">
              <AlertTitle>
                {t("restoreFailed", { defaultValue: "Restore unavailable" })}
              </AlertTitle>
              <AlertDescription>
                {t("restoreOperationUnavailable", {
                  defaultValue:
                    "The deletion record is unavailable. Reload the directory.",
                })}
              </AlertDescription>
            </Alert>
          )}
          <FailureAlert
            failure={stepUp.failure}
            title={t("restoreFailed", { defaultValue: "Restore failed" })}
          />
          <Button
            disabled={
              !operationId ||
              !withinRecoveryWindow ||
              restored ||
              stepUp.busy ||
              !stepUp.canRun
            }
            onClick={() => void restore()}
            type="button"
          >
            {t("restoreSubmit", { defaultValue: "Verify and restore" })}
          </Button>
        </CardContent>
      </Card>
      <Card className="border-destructive/32">
        <CardHeader>
          <CardTitle>
            {t("purgeTitle", {
              defaultValue: "Permanently delete organisation",
            })}
          </CardTitle>
          <CardDescription>
            {t("purgeDescription", {
              defaultValue:
                "Request an irreversible purge of this deleted organisation and its customer data. Legal holds and external dependencies block the request.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {operationId ? (
            <Button
              disabled={purgeRequest.isPending}
              onClick={() => purgeRequest.mutate()}
              type="button"
              variant="destructive"
            >
              {purgeRequest.isPending
                ? t("purgeSubmitting", { defaultValue: "Requesting…" })
                : t("purgeAction", {
                    defaultValue: "Request permanent purge",
                  })}
            </Button>
          ) : (
            <Alert variant="error">
              <AlertDescription>
                {t("restoreOperationUnavailable", {
                  defaultValue:
                    "The deletion record is unavailable. Reload the directory.",
                })}
              </AlertDescription>
            </Alert>
          )}
          {purgeRequest.isError ? (
            <Alert variant="error">
              <AlertTitle>
                {t("purgeRequestFailedTitle", {
                  defaultValue: "Purge request unavailable",
                })}
              </AlertTitle>
              <AlertDescription>
                {purgeRequest.error instanceof HttpError &&
                purgeRequest.error.status === 409
                  ? t("purgeConflict", {
                      defaultValue:
                        "This organisation is not currently eligible for purge. Review its legal hold and dependencies, then reload.",
                    })
                  : t("purgeRequestFailed", {
                      defaultValue:
                        "The hard-purge request could not be created. Reload and try again.",
                    })}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

function CatalogueEditor({
  organisation,
  options,
  readOnly,
  onSaved,
}: {
  organisation: CustomerOrganisation;
  options: OrganisationCatalogueItem[];
  readOnly: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation("godModeOrganisations");
  const queryClient = useQueryClient();
  const [requestTypeIds, setRequestTypeIds] = useState(
    () => new Set(organisation.catalogue.requestTypeIds),
  );
  const save = useMutation({ mutationFn: replaceOrganisationCatalogue });
  const optionsById = useMemo(
    () => new Map(options.map((option) => [option.id, option])),
    [options],
  );
  const unavailable = organisation.assignedRequestTypes.filter(
    (item) => !optionsById.has(item.id),
  );
  const optionsByGroup = useMemo(() => {
    const groups = new Map<string, OrganisationCatalogueItem[]>();
    for (const item of options) {
      const group = groups.get(item.group) ?? [];
      group.push(item);
      groups.set(item.group, group);
    }
    return [...groups.entries()];
  }, [options]);
  const changed =
    JSON.stringify([...requestTypeIds].sort()) !==
    JSON.stringify([...organisation.catalogue.requestTypeIds].sort());
  const conflict = save.error instanceof HttpError && save.error.status === 409;

  function toggle(id: string, checked: boolean | "indeterminate") {
    setRequestTypeIds((current) => {
      const next = new Set(current);
      if (checked === true) next.add(id);
      else next.delete(id);
      return next;
    });
    save.reset();
  }

  async function submit() {
    const result = await save.mutateAsync({
      organisationId: organisation.id,
      requestTypeIds: [...requestTypeIds].sort(),
      expectedCatalogueEtag: organisation.catalogue.etag,
    });
    queryClient.setQueryData(
      queryKey,
      (current: Awaited<ReturnType<typeof getOrganisations>> | undefined) =>
        current
          ? {
              ...current,
              data: current.data.map((item) =>
                item.id === organisation.id
                  ? {
                      ...item,
                      catalogue: result.catalogue,
                      assignedRequestTypes: result.assignedRequestTypes,
                    }
                  : item,
              ),
            }
          : current,
    );
    await onSaved();
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{organisation.name}</CardTitle>
            <CardDescription>{t("catalogueDescription")}</CardDescription>
          </div>
          <Button
            render={
              <Link
                params={{ id: organisation.id }}
                to="/agent/god-mode/organisations/$id/identity"
              />
            }
            type="button"
            variant="outline"
          >
            {t("identity")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {conflict ? (
          <Alert variant="warning">
            <AlertTitle>{t("conflictTitle")}</AlertTitle>
            <AlertDescription>
              <p>{t("conflictDescription")}</p>
              <Button
                onClick={() => void onSaved()}
                type="button"
                variant="outline"
              >
                {t("reload")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {readOnly ? (
          <Alert variant="warning">
            <AlertTitle>{t("suspended")}</AlertTitle>
            <AlertDescription>
              {t("catalogueSuspendedReadOnly")}
            </AlertDescription>
          </Alert>
        ) : null}
        {save.isError && !conflict ? (
          <Alert variant="error">
            <AlertTitle>{t("saveFailed")}</AlertTitle>
            <AlertDescription>
              <p>{t("saveFailedDescription")}</p>
            </AlertDescription>
          </Alert>
        ) : null}
        {save.isSuccess ? (
          <Alert variant="success">
            <AlertTitle>{t("saved")}</AlertTitle>
            <AlertDescription>{t("savedDescription")}</AlertDescription>
          </Alert>
        ) : null}

        {unavailable.length > 0 ? (
          <section className="space-y-3 rounded-md border border-border p-4">
            <div>
              <h3 className="text-sm font-medium">{t("unavailableTypes")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("unavailableTypesDescription")}
              </p>
            </div>
            {unavailable.map((item) => (
              <div className="flex items-start gap-3 text-sm" key={item.id}>
                <Checkbox
                  aria-label={item.name}
                  checked={requestTypeIds.has(item.id)}
                  disabled={readOnly}
                  onCheckedChange={(checked) => toggle(item.id, checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.name}</span>
                </span>
                <Badge variant="outline">{t("unavailableBadge")}</Badge>
              </div>
            ))}
          </section>
        ) : null}

        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRequestTypes")}</p>
        ) : (
          <div className="space-y-5">
            {optionsByGroup.map(([group, items], index) => (
              <section className="space-y-3" key={group}>
                {index > 0 ? <Separator /> : null}
                <h3 className="text-sm font-semibold">{group}</h3>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      className="flex items-start gap-3 rounded-md border border-border p-3 text-sm"
                      key={item.id}
                    >
                      <Checkbox
                        aria-label={item.name}
                        checked={requestTypeIds.has(item.id)}
                        disabled={readOnly}
                        onCheckedChange={(checked) => toggle(item.id, checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {item.name}
                          {item.autoAccept ? (
                            <Badge variant="secondary">{t("autoAccept")}</Badge>
                          ) : null}
                        </span>
                        {item.description ? (
                          <span className="mt-1 block text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            {t("selectedCount", { count: requestTypeIds.size })}
          </p>
          <Button
            disabled={readOnly || !changed || save.isPending}
            onClick={() => void submit().catch(() => undefined)}
            type="button"
          >
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
