import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getPortalCatalogue, submitPortalRequest } from "@/fetchers/intake";
import { isIntakeConditionSatisfied } from "@/lib/intake-visibility";
import { parsePortalCatalogueSearch, routes } from "@/lib/routes";

type Field = {
  key: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  help?: string;
  multiple?: boolean;
  mapsTo?: { field: string };
  showIf?: { field_key: string; op: string; value?: unknown } | null;
};
type Entry = {
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  group: string;
  position: number;
  forcePrivate: boolean;
  formSchema: { fields: Field[] };
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
  const entries = (catalogue.data?.requestTypes ?? []) as unknown as Entry[];
  const selected = entries.find((entry) => entry.key === key);
  const storageKey = selected
    ? `taskdesk:intake-draft:${selected.key}:${selected.version}`
    : null;
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [visibility, setVisibility] = useState<{
    key: string;
    value: "private" | "organisation";
  } | null>(null);
  const visibilityValue =
    visibility && visibility.key === selected?.key ? visibility.value : null;
  const submit = useMutation({
    mutationFn: () =>
      submitPortalRequest({
        key: selected?.key ?? "",
        formData: answers,
        customerVisibility: selected?.forcePrivate
          ? "private"
          : (visibilityValue ??
            catalogue.data?.defaultCustomerVisibility ??
            "organisation"),
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
  const fields = selected?.formSchema.fields ?? [];
  const groups = useMemo(
    () => [...new Set(entries.map((entry) => entry.group))],
    [entries],
  );
  const visible = (field: Field) => {
    const condition = field.showIf;
    if (!condition) return true;
    const value = answers[condition.field_key];
    return isIntakeConditionSatisfied(condition, value);
  };
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-semibold text-2xl">
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
      {catalogue.isError && (
        <Alert variant="error">
          <AlertDescription>
            {t("portal:intake.loadError", {
              defaultValue: "Could not load the catalogue.",
            })}
          </AlertDescription>
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
      {selected ? (
        <section className="flex flex-col gap-4 rounded-md border p-4">
          <Button
            variant="ghost"
            className="w-fit"
            onClick={() => void navigate({ search: { q } })}
          >
            ←{" "}
            {t("portal:intake.backToCatalogue", {
              defaultValue: "Back to catalogue",
            })}
          </Button>
          <h2 className="font-semibold text-xl">{selected.name}</h2>
          {selected.description && <p>{selected.description}</p>}
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
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
                    required={field.required}
                    value={String(answers[field.key] ?? "")}
                    onChange={(event) =>
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                ) : field.type === "select" || field.type === "combobox" ? (
                  <Select
                    value={String(answers[field.key] ?? "") || null}
                    onValueChange={(value) =>
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: value ?? "",
                      }))
                    }
                  >
                    <SelectTrigger
                      id={`request-field-${field.key}`}
                      aria-label={field.label}
                      aria-required={field.required}
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
                    type="checkbox"
                    checked={Boolean(answers[field.key])}
                    onChange={(event) =>
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: event.target.checked,
                      }))
                    }
                  />
                ) : (
                  <Input
                    id={`request-field-${field.key}`}
                    aria-label={field.label}
                    type={
                      field.type === "number" || field.type === "date"
                        ? field.type
                        : "text"
                    }
                    required={field.required}
                    value={String(answers[field.key] ?? "")}
                    onChange={(event) =>
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
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
                  value={
                    visibilityValue ??
                    catalogue.data?.defaultCustomerVisibility ??
                    "organisation"
                  }
                  onValueChange={(value) =>
                    value &&
                    setVisibility({
                      key: selected.key,
                      value: value as "private" | "organisation",
                    })
                  }
                >
                  <SelectTrigger id="request-customer-visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">
                      {t("portal:intake.visibilityPrivate", {
                        defaultValue: "Only me and invited participants",
                      })}
                    </SelectItem>
                    <SelectItem value="organisation">
                      {t("portal:intake.visibilityOrganisation", {
                        defaultValue: "People in my organisation",
                      })}
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
          {entries.length === 0 && !catalogue.isLoading ? (
            <p>
              {t("portal:intake.emptyCatalogue", {
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
                          onClick={() =>
                            void navigate({ search: { q, key: entry.key } })
                          }
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
