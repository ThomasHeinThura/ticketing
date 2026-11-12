import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  type FormSchema,
  getConditionDrivingKeys,
  parseNumberAnswer,
} from "@taskdesk/domain/intake";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { Paperclip, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/common/date-field";
import {
  PortalKbSuggestions,
  usePortalKbDeflection,
} from "@/components/kb/portal/portal-kb-deflection";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import {
  completePortalSubmissionAttachment,
  getPortalCatalogue,
  getPortalRequestType,
  presignPortalSubmissionAttachment,
  submitPortalRequest,
} from "@/fetchers/intake";
import { invalidatePortalCaseViews } from "@/hooks/queries/portal/use-portal-cases";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { TerminologyProvider } from "@/lib/i18n/terminology-provider";
import { missingRequiredIntakeFields } from "@/lib/intake-validation";
import { resolveIntakeVisibility } from "@/lib/intake-visibility";
import {
  parsePortalCatalogueSearch,
  portalProjectSearchMiddlewares,
  routes,
} from "@/lib/routes";

type Entry = {
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  group: string;
  position: number;
  forcePrivate: boolean;
  formSchema: FormSchema;
  version: number;
};

export const Route = createFileRoute("/catalogue")({
  validateSearch: parsePortalCatalogueSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalCatalogue,
});

function PortalCatalogue() {
  const { i18n } = useTranslation();
  const { key } = Route.useSearch();
  return (
    <TerminologyProvider
      audience="customer"
      locale={i18n.resolvedLanguage ?? i18n.language}
      portalSelector={key ? { requestTypeKey: key } : undefined}
    >
      <PortalCatalogueContent />
    </TerminologyProvider>
  );
}

function PortalCatalogueContent() {
  const { t } = usePortalTranslation();
  const { q, key } = Route.useSearch();
  const { portalUserId } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  const catalogue = useQuery({
    queryKey: ["portal", portalUserId, "catalogue", q],
    queryFn: () => getPortalCatalogue(q),
  });
  const filteredEntries = (catalogue.data?.requestTypes ??
    []) as unknown as Entry[];
  const needsSelectionMetadata = Boolean(
    key &&
      catalogue.data &&
      !filteredEntries.some((entry) => entry.key === key),
  );
  const selectionMetadata = useQuery({
    queryKey: ["portal", portalUserId, "catalogue-selection-metadata", key],
    queryFn: () => getPortalCatalogue(),
    enabled: needsSelectionMetadata,
  });
  const selectedType = useQuery({
    queryKey: ["portal", portalUserId, "catalogue", "type", key],
    queryFn: () => getPortalRequestType(key ?? ""),
    enabled: Boolean(key),
  });
  const entries = filteredEntries;
  // Opening a card (or going back) unmounts the control that was focused, which
  // would drop focus to <body>: hand it to the new heading instead.
  const focusTarget = useRef<"form" | "list" | null>(null);
  const formHeadingRef = useRef<HTMLHeadingElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const metadataEntries = (selectionMetadata.data?.requestTypes ??
    []) as unknown as Entry[];
  const selectedSummary =
    filteredEntries.find((entry) => entry.key === key) ??
    metadataEntries.find((entry) => entry.key === key);
  const selected =
    selectedSummary && selectedType.data
      ? ({
          ...selectedSummary,
          ...selectedType.data,
          formSchema: selectedType.data.formSchema as unknown as FormSchema,
        } satisfies Entry)
      : undefined;
  const primaryError =
    catalogue.isError ||
    (needsSelectionMetadata && selectionMetadata.isError) ||
    selectedType.isError;
  const primaryLoading =
    catalogue.isLoading ||
    (needsSelectionMetadata && selectionMetadata.isLoading) ||
    (Boolean(key) && selectedType.isLoading);
  const storageKey =
    selected && portalUserId
      ? `taskdesk:intake-draft:${encodeURIComponent(portalUserId)}:${encodeURIComponent(selected.key)}:${selected.version}`
      : null;
  const [storedAnswers, setAnswers] = useState<Record<string, unknown>>({});
  const [answersKey, setAnswersKey] = useState<string | null>(null);
  const answers = answersKey === storageKey ? storedAnswers : {};
  const updateAnswer = (fieldKey: string, value: unknown) => {
    setAnswers((old) => {
      const next = { ...old };
      Object.defineProperty(next, fieldKey, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return next;
    });
  };
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<{
    key: string;
    value: "private" | "organisation";
  } | null>(null);
  const visibilityValue =
    visibility && visibility.key === selected?.key ? visibility.value : null;
  const effectiveVisibility: "private" | "organisation" =
    visibilityValue ??
    (selectionMetadata.data ?? catalogue.data)?.defaultCustomerVisibility ??
    "organisation";
  const visibilityPrivateLabel = t("portal:intake.visibilityPrivate", {
    defaultValue: "Only me and invited participants",
  });
  const visibilityOrganisationLabel = t(
    "portal:intake.visibilityOrganisation",
    {
      defaultValue: "People in my organisation",
    },
  );
  // KB-10: articles opened from this form are deflections only if the form is then abandoned.
  const kbDeflection = usePortalKbDeflection(selected?.key);
  const queryClient = useQueryClient();
  // A-08: files chosen for the form's file fields are held in the browser until the request
  // exists, then uploaded to it field by field. A file that fails stays visible on the tracking
  // page, where it can be finished or sent again.
  const [stagedFiles, setStagedFiles] = useState<Record<string, File[]>>({});
  const stagedFor = (key: string) =>
    stagedFiles[`${selected?.key ?? ""}:${key}`] ?? [];
  const setStagedFor = (key: string, files: File[]) =>
    setStagedFiles((current) => ({
      ...current,
      [`${selected?.key ?? ""}:${key}`]: files,
    }));
  // Set once a request was created but some of its files did not arrive. The request exists, so
  // the form is replaced by this outcome: a second submit would create a duplicate request.
  const [uploadFailures, setUploadFailures] = useState<{
    ref: string;
    failed: string[];
  } | null>(null);
  const submit = useMutation({
    mutationFn: async () => {
      const visibleFieldList = (selected?.formSchema.fields ?? []).filter(
        visible,
      );
      const drivingKeys = selected
        ? getConditionDrivingKeys(selected.formSchema)
        : new Set<string>();
      const visibleFormData: Record<string, unknown> = {};
      for (const field of visibleFieldList) {
        if (field.type === "file") continue;
        const hasAns = Object.hasOwn(answers, field.key);
        const val = hasAns ? answers[field.key] : undefined;
        const isBlank =
          val === undefined ||
          val === null ||
          (typeof val === "string" && val.trim() === "");

        if (isBlank) {
          if (
            drivingKeys.has(field.key) &&
            (field.type === "text" ||
              field.type === "textarea" ||
              field.options?.includes(""))
          ) {
            Object.defineProperty(visibleFormData, field.key, {
              value: "",
              writable: true,
              enumerable: true,
              configurable: true,
            });
          }
          continue;
        }

        if (field.type === "number") {
          // The same reading the server and the visibility rules use (RT-5).
          const num = parseNumberAnswer(val);
          if (num !== null) {
            Object.defineProperty(visibleFormData, field.key, {
              value: num,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          }
        } else {
          Object.defineProperty(visibleFormData, field.key, {
            value: val,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
      }
      const created = await submitPortalRequest({
        key: selected?.key ?? "",
        formData: visibleFormData,
        customerVisibility: selected?.forcePrivate
          ? "private"
          : effectiveVisibility,
      });
      // An auto-accepted request is already being worked on: a form field no longer applies,
      // so its files attach to the request itself.
      const open = created.state === "new" || created.state === "clarifying";
      const failed: string[] = [];
      for (const field of (selected?.formSchema.fields ?? []).filter(
        (candidate) => candidate.type === "file" && visible(candidate),
      ))
        for (const file of stagedFor(field.key)) {
          try {
            const signed = await presignPortalSubmissionAttachment({
              ref: created.ref,
              ...(open ? { fieldKey: field.key } : {}),
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              size: file.size,
            });
            const put = await fetch(signed.uploadUrl, {
              method: "PUT",
              headers: signed.uploadHeaders as Record<string, string>,
              body: file,
            });
            if (!put.ok) throw new Error("upload");
            await completePortalSubmissionAttachment({
              ref: created.ref,
              id: signed.attachmentId,
            });
          } catch {
            failed.push(file.name);
          }
        }
      return { ref: created.ref, failed };
    },
    onSuccess: async (result) => {
      setStagedFiles({});
      kbDeflection.markSubmitted();
      void invalidatePortalCaseViews(queryClient, portalUserId);
      if (storageKey) localStorage.removeItem(storageKey);
      // The request exists either way; a file that did not arrive is named here, with the way on.
      if (result.failed.length > 0) {
        setUploadFailures(result);
        return;
      }
      await navigate({
        to: routes.portalSubmission.path,
        params: { ref: result.ref },
      });
    },
  });
  useEffect(() => {
    setFieldErrors({});
    setUploadFailures(null);
    setAnswersKey(storageKey);
    if (!storageKey) {
      setAnswers({});
      return;
    }
    try {
      const saved = localStorage.getItem(storageKey);
      const parsed = saved
        ? (JSON.parse(saved) as Record<string, unknown>)
        : {};
      setAnswers(parsed);
    } catch {
      setAnswers({});
    }
  }, [storageKey]);
  useEffect(() => {
    if (storageKey && answersKey === storageKey && Object.keys(answers).length)
      localStorage.setItem(storageKey, JSON.stringify(answers));
  }, [storageKey, answersKey, answers]);
  const formReady = Boolean(selected);
  useEffect(() => {
    if (focusTarget.current === "form" && formReady) {
      focusTarget.current = null;
      formHeadingRef.current?.focus();
    } else if (focusTarget.current === "list" && !key) {
      focusTarget.current = null;
      listHeadingRef.current?.focus();
    }
  }, [formReady, key]);
  const fields = selected?.formSchema.fields ?? [];
  const selectedSchema = selected?.formSchema;
  const fieldVisibility = useMemo(
    () =>
      selectedSchema
        ? resolveIntakeVisibility(selectedSchema, answers)
        : new Map<string, boolean>(),
    [selectedSchema, answers],
  );
  const groups = useMemo(
    () => [...new Set(entries.map((entry) => entry.group))],
    [entries],
  );
  const visible = (field: FormSchema["fields"][number]) =>
    fieldVisibility.get(field.key) ?? true;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <PortalPageTitle
        title={selected?.name ?? t("portal:intake.catalogueTitle")}
      />
      <header>
        <h1
          className="font-semibold text-2xl outline-none"
          ref={listHeadingRef}
          tabIndex={-1}
        >
          {t("portal:intake.catalogueTitle")}
        </h1>
        <p className="text-muted-foreground">
          {t("portal:intake.catalogueDescription")}
        </p>
      </header>
      {primaryError && (
        <Alert variant="error">
          <AlertDescription>
            {t("portal:intake.loadError", {
              defaultValue: "Could not load the request catalogue or form.",
            })}
          </AlertDescription>
          {/* One retry for every failed load, so the alert never shows duplicate buttons. */}
          <Button
            variant="outline"
            onClick={() => {
              if (catalogue.isError) void catalogue.refetch();
              if (selectedType.isError) void selectedType.refetch();
              if (needsSelectionMetadata && selectionMetadata.isError)
                void selectionMetadata.refetch();
            }}
          >
            {t("common:actions.retry", { defaultValue: "Retry" })}
          </Button>
        </Alert>
      )}
      {/* The filter narrows the list; an open form replaces the list, so it hides with it. */}
      {key ? null : (
        <label className="flex flex-col gap-1" htmlFor="catalogue-search">
          {t("common:actions.filter", { defaultValue: "Search" })}
          <Input
            id="catalogue-search"
            value={q}
            onChange={(event) =>
              void navigate({
                search: { q: event.target.value || undefined, key },
              })
            }
            placeholder={t("portal:intake.searchPlaceholder", {
              defaultValue: "Search requests",
            })}
          />
        </label>
      )}
      {primaryLoading && !primaryError ? (
        <p role="status">
          {t("common:empty.loading", { defaultValue: "Loading…" })}
        </p>
      ) : primaryError ? null : selected ? (
        <section className="flex flex-col gap-4 rounded-md border p-4">
          <Button
            variant="ghost"
            className="w-fit"
            onClick={() => {
              focusTarget.current = "list";
              void navigate({ search: { q } });
            }}
          >
            ←{" "}
            {t("portal:intake.backToCatalogue", {
              defaultValue: "Back to catalogue",
            })}
          </Button>
          <h2
            className="font-semibold text-xl outline-none"
            ref={formHeadingRef}
            tabIndex={-1}
          >
            {selected.name}
          </h2>
          {selected.description && <p>{selected.description}</p>}
          {uploadFailures ? (
            <Alert variant="error">
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>
                  {t("portal:intake.filesNotAttached", {
                    ref: uploadFailures.ref,
                  })}
                </span>
                <ul className="list-disc ps-4">
                  {uploadFailures.failed.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: routes.portalSubmission.path,
                      params: { ref: uploadFailures.ref },
                    })
                  }
                >
                  {t("portal:intake.openSentRequest", {
                    ref: uploadFailures.ref,
                  })}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                // The request already exists: never submit it a second time.
                if (uploadFailures || submit.isPending) return;
                const missingRequired = missingRequiredIntakeFields(
                  selected.formSchema,
                  answers,
                  (key) => stagedFor(key).length > 0,
                );
                const invalidNumbers = fields.filter((field) => {
                  if (field.type !== "number" || !visible(field)) return false;
                  const value = answers[field.key];
                  return (
                    value !== undefined &&
                    value !== null &&
                    String(value).trim() !== "" &&
                    parseNumberAnswer(value) === null
                  );
                });
                if (missingRequired.length > 0 || invalidNumbers.length > 0) {
                  const nextErrors: Record<string, string> = Object.fromEntries(
                    missingRequired.map((key) => [
                      key,
                      t("portal:intake.fieldRequired", {
                        defaultValue: "This field is required.",
                      }),
                    ]),
                  );
                  for (const field of invalidNumbers) {
                    Object.defineProperty(nextErrors, field.key, {
                      value: t("portal:intake.invalidNumber"),
                      enumerable: true,
                      configurable: true,
                      writable: true,
                    });
                  }
                  setFieldErrors(nextErrors);
                  // A file field's own input is hidden; its visible Attach button takes focus.
                  const first = missingRequired[0] ?? invalidNumbers[0]?.key;
                  const firstIsFile = selected.formSchema.fields.some(
                    (candidate) =>
                      candidate.key === first && candidate.type === "file",
                  );
                  document
                    .getElementById(
                      firstIsFile
                        ? `request-field-attach-${first}`
                        : `request-field-${first}`,
                    )
                    ?.focus();
                  return;
                }
                setFieldErrors({});
                submit.mutate();
              }}
            >
              {fields.filter(visible).map((field) => {
                const error = Object.hasOwn(fieldErrors, field.key)
                  ? fieldErrors[field.key]
                  : undefined;
                return (
                  <div className="flex flex-col gap-1" key={field.key}>
                    <span>
                      {field.label}
                      {field.required ? " *" : ""}
                    </span>
                    {field.help && (
                      <span className="text-muted-foreground text-sm">
                        {field.help}
                      </span>
                    )}
                    {field.type === "file" ? (
                      <CatalogueFileField
                        fieldKey={field.key}
                        label={field.label}
                        multiple={Boolean(field.multiple)}
                        files={stagedFor(field.key)}
                        disabled={submit.isPending}
                        errorId={
                          error ? `request-field-error-${field.key}` : undefined
                        }
                        onChange={(files) => {
                          setStagedFor(field.key, files);
                          if (files.length > 0)
                            setFieldErrors((old) => {
                              const next = { ...old };
                              delete next[field.key];
                              return next;
                            });
                        }}
                      />
                    ) : field.type === "textarea" ? (
                      <Textarea
                        id={`request-field-${field.key}`}
                        aria-label={field.label}
                        aria-invalid={Boolean(error)}
                        aria-describedby={
                          error ? `request-field-error-${field.key}` : undefined
                        }
                        required={field.required}
                        value={String(answers[field.key] ?? "")}
                        onChange={(event) => {
                          updateAnswer(field.key, event.target.value);
                          setFieldErrors((old) => {
                            const next = { ...old };
                            delete next[field.key];
                            return next;
                          });
                        }}
                      />
                    ) : field.type === "select" || field.type === "combobox" ? (
                      <Select
                        value={String(answers[field.key] ?? "") || null}
                        onValueChange={(value) => {
                          updateAnswer(field.key, value ?? "");
                          setFieldErrors((old) => {
                            const next = { ...old };
                            delete next[field.key];
                            return next;
                          });
                        }}
                      >
                        <SelectTrigger
                          id={`request-field-${field.key}`}
                          aria-label={field.label}
                          aria-required={field.required}
                          aria-invalid={Boolean(error)}
                          aria-describedby={
                            error
                              ? `request-field-error-${field.key}`
                              : undefined
                          }
                          onBlur={() => {
                            if (field.required && !answers[field.key]) {
                              setFieldErrors((old) => ({
                                ...old,
                                [field.key]: t("portal:intake.fieldRequired", {
                                  defaultValue: "This field is required.",
                                }),
                              }));
                            }
                          }}
                        >
                          <SelectValue
                            placeholder={t("common:empty.select", {
                              defaultValue: "Choose an option",
                            })}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options ?? []).map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field.type === "checkbox" ? (
                      <Checkbox
                        id={`request-field-${field.key}`}
                        aria-label={field.label}
                        aria-invalid={Boolean(error)}
                        aria-describedby={
                          error ? `request-field-error-${field.key}` : undefined
                        }
                        checked={Boolean(answers[field.key])}
                        onCheckedChange={(checked) => {
                          updateAnswer(field.key, checked);
                          setFieldErrors((old) => {
                            const next = { ...old };
                            delete next[field.key];
                            return next;
                          });
                        }}
                      />
                    ) : field.type === "date" ? (
                      <DateField
                        id={`request-field-${field.key}`}
                        label={`${field.label}${field.required ? " *" : ""}`}
                        aria-invalid={Boolean(error)}
                        aria-describedby={
                          error
                            ? `request-field-error-${field.key}`
                            : field.required
                              ? `request-field-required-${field.key}`
                              : undefined
                        }
                        placeholder={t("common:empty.select")}
                        clearLabel={t("common:clearDate")}
                        value={String(answers[field.key] ?? "")}
                        dateEntry={{
                          label: t("common:dateEntry", {
                            label: field.label,
                            defaultValue: "{{label}} (YYYY-MM-DD)",
                          }),
                          invalidLabel: t("common:invalidDate"),
                          saveLabel: t("common:actions.save"),
                        }}
                        onChange={(value) => {
                          updateAnswer(field.key, value);
                          setFieldErrors((old) => {
                            const next = { ...old };
                            delete next[field.key];
                            return next;
                          });
                        }}
                      />
                    ) : (
                      <Input
                        id={`request-field-${field.key}`}
                        aria-label={field.label}
                        aria-invalid={Boolean(error)}
                        aria-describedby={
                          error ? `request-field-error-${field.key}` : undefined
                        }
                        type="text"
                        inputMode={
                          field.type === "number" ? "decimal" : undefined
                        }
                        required={field.required}
                        value={String(answers[field.key] ?? "")}
                        onChange={(event) => {
                          updateAnswer(field.key, event.target.value);
                          setFieldErrors((old) => {
                            const next = { ...old };
                            delete next[field.key];
                            return next;
                          });
                        }}
                      />
                    )}
                    {field.type === "date" && field.required ? (
                      <span
                        className="sr-only"
                        id={`request-field-required-${field.key}`}
                      >
                        {t("portal:intake.fieldRequired", {
                          defaultValue: "This field is required.",
                        })}
                      </span>
                    ) : null}
                    {error && (
                      <p
                        className="text-destructive text-sm"
                        id={`request-field-error-${field.key}`}
                        role="alert"
                      >
                        {error}
                      </p>
                    )}
                    {field.mapsTo?.field === "title" ? (
                      <PortalKbSuggestions
                        query={String(answers[field.key] ?? "")}
                        scope={portalUserId}
                        onOpen={kbDeflection.recordOpened}
                      />
                    ) : null}
                  </div>
                );
              })}
              {!selected.forcePrivate && (
                <label
                  className="flex flex-col gap-1"
                  htmlFor="request-customer-visibility"
                >
                  {t("portal:intake.visibilityLabel", {
                    defaultValue: "Who can see this request?",
                  })}
                  <Select
                    value={effectiveVisibility}
                    onValueChange={(value) =>
                      value &&
                      setVisibility({
                        key: selected.key,
                        value: value as "private" | "organisation",
                      })
                    }
                  >
                    <SelectTrigger id="request-customer-visibility">
                      <SelectValue>
                        {effectiveVisibility === "private"
                          ? visibilityPrivateLabel
                          : visibilityOrganisationLabel}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">
                        {visibilityPrivateLabel}
                      </SelectItem>
                      <SelectItem value="organisation">
                        {visibilityOrganisationLabel}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              )}
              {submit.isError && (
                <Alert variant="error">
                  <AlertDescription>
                    {t("portal:intake.submitError", {
                      defaultValue:
                        "The request could not be submitted. Check your answers and try again.",
                    })}
                  </AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending
                  ? t("common:empty.loading", { defaultValue: "Submitting…" })
                  : t("portal:intake.submit")}
              </Button>
            </form>
          )}
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          {entries.length === 0 ? (
            <p>
              {q
                ? t("portal:intake.noMatch", {
                    defaultValue: "No request types match your search.",
                  })
                : t("portal:intake.emptyCatalogue", {
                    defaultValue:
                      "No request types are available for your organisation.",
                  })}
            </p>
          ) : (
            groups.map((group) => (
              <section className="flex flex-col gap-2" key={group}>
                <h2 className="font-medium text-lg">{group}</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {entries
                    .filter((entry) => entry.group === group)
                    .map((entry) => (
                      <li key={entry.key} className="min-w-0">
                        <Button
                          variant="outline"
                          className="h-full w-full min-w-0 items-start justify-start whitespace-normal p-4 text-left sm:h-full"
                          onClick={() => {
                            focusTarget.current = "form";
                            void navigate({ search: { q, key: entry.key } });
                          }}
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <strong className="block break-words font-medium text-sm">
                              {entry.name}
                            </strong>
                            {entry.description && (
                              <small className="block break-words text-muted-foreground text-sm">
                                {entry.description}
                              </small>
                            )}
                          </span>
                        </Button>
                      </li>
                    ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A-08: a request form's file field. The files wait in the browser and upload once the request
 * is created; the same Kaneo button and hidden library file input as the tracking page.
 */
function CatalogueFileField({
  fieldKey,
  label,
  multiple,
  files,
  disabled,
  errorId,
  onChange,
}: {
  fieldKey: string;
  label: string;
  multiple: boolean;
  files: File[];
  disabled: boolean;
  /** Set while the field shows a "required" error: the Attach button points at it. */
  errorId?: string;
  onChange: (files: File[]) => void;
}) {
  const { t } = usePortalTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      {files.length > 0 ? (
        <ul className="flex w-full flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}:${file.size}:${file.lastModified}`}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5"
            >
              <span className="truncate text-sm">{file.name}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={t("portal:requestPage.removeFile", {
                  name: file.name,
                })}
                onClick={() =>
                  onChange(files.filter((_, position) => position !== index))
                }
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {multiple || files.length === 0 ? (
        <Button
          id={`request-field-attach-${fieldKey}`}
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-invalid={errorId ? true : undefined}
          aria-describedby={errorId}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4" aria-hidden="true" />
          {t("workItems:detail.attachments.add")}
        </Button>
      ) : null}
      <Input
        ref={inputRef}
        id={`request-field-${fieldKey}`}
        type="file"
        multiple={multiple}
        unstyled
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          onChange(multiple ? [...files, ...chosen] : chosen.slice(0, 1));
          event.target.value = "";
        }}
      />
    </div>
  );
}
