import { supportedLocales } from "@i18n/resources";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getTerminology,
  previewTerminology,
  saveTerminology,
  TERMINOLOGY_TERM_KEYS,
  type TerminologyAudience,
  type TerminologyForms,
  type TerminologyTarget,
  type TerminologyTermKey,
} from "@/fetchers/terminology";

const terminologyKey = (target: TerminologyTarget) =>
  [
    "terminology",
    target.scope,
    target.scope === "workspace" ? target.workspaceId : "instance",
  ] as const;

function initialForms(categories: readonly string[]): TerminologyForms {
  return Object.fromEntries(categories.map((category) => [category, ""]));
}

export function sampleCountForCategory(locale: string, category: string) {
  const rules = new Intl.PluralRules(locale);
  const preferredCounts = [
    1, 2, 0, 3, 4, 5, 10, 11, 21, 100, 1_000_000, 0.1, 0.5, 1.1, 2.1, 2.5, 5.5,
    1_000_000.1,
  ];
  const preferred = preferredCounts.find(
    (count) => rules.select(count) === category,
  );
  if (preferred !== undefined) return preferred;
  for (let count = 0; count <= 1000; count += 1) {
    if (rules.select(count) === category) return count;
  }
  for (let tenths = 1; tenths <= 10_000; tenths += 1) {
    const count = tenths / 10;
    if (rules.select(count) === category) return count;
  }
  return 1;
}

