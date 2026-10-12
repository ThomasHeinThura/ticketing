import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { FormSchema } from "@taskdesk/domain";
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
  Textarea,
} from "@taskdesk/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getPortalCatalogue,
  getPortalRequestType,
  submitPortalRequest,
} from "@/fetchers/intake";
import { missingRequiredIntakeFields } from "@/lib/intake-validation";
import { resolveIntakeVisibility } from "@/lib/intake-visibility";
import { parsePortalCatalogueSearch, routes } from "@/lib/routes";

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
  component: PortalCatalogue,
});

function PortalCatalogue() {
  const { t } = useTranslation();
  const { q, key } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const catalogue = useQuery({
    queryKey: ["portal", "catalogue", q],
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
    queryKey: ["portal", "catalogue-selection-metadata", key],
    queryFn: () => getPortalCatalogue(),
    enabled: needsSelectionMetadata,
  });
  const selectedType = useQuery({
    queryKey: ["portal", "catalogue", "type", key],
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
  const storageKey = selected
    ? `taskdesk:intake-draft:${selected.key}:${selected.version}`
    : null;
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
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
  const submit = useMutation({
    mutationFn: () =>
      submitPortalRequest({
        key: selected?.key ?? "",
        formData: answers,
        customerVisibility: selected?.forcePrivate
          ? "private"
          : effectiveVisibility,
      }),
    onSuccess: async (result) => {
      if (storageKey) localStorage.removeItem(storageKey);
      await navigate({
        to: routes.portalSubmission.path,
        params: { ref: result.ref },
      });
    },
  });
  useEffect(() => {
    setFieldErrors({});
    if (!storageKey) {
      setAnswers({});
      return;
    }
    try {
      const saved = localStorage.getItem(storageKey);
      setAnswers(saved ? (JSON.parse(saved) as Record<string, unknown>) : {});
    } catch {
      setAnswers({});
    }
  }, [storageKey]);
  useEffect(() => {
    if (storageKey && Object.keys(answers).length)
      localStorage.setItem(storageKey, JSON.stringify(answers));
  }, [storageKey, answers]);
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
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1
          className="font-semibold text-2xl outline-none"
          ref={listHeadingRef}
          tabIndex={-1}
        >
          {t("portal:intake.catalogueTitle", {
            defaultValue: "Request catalogue",
          })}
        </h1>
        <p className="text-muted-foreground">
          {t("portal:intake.catalogueDescription", {
            defaultValue: "Choose a request type and tell us what you need.",
          })}
        </p>
      </header>
      {primaryError && (
        <Alert variant="error">
          <AlertDescription>
            {t("portal:intake.loadError", {
              defaultValue: "Could not load the request catalogue or form.",
            })}
          </AlertDescription>
          {catalogue.isError && (
            <Button variant="outline" onClick={() => void catalogue.refetch()}>
              {t("common:actions.retry", { defaultValue: "Retry" })}
            </Button>
          )}
          {selectedType.isError && (
            <Button
              variant="outline"
              onClick={() => void selectedType.refetch()}
            >
              {t("common:actions.retry", { defaultValue: "Retry" })}
            </Button>
          )}
          {needsSelectionMetadata && selectionMetadata.isError && (
            <Button
              variant="outline"
              onClick={() => void selectionMetadata.refetch()}
            >
              {t("common:actions.retry", { defaultValue: "Retry" })}
            </Button>
          )}
        </Alert>
      )}
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
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const missingRequired = missingRequiredIntakeFields(
                selected.formSchema,
                answers,
              );
              if (missingRequired.length > 0) {
                const nextErrors = Object.fromEntries(
                  missingRequired.map((key) => [
                    key,
                    t("portal:intake.fieldRequired", {
                      defaultValue: "This field is required.",
                    }),
                  ]),
                );
                setFieldErrors(nextErrors);
                document
                  .getElementById(`request-field-${missingRequired[0]}`)
                  ?.focus();
                return;
              }
              setFieldErrors({});
              submit.mutate();
            }}
          >
            {fields.filter(visible).map((field) => (
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
                  <span className="text-muted-foreground text-sm">
                    {t("portal:intake.fileUploadAfterSubmission", {
                      defaultValue:
                        "You can attach files from the request tracking page after submitting.",
                    })}
                  </span>
                ) : field.type === "textarea" ? (
                  <Textarea
                    id={`request-field-${field.key}`}
                    aria-label={field.label}
                    aria-invalid={Boolean(fieldErrors[field.key])}
                    aria-describedby={
                      fieldErrors[field.key]
                        ? `request-field-error-${field.key}`
                        : undefined
                    }
                    required={field.required}
                    value={String(answers[field.key] ?? "")}
                    onChange={(event) => {
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: event.target.value,
                      }));
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
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: value ?? "",
                      }));
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
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      aria-describedby={
                        fieldErrors[field.key]
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
                  <Input
                    id={`request-field-${field.key}`}
                    aria-label={field.label}
                    aria-invalid={Boolean(fieldErrors[field.key])}
                    aria-describedby={
                      fieldErrors[field.key]
                        ? `request-field-error-${field.key}`
                        : undefined
                    }
                    type="checkbox"
                    checked={Boolean(answers[field.key])}
                    onChange={(event) => {
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: event.target.checked,
                      }));
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
                    aria-invalid={Boolean(fieldErrors[field.key])}
                    aria-describedby={
                      fieldErrors[field.key]
                        ? `request-field-error-${field.key}`
                        : undefined
                    }
                    type={
                      field.type === "number" || field.type === "date"
                        ? field.type
                        : "text"
                    }
                    required={field.required}
                    value={String(answers[field.key] ?? "")}
                    onChange={(event) => {
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: event.target.value,
                      }));
                      setFieldErrors((old) => {
                        const next = { ...old };
                        delete next[field.key];
                        return next;
                      });
                    }}
                  />
                )}
                {fieldErrors[field.key] && (
                  <p
                    className="text-destructive text-sm"
                    id={`request-field-error-${field.key}`}
                    role="alert"
                  >
                    {fieldErrors[field.key]}
                  </p>
                )}
              </div>
            ))}
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
                : t("portal:intake.submit", { defaultValue: "Submit request" })}
            </Button>
          </form>
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
                      <li key={entry.key}>
                        <Button
                          variant="outline"
                          className="h-auto w-full justify-start p-4 text-left"
                          onClick={() => {
                            focusTarget.current = "form";
                            void navigate({ search: { q, key: entry.key } });
                          }}
                        >
                          <span>
                            <strong className="block">{entry.name}</strong>
                            {entry.description && (
                              <small className="text-muted-foreground">
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
    </main>
  );
}
