import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type FormSchema,
  type FormValue,
  validateSubmissionData,
} from "@taskdesk/domain/intake";
import { apiFetch } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Skeleton,
} from "@taskdesk/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RequestTypeFields } from "@/components/request-type/request-type-fields";
import { getApiUrl } from "@/fetchers/get-api-url";

export const Route = createFileRoute("/catalogue/$key")({
  component: RequestForm,
});

type RequestTypeDetail = {
  key: string;
  name: string;
  description: string | null;
  version: number;
  autoAccept: boolean;
  formSchema: FormSchema;
};

type SubmissionReceipt = {
  ref: string;
  state: string;
  workItemKey: string | null;
  createdAt: string;
};

function RequestForm() {
  const { t } = useTranslation("portal");
  const { key } = Route.useParams();
  const [requestType, setRequestType] = useState<RequestTypeDetail | null>(
    null,
  );
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File[]>>(
    {},
  );
  const [uploadedFileIds, setUploadedFileIds] = useState<
    Record<string, string[]>
  >({});
  const [draftRef, setDraftRef] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await apiFetch(
        getApiUrl(`portal/catalogue/${encodeURIComponent(key)}`),
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error("request type unavailable");
      const body = (await response.json()) as RequestTypeDetail;
      setRequestType(body);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasFileFields = useMemo(
    () =>
      requestType?.formSchema.fields.some((field) => field.type === "file") ??
      false,
    [requestType],
  );
  const useDraftFlow = hasFileFields || requestType?.autoAccept === true;

  function changeValue(fieldKey: string, value: FormValue) {
    setValues((current) => ({ ...current, [fieldKey]: value }));
    setErrors((current) => {
      if (!(fieldKey in current)) return current;
      const next = { ...current };
      delete next[fieldKey];
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestType) return;
    const validationSchema = hasFileFields
      ? {
          ...requestType.formSchema,
          fields: requestType.formSchema.fields.map((field) =>
            field.type === "file" ? { ...field, required: false } : field,
          ),
        }
      : requestType.formSchema;
    const invalid = validateSubmissionData(validationSchema, values);
    if (invalid.length) {
      setErrors(
        Object.fromEntries(
          invalid.map(({ key: fieldKey }) => [
            fieldKey,
            t("form.fieldInvalid"),
          ]),
        ),
      );
      return;
    }
    setSubmitting(true);
    setFailed(false);
    try {
      if (!useDraftFlow) {
        const response = await apiFetch(getApiUrl("portal/submissions"), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestTypeKey: requestType.key,
            formData: values,
          }),
        });
        if (!response.ok) throw new Error("submission unavailable");
        setReceipt((await response.json()) as SubmissionReceipt);
      } else {
        let ref = draftRef;
        if (!ref) {
          const draftResponse = await apiFetch(
            getApiUrl("portal/submissions/drafts"),
            {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                requestTypeKey: requestType.key,
                formData: values,
              }),
            },
          );
          if (!draftResponse.ok) throw new Error("draft unavailable");
          const draft = (await draftResponse.json()) as SubmissionReceipt;
          ref = draft.ref;
          setDraftRef(ref);
        }
        const nextIds = { ...uploadedFileIds };
        for (const field of requestType.formSchema.fields.filter(
          (item) => item.type === "file",
        )) {
          const already = [...(nextIds[field.key] ?? [])];
          const files = selectedFiles[field.key] ?? [];
          const pendingFiles = files.slice(already.length);
          for (const file of pendingFiles) {
            const presignResponse = await apiFetch(
              getApiUrl(
                `portal/submissions/${encodeURIComponent(ref)}/attachments/presign`,
              ),
              {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  fieldKey: field.key,
                  filename: file.name,
                  contentType: file.type || "application/octet-stream",
                  size: file.size,
                }),
              },
            );
            if (!presignResponse.ok) throw new Error("upload unavailable");
            const upload = (await presignResponse.json()) as {
              attachmentId: string;
              fieldKey: string;
              uploadUrl: string;
              uploadHeaders: Record<string, string>;
            };
            if (upload.fieldKey !== field.key)
              throw new Error("upload field unavailable");
            const putResponse = await fetch(upload.uploadUrl, {
              method: "PUT",
              headers: upload.uploadHeaders,
              body: file,
            });
            if (!putResponse.ok) throw new Error("upload unavailable");
            const completeResponse = await apiFetch(
              getApiUrl(
                `portal/submissions/${encodeURIComponent(ref)}/attachments/${encodeURIComponent(upload.attachmentId)}/complete`,
              ),
              { method: "POST", credentials: "include" },
            );
            if (!completeResponse.ok)
              throw new Error("upload validation failed");
            already.push(upload.attachmentId);
            nextIds[field.key] = [...already];
            setUploadedFileIds({ ...nextIds });
          }
        }
        const finalData: Record<string, FormValue> = { ...values };
        for (const field of requestType.formSchema.fields.filter(
          (item) => item.type === "file",
        )) {
          const ids = nextIds[field.key] ?? [];
          if (ids.length) finalData[field.key] = field.multiple ? ids : ids[0]!;
          else delete finalData[field.key];
        }
        const finalResponse = await apiFetch(
          getApiUrl(`portal/submissions/${encodeURIComponent(ref)}/submit`),
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ formData: finalData }),
          },
        );
        if (!finalResponse.ok) throw new Error("submission unavailable");
        setReceipt((await finalResponse.json()) as SubmissionReceipt);
      }
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main
        className="mx-auto min-h-svh w-full max-w-3xl space-y-4 bg-background p-6"
        role="status"
        aria-label={t("form.loading")}
      >
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (failed && !requestType) {
    return (
      <main className="mx-auto min-h-svh w-full max-w-3xl space-y-4 bg-background p-6">
        <Alert variant="error">
          <AlertTitle>{t("form.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("form.loadErrorDescription")}
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void load()}
            >
              {t("form.retry")}
            </Button>
          </AlertDescription>
        </Alert>
        <Button variant="ghost" render={<Link to="/" />}>
          {t("form.backToCatalogue")}
        </Button>
      </main>
    );
  }

  if (receipt) {
    return (
      <main className="mx-auto min-h-svh w-full max-w-3xl space-y-6 bg-background p-6">
        <Alert variant="success">
          <AlertTitle>{t("form.submittedTitle")}</AlertTitle>
          <AlertDescription>
            {t("form.submittedDescription", { ref: receipt.ref })}
          </AlertDescription>
        </Alert>
        <Button render={<Link to="/submissions" />}>
          {t("form.viewRequests")}
        </Button>
        <Button variant="outline" render={<Link to="/" />}>
          {t("form.backToCatalogue")}
        </Button>
      </main>
    );
  }

  if (!requestType) return null;

  return (
    <main className="mx-auto min-h-svh w-full max-w-3xl space-y-6 bg-background p-6">
      <Button variant="ghost" render={<Link to="/" />}>
        {t("form.backToCatalogue")}
      </Button>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{requestType.name}</h1>
        {requestType.description ? (
          <p className="text-muted-foreground">{requestType.description}</p>
        ) : null}
      </header>
      {failed ? (
        <Alert variant="error">
          <AlertTitle>{t("form.submitErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("form.submitErrorDescription")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="p-6">
          <form className="space-y-6" onSubmit={(event) => void submit(event)}>
            <RequestTypeFields
              schema={requestType.formSchema}
              values={values}
              errors={errors}
              requiredLabel={t("form.required")}
              selectPlaceholder={t("form.selectPlaceholder")}
              emptyOptionsLabel={t("form.emptyOptions")}
              comboTriggerLabel={t("form.comboTrigger")}
              onValueChange={changeValue}
              onFilesChange={(fieldKey, files) =>
                setSelectedFiles((current) => ({
                  ...current,
                  [fieldKey]: Array.from(files ?? []),
                }))
              }
            />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? t("form.submitting") : t("form.submit")}
              </Button>
              <Button type="button" variant="outline" render={<Link to="/" />}>
                {t("form.cancel")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
