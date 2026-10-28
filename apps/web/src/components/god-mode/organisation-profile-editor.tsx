import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
} from "@taskdesk/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CreateOrganisationInput,
  OrganisationProfile,
  OrganisationProfileValues,
  OrganisationProjectDefault,
  OrganisationProjectDefaultOptions,
  OrganisationQuota,
  ProjectDefaultOption,
} from "@/fetchers/god-mode/organisation-lifecycle";
import {
  createOrganisation,
  suspendOrganisation,
  unsuspendOrganisation,
  updateOrganisationProfile,
} from "@/fetchers/god-mode/organisation-lifecycle";
import {
  type OrganisationCatalogueItem,
  requestOrganisationDeletion,
} from "@/fetchers/god-mode/organisations";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

const defaultQuota: OrganisationQuota = {
  maxProjects: 200,
  maxWorkItems: 500_000,
  maxStorageBytes: 21_474_836_480,
  maxPortalUsers: 500,
  maxApiRequestsPerMinute: 600,
  maxWebhooks: 10,
};

type Draft = Omit<OrganisationProfileValues, "quota"> & {
  quota: Record<keyof OrganisationQuota, string>;
  requestTypeIds: string[];
  initialContactEmail: string;
  initialContactWorkspaceId: string;
};

function initialDraft(organisation: OrganisationProfile | null): Draft {
  return {
    name: organisation?.name ?? "",
    key: organisation?.key ?? "",
    emailDomains: organisation?.emailDomains ?? [],
    portalAccess: organisation?.portalAccess ?? true,
    defaultCustomerVisibility:
      organisation?.defaultCustomerVisibility ?? "organisation",
    quota: Object.fromEntries(
      quotaFields.map(({ key }) => [
        key,
        String(organisation?.quota[key] ?? defaultQuota[key]),
      ]),
    ) as Record<keyof OrganisationQuota, string>,
    projectDefaults: organisation?.projectDefaults ?? [],
    requestTypeIds: [],
    initialContactEmail: "",
    initialContactWorkspaceId: "",
  };
}

function canonicalDomains(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/u)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

const quotaFields: Array<{
  key: keyof OrganisationQuota;
  label: string;
}> = [
  { key: "maxProjects", label: "quotaMaxProjects" },
  { key: "maxWorkItems", label: "quotaMaxWorkItems" },
  { key: "maxStorageBytes", label: "quotaMaxStorageBytes" },
  { key: "maxPortalUsers", label: "quotaMaxPortalUsers" },
  { key: "maxApiRequestsPerMinute", label: "quotaMaxApiRequestsPerMinute" },
  { key: "maxWebhooks", label: "quotaMaxWebhooks" },
];

function selectedOption(options: ProjectDefaultOption[], id: string | null) {
  if (!id) return "__none__";
  return options.some((option) => option.id === id) ? id : "__none__";
}

function selectedOptionLabel(
  options: ProjectDefaultOption[],
  id: string | null,
  unavailableLabel: string,
  unpublishedLabel?: string,
) {
  if (!id) return null;
  const option = options.find((item) => item.id === id);
  if (!option) return unavailableLabel;
  if (option.published === false && unpublishedLabel)
    return `${option.name} (${unpublishedLabel})`;
  return option.name;
}