export function TerminologyEditor({ target }: { target: TerminologyTarget }) {
  const { t } = useTranslation(["settings", "term"]);
  const queryClient = useQueryClient();
  const queryKey = terminologyKey(target);
  const query = useQuery({ queryKey, queryFn: () => getTerminology(target) });
  const [audience, setAudience] = useState<TerminologyAudience>("both");
  const [termKey, setTermKey] = useState<TerminologyTermKey>("request");
  const [locale, setLocale] = useState("en-US");
  const categories = useMemo(
    () => new Intl.PluralRules(locale).resolvedOptions().pluralCategories,
    [locale],
  );
  const current = query.data?.overrides.find(
    (item) =>
      item.audience === audience &&
      item.termKey === termKey &&
      item.locale === locale,
  );
  const identity = `${audience}:${termKey}:${locale}:${query.data?.etag ?? ""}`;
  const [draftState, setDraftState] = useState<{
    identity: string;
    forms: TerminologyForms;
  }>(() => ({ identity, forms: initialForms(categories) }));
  const draft =
    draftState.identity === identity
      ? draftState.forms
      : (current?.forms ?? initialForms(categories));
  useEffect(() => {
    if (draftState.identity !== identity) {
      setDraftState({
        identity,
        forms: current?.forms ?? initialForms(categories),
      });
    }
  }, [identity, current, categories, draftState.identity]);
  const updateDraft = (category: string, value: string) => {
    setDraftState((previous) => ({
      identity,
      forms: {
        ...(previous.identity === identity
          ? previous.forms
          : (current?.forms ?? initialForms(categories))),
        [category]: value,
      },
    }));
  };
  const save = useMutation({
    mutationFn: (forms: TerminologyForms | null) => {
      const snapshot = query.data;
      if (!snapshot) throw new Error("Terminology settings are not loaded");
      return saveTerminology(target, {
        expectedEtag: snapshot.etag,
        override: { audience, termKey, locale, forms },
      });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      void queryClient.invalidateQueries({
        queryKey: ["terminology-runtime"],
      });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey }),
  });
  const preview = useMutation({ mutationFn: previewTerminology });
  const livePreviewRef = useRef<HTMLDivElement>(null);

  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.isError)
    return (
      <Alert variant="error" role="alert">
        <AlertTitle>
          {t("terminology.unavailable", {
            defaultValue: "Terminology settings unavailable",
          })}
        </AlertTitle>
        <AlertDescription>
          {t("terminology.loadFailed", {
            defaultValue: "Could not load terminology. Try again.",
          })}
        </AlertDescription>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("common:retry", { defaultValue: "Retry" })}
        </Button>
      </Alert>
    );

  const displayTerm = (key: TerminologyTermKey) =>
    t(`term:${audience === "customer" ? "customer" : "agent"}.${key}_one`, {
      defaultValue: key.replaceAll("_", " "),
    });
  const sampleForms = categories.map((category) => {
    const count = sampleCountForCategory(locale, category);
    const selectedCategory = new Intl.PluralRules(locale).select(count);
    const draftForm = draft[selectedCategory];
    const savedDefault = t(
      `term:${audience === "customer" ? "customer" : "agent"}.${termKey}`,
      { count, lng: locale, defaultValue: termKey.replaceAll("_", " ") },
    );
    return {
      category,
      count,
      form: draftForm?.trim() ? draftForm : savedDefault,
    };
  });
  const singularPreview =
    sampleForms.find(({ count }) => count === 1)?.form ??
    sampleForms[0]?.form ??
    displayTerm(termKey);
  const pluralPreview =
    sampleForms.find(({ count }) => count === 2)?.form ??
    sampleForms.at(-1)?.form ??
    displayTerm(termKey);
  const formsDirty = categories.some(
    (category) => draft[category] !== (current?.forms[category] ?? ""),
  );
  const sameOneOther =
    typeof draft.one === "string" &&
    typeof draft.other === "string" &&
    draft.one.trim() !== "" &&
    draft.one.trim() === draft.other.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("terminology.title", { defaultValue: "Terminology" })}
        </CardTitle>
        <CardDescription>
          {t("terminology.description", {
            defaultValue:
              "Set the visible noun forms used in this instance or workspace.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {save.isError ? (
          <Alert variant="error" role="alert">
            <AlertDescription>
              {t("terminology.saveFailed", {
                defaultValue:
                  "Could not save terminology. Reload and try again.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {sameOneOther ? (
          <Alert variant="warning">
            <AlertDescription>
              {t("terminology.sameFormsWarning", {
                defaultValue: "The one and other forms are identical.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="terminology-audience">
              {t("terminology.audience", { defaultValue: "Audience" })}
            </Label>
            <Select
              value={audience}
              onValueChange={(value) =>
                value && setAudience(value as TerminologyAudience)
              }
            >
              <SelectTrigger id="terminology-audience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["both", "agent", "customer"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`terminology.audiences.${value}`, {
                      defaultValue: value,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="terminology-term">
              {t("terminology.term", { defaultValue: "Term" })}
            </Label>
            <Select
              value={termKey}
              onValueChange={(value) =>
                value && setTermKey(value as TerminologyTermKey)
              }
            >
              <SelectTrigger id="terminology-term">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TERMINOLOGY_TERM_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {displayTerm(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="terminology-locale">
              {t("terminology.locale", { defaultValue: "Locale" })}
            </Label>
            <Select
              value={locale}
              onValueChange={(value) => value && setLocale(value)}
            >
              <SelectTrigger id="terminology-locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {supportedLocales.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {categories.map((category) => (
            <div key={category} className="space-y-2">
              <Label htmlFor={`terminology-form-${category}`}>
                {t(`terminology.categories.${category}`, {
                  defaultValue: category,
                })}
              </Label>
              <Input
                id={`terminology-form-${category}`}
                value={draft[category] ?? ""}
                maxLength={512}
                onChange={(event) => updateDraft(category, event.target.value)}
              />
            </div>
          ))}
        </div>
        <Card
          ref={livePreviewRef}
          tabIndex={-1}
          data-testid="terminology-live-preview"
        >
          <CardHeader>
            <CardTitle>
              {t("terminology.livePreview", {
                defaultValue: "Live screen preview",
              })}
            </CardTitle>
            <CardDescription>
              {t("terminology.livePreviewDraft", {
                defaultValue: "Draft preview. Save to apply these terms.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <div className="border-b bg-muted/30 px-4 py-3">
                <p className="text-sm font-semibold">{pluralPreview}</p>
              </div>
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <span className="text-sm font-medium">{singularPreview}</span>
                <Button disabled size="sm">
                  {t("terminology.sampleAction", {
                    noun: singularPreview,
                    defaultValue: `Create ${singularPreview}`,
                  })}
                </Button>
              </div>
              <div className="divide-y">
                {sampleForms.map(({ category, count, form }) => (
                  <div
                    key={category}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    data-testid={`terminology-live-preview-${category}`}
                  >
                    <span className="font-medium">{form}</span>
                    <span className="text-muted-foreground">
                      {new Intl.NumberFormat(locale).format(count)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              !formsDirty ||
              save.isPending ||
              categories.some((category) => !draft[category]?.trim())
            }
            onClick={() => save.mutate(draft)}
          >
            {save.isPending
              ? t("common:empty.loading", { defaultValue: "Saving…" })
              : t("common:actions.save", { defaultValue: "Save" })}
          </Button>
          <Button
            variant="outline"
            disabled={save.isPending || !current}
            onClick={() => save.mutate(null)}
          >
            {t("terminology.useDefault", { defaultValue: "Use default" })}
          </Button>
          <Button
            variant="outline"
            disabled={
              target.scope === "instance" &&
              (preview.isPending ||
                categories.some((category) => !draft[category]?.trim()))
            }
            onClick={() => {
              if (target.scope === "workspace") {
                const previewElement = livePreviewRef.current;
                previewElement?.scrollIntoView?.({
                  behavior: "smooth",
                  block: "nearest",
                });
                previewElement?.focus();
                return;
              }
              preview.mutate({
                termKey,
                locale,
                audience: audience === "both" ? "agent" : audience,
                forms: draft,
              });
            }}
          >
            {t("terminology.preview", { defaultValue: "Preview forms" })}
          </Button>
        </div>
        {preview.data ? (
          <div className="grid gap-2 sm:grid-cols-2" aria-live="polite">
            {preview.data.examples.map((example) => (
              <p
                key={example.category}
                className="rounded-md border p-3 text-sm"
              >
                <span className="font-medium">
                  {example.count} {displayTerm(termKey)}:
                </span>{" "}
                {example.label}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