export function OrganisationProfileEditor({
  organisation,
  projectDefaultOptions,
  requestTypeOptions,
  onSaved,
  onReload,
}: {
  organisation: OrganisationProfile | null;
  projectDefaultOptions: OrganisationProjectDefaultOptions[];
  requestTypeOptions: OrganisationCatalogueItem[];
  onSaved: (profile: OrganisationProfile) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation("godModeOrganisations");
  const [base, setBase] = useState(() => initialDraft(organisation));
  const [draft, setDraft] = useState(() => initialDraft(organisation));
  const [domainsText, setDomainsText] = useState(() =>
    initialDraft(organisation).emailDomains.join(", "),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingStatus, setConfirmingStatus] = useState(false);
  const save = useMutation({
    mutationFn: async (values: Draft) => {
      const quota = Object.fromEntries(
        quotaFields.map(({ key }) => [key, Number(values.quota[key])]),
      ) as OrganisationQuota;
      if (organisation) {
        const {
          requestTypeIds: _requestTypeIds,
          initialContactEmail: _initialContactEmail,
          initialContactWorkspaceId: _initialContactWorkspaceId,
          ...profileValues
        } = values;
        return updateOrganisationProfile({
          organisationId: organisation.id,
          expectedProfileEtag: organisation.profileEtag,
          values: {
            ...profileValues,
            quota,
            emailDomains: canonicalDomains(domainsText),
          },
        });
      }
      const {
        initialContactEmail,
        initialContactWorkspaceId,
        ...profileValues
      } = values;
      const initialContact = initialContactEmail.trim()
        ? {
            email: initialContactEmail.trim(),
            workspaceId: initialContactWorkspaceId,
          }
        : undefined;
      return createOrganisation({
        ...profileValues,
        quota,
        emailDomains: canonicalDomains(domainsText),
        ...(initialContact ? { initialContact } : {}),
      } satisfies CreateOrganisationInput);
    },
  });
  const status = useMutation({
    mutationFn: () => {
      if (!organisation) throw new Error("Missing organisation");
      const input = {
        organisationId: organisation.id,
        expectedProfileEtag: organisation.profileEtag,
      };
      return organisation.active
        ? suspendOrganisation(input)
        : unsuspendOrganisation(input);
    },
  });
  const deletion = useMutation({
    mutationFn: () => {
      if (!organisation) throw new Error("Missing organisation");
      return requestOrganisationDeletion(organisation.id);
    },
  });
  const openPendingAction = useOpenPendingAction();
  const optionsByWorkspace = useMemo(
    () =>
      new Map(
        projectDefaultOptions.map((option) => [option.workspaceId, option]),
      ),
    [projectDefaultOptions],
  );
  const initialContactWorkspaces = projectDefaultOptions.filter((workspace) =>
    requestTypeOptions.some(
      (item) =>
        item.workspaceId === workspace.workspaceId &&
        draft.requestTypeIds.includes(item.id) &&
        !item.autoAccept,
    ),
  );
  const changed =
    JSON.stringify({
      ...draft,
      emailDomains: canonicalDomains(domainsText),
    }) !== JSON.stringify(base);
  const busy = save.isPending || status.isPending;
  const conflict =
    (save.error instanceof HttpError && save.error.status === 409) ||
    (status.error instanceof HttpError && status.error.status === 409);

  function setValue<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setNotice(null);
  }

  function updateQuota(key: keyof OrganisationQuota, value: string) {
    setDraft((current) => ({
      ...current,
      quota: {
        ...current.quota,
        [key]: value,
      },
    }));
  }

  function updateProjectDefault(
    workspaceId: string,
    key: "serviceCalendarId" | "slaPolicyId",
    value: string,
  ) {
    setDraft((current) => {
      const old = current.projectDefaults.filter(
        (item) => item.workspaceId !== workspaceId,
      );
      const currentDefault = current.projectDefaults.find(
        (item) => item.workspaceId === workspaceId,
      );
      const next: OrganisationProjectDefault = {
        workspaceId,
        serviceCalendarId: currentDefault?.serviceCalendarId ?? null,
        slaPolicyId: currentDefault?.slaPolicyId ?? null,
        [key]: value === "__none__" ? null : value,
      };
      if (next.serviceCalendarId || next.slaPolicyId) old.push(next);
      return { ...current, projectDefaults: old };
    });
    setError(null);
    setNotice(null);
  }

  async function submit() {
    if (busy || !changed) return;
    setError(null);
    setNotice(null);
    if (
      quotaFields.some(({ key }) => {
        const raw = draft.quota[key].trim();
        const number = Number(raw);
        return (
          !/^\d+$/u.test(raw) || !Number.isSafeInteger(number) || number < 0
        );
      })
    ) {
      setError(t("quotaInvalid"));
      return;
    }
    if (
      !organisation &&
      draft.initialContactEmail.trim() &&
      !initialContactWorkspaces.some(
        (workspace) =>
          workspace.workspaceId === draft.initialContactWorkspaceId,
      )
    ) {
      setError(t("initialContactWorkspaceRequired"));
      return;
    }
    try {
      const result = await save.mutateAsync({
        ...draft,
        emailDomains: canonicalDomains(domainsText),
        projectDefaults: draft.projectDefaults
          .filter((item) => item.serviceCalendarId || item.slaPolicyId)
          .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId)),
      });
      const saved = "profile" in result ? result.profile : result;
      const savedDraft = initialDraft(saved);
      setBase(savedDraft);
      setDraft(savedDraft);
      setDomainsText(saved.emailDomains.join(", "));
      const initialInvitation =
        "profile" in result ? result.initialInvitation : null;
      if (!organisation && initialInvitation) {
        toast.success(t("initialInvitationQueued"));
      } else {
        setNotice(t(organisation ? "profileSaved" : "organisationCreated"));
      }
      await onSaved(saved);
    } catch (cause) {
      setError(
        t(
          cause instanceof HttpError && cause.status === 409
            ? "profileConflict"
            : organisation
              ? "profileSaveFailed"
              : "organisationCreateFailed",
        ),
      );
    }
  }

  async function changeStatus() {
    if (!organisation || busy) return;
    setError(null);
    setNotice(null);
    try {
      const saved = await status.mutateAsync();
      await onSaved(saved);
      setConfirmingStatus(false);
      setNotice(
        t(saved.active ? "organisationUnsuspended" : "organisationSuspended"),
      );
    } catch (cause) {
      setError(
        t(
          cause instanceof HttpError && cause.status === 409
            ? "profileConflict"
            : "organisationStatusFailed",
        ),
      );
      setConfirmingStatus(false);
    }
  }

  async function requestDeletion() {
    if (!organisation || busy || deletion.isPending) return;
    setError(null);
    try {
      const result = await deletion.mutateAsync();
      await openPendingAction(result);
    } catch {
      setError(
        t("deleteRequestFailed", {
          defaultValue: "Deletion request could not be created.",
        }),
      );
    }
  }

  const title = organisation ? t("profileTitle") : t("createTitle");
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{t("profileDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {error ? (
            <Alert variant={conflict ? "warning" : "error"}>
              <AlertTitle>
                {conflict ? t("profileConflictTitle") : t("profileErrorTitle")}
              </AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                {conflict ? (
                  <Button
                    onClick={() => void onReload()}
                    type="button"
                    variant="outline"
                  >
                    {t("profileReload")}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="organisation-profile-name">
                {t("nameLabel")}
              </Label>
              <Input
                id="organisation-profile-name"
                disabled={busy}
                maxLength={200}
                onChange={(event) => setValue("name", event.target.value)}
                value={draft.name}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="organisation-profile-key">{t("keyLabel")}</Label>
              <Input
                id="organisation-profile-key"
                autoCapitalize="none"
                disabled={busy}
                maxLength={128}
                onChange={(event) =>
                  setValue("key", event.target.value.toLowerCase())
                }
                value={draft.key}
              />
            </div>
            <div className="min-w-0 space-y-2 md:col-span-2">
              <Label htmlFor="organisation-profile-domains">
                {t("emailDomainsLabel")}
              </Label>
              <Input
                id="organisation-profile-domains"
                autoCapitalize="none"
                disabled={busy}
                maxLength={4000}
                onChange={(event) => {
                  setDomainsText(event.target.value);
                  setError(null);
                  setNotice(null);
                }}
                placeholder={t("emailDomainsPlaceholder")}
                value={domainsText}
              />
              <p className="text-sm text-muted-foreground">
                {t("emailDomainsHelp")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="organisation-profile-visibility">
                {t("visibilityLabel")}
              </Label>
              <Select
                disabled={busy}
                onValueChange={(value) => {
                  if (value === "private" || value === "organisation")
                    setValue("defaultCustomerVisibility", value);
                }}
                value={draft.defaultCustomerVisibility}
              >
                <SelectTrigger id="organisation-profile-visibility">
                  <SelectValue>
                    {t(`visibility.${draft.defaultCustomerVisibility}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">
                    {t("visibility.private")}
                  </SelectItem>
                  <SelectItem value="organisation">
                    {t("visibility.organisation")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-2">
              <Label
                className="flex items-center gap-2"
                htmlFor="organisation-profile-portal-access"
              >
                <Checkbox
                  checked={draft.portalAccess}
                  disabled={busy}
                  id="organisation-profile-portal-access"
                  onCheckedChange={(checked) =>
                    setValue("portalAccess", checked === true)
                  }
                />
                {t("portalAccessLabel")}
              </Label>
            </div>
          </div>

          <section className="space-y-3">
            <div>
              <h3 className="font-medium">{t("quotaTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("quotaDescription")}
              </p>
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {quotaFields.map(({ key, label }) => (
                <div className="min-w-0 space-y-2" key={key}>
                  <Label htmlFor={`organisation-quota-${key}`}>
                    {t(label)}
                  </Label>
                  <Input
                    id={`organisation-quota-${key}`}
                    disabled={busy}
                    inputMode="numeric"
                    onChange={(event) => updateQuota(key, event.target.value)}
                    type="text"
                    value={draft.quota[key]}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-medium">{t("projectDefaultsTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("projectDefaultsDescription")}
              </p>
            </div>
            {projectDefaultOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("projectDefaultsEmpty")}
              </p>
            ) : (
              <div className="space-y-4">
                {projectDefaultOptions.map((workspace) => {
                  const current = draft.projectDefaults.find(
                    (item) => item.workspaceId === workspace.workspaceId,
                  );
                  const currentOptions = optionsByWorkspace.get(
                    workspace.workspaceId,
                  );
                  const calendarOptions =
                    currentOptions?.serviceCalendars ?? [];
                  const slaOptions = currentOptions?.slaPolicies ?? [];
                  const calendarLabel = selectedOptionLabel(
                    calendarOptions,
                    current?.serviceCalendarId ?? null,
                    t("projectDefaultUnavailable", {
                      defaultValue: "Unavailable",
                    }),
                  );
                  const slaLabel = selectedOptionLabel(
                    slaOptions,
                    current?.slaPolicyId ?? null,
                    t("projectDefaultUnavailable", {
                      defaultValue: "Unavailable",
                    }),
                    t("slaUnavailable"),
                  );
                  return (
                    <fieldset
                      className="grid min-w-0 gap-4 rounded-md border p-4 md:grid-cols-2"
                      key={workspace.workspaceId}
                    >
                      <legend className="px-1 text-sm font-medium">
                        {workspace.workspaceName}
                      </legend>
                      <div className="min-w-0 space-y-2">
                        <Label
                          htmlFor={`organisation-calendar-${workspace.workspaceId}`}
                        >
                          {t("defaultCalendarLabel")}
                        </Label>
                        <Select
                          disabled={busy}
                          onValueChange={(value) => {
                            if (value !== null)
                              updateProjectDefault(
                                workspace.workspaceId,
                                "serviceCalendarId",
                                value,
                              );
                          }}
                          value={selectedOption(
                            currentOptions?.serviceCalendars ?? [],
                            current?.serviceCalendarId ?? null,
                          )}
                        >
                          <SelectTrigger
                            id={`organisation-calendar-${workspace.workspaceId}`}
                          >
                            <SelectValue placeholder={t("noneOption")}>
                              {calendarLabel ?? t("noneOption")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              {t("noneOption")}
                            </SelectItem>
                            {calendarOptions.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <Label
                          htmlFor={`organisation-sla-${workspace.workspaceId}`}
                        >
                          {t("defaultSlaPolicyLabel")}
                        </Label>
                        <Select
                          disabled={busy}
                          onValueChange={(value) => {
                            if (value !== null)
                              updateProjectDefault(
                                workspace.workspaceId,
                                "slaPolicyId",
                                value,
                              );
                          }}
                          value={selectedOption(
                            currentOptions?.slaPolicies ?? [],
                            current?.slaPolicyId ?? null,
                          )}
                        >
                          <SelectTrigger
                            id={`organisation-sla-${workspace.workspaceId}`}
                          >
                            <SelectValue placeholder={t("noneOption")}>
                              {slaLabel ?? t("noneOption")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              {t("noneOption")}
                            </SelectItem>
                            {slaOptions.map((option) => (
                              <SelectItem
                                disabled={option.published === false}
                                key={option.id}
                                value={option.id}
                              >
                                {option.name}
                                {option.published === false
                                  ? ` (${t("slaUnavailable")})`
                                  : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            )}
          </section>

          {!organisation ? (
            <section className="space-y-3">
              <div>
                <h3 className="font-medium">{t("initialCatalogueTitle")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("initialCatalogueDescription")}
                </p>
              </div>
              {requestTypeOptions.map((item) => (
                <Label
                  className="flex min-w-0 items-start gap-3 rounded-md border p-3"
                  key={item.id}
                >
                  <Checkbox
                    checked={draft.requestTypeIds.includes(item.id)}
                    disabled={busy || item.autoAccept}
                    onCheckedChange={(checked) =>
                      setValue(
                        "requestTypeIds",
                        checked === true
                          ? [...new Set([...draft.requestTypeIds, item.id])]
                          : draft.requestTypeIds.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{item.name}</span>
                    {item.description ? (
                      <span className="block text-sm text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                    {item.autoAccept ? (
                      <span className="block text-sm text-muted-foreground">
                        {t("autoAcceptNeedsProject")}
                      </span>
                    ) : null}
                  </span>
                </Label>
              ))}
            </section>
          ) : null}

          {!organisation ? (
            <section className="grid min-w-0 gap-4 rounded-md border p-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <h3 className="font-medium">{t("initialContactTitle")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("initialContactDescription")}
                </p>
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="organisation-initial-contact-email">
                  {t("initialContactEmailLabel")}
                </Label>
                <Input
                  autoCapitalize="none"
                  disabled={busy}
                  id="organisation-initial-contact-email"
                  onChange={(event) =>
                    setValue("initialContactEmail", event.target.value)
                  }
                  type="email"
                  value={draft.initialContactEmail}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="organisation-initial-contact-workspace">
                  {t("initialContactWorkspaceLabel")}
                </Label>
                <Select
                  disabled={busy || initialContactWorkspaces.length === 0}
                  onValueChange={(value) => {
                    if (value !== null)
                      setValue("initialContactWorkspaceId", value);
                  }}
                  value={draft.initialContactWorkspaceId}
                >
                  <SelectTrigger id="organisation-initial-contact-workspace">
                    <SelectValue
                      placeholder={t("initialContactWorkspacePlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {initialContactWorkspaces.map((workspace) => (
                      <SelectItem
                        key={workspace.workspaceId}
                        value={workspace.workspaceId}
                      >
                        {workspace.workspaceName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy || (organisation !== null && !changed)}
              onClick={() => void submit()}
              type="button"
            >
              {busy
                ? t("profileSaving")
                : organisation
                  ? t("profileSave")
                  : t("createOrganisation")}
            </Button>
            {organisation ? (
              <Button
                disabled={busy}
                onClick={() => setConfirmingStatus((value) => !value)}
                type="button"
                variant={organisation.active ? "outline" : "secondary"}
              >
                {organisation.active
                  ? t("suspendOrganisation")
                  : t("unsuspendOrganisation")}
              </Button>
            ) : null}
            {organisation ? (
              <Button
                disabled={busy || deletion.isPending}
                onClick={() => void requestDeletion()}
                type="button"
                variant="destructive"
              >
                {deletion.isPending
                  ? t("deleteSubmitting", { defaultValue: "Requesting…" })
                  : t("deleteTitle", { defaultValue: "Delete organisation" })}
              </Button>
            ) : null}
          </div>
          {confirmingStatus ? (
            <Alert variant="warning">
              <AlertTitle>
                {t(
                  organisation?.active
                    ? "suspendConfirmTitle"
                    : "unsuspendConfirmTitle",
                )}
              </AlertTitle>
              <AlertDescription>
                <p>
                  {t(
                    organisation?.active
                      ? "suspendConfirmDescription"
                      : "unsuspendConfirmDescription",
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => void changeStatus()}
                    type="button"
                  >
                    {t(
                      organisation?.active
                        ? "suspendConfirm"
                        : "unsuspendConfirm",
                    )}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => setConfirmingStatus(false)}
                    type="button"
                    variant="outline"
                  >
                    {t("profileCancel")}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
