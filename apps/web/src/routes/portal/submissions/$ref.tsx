import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, Button, Input, Textarea } from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  completePortalSubmissionAttachment,
  downloadPortalSubmissionAttachment,
  getPortalSubmission,
  getPortalSubmissionAttachments,
  presignPortalSubmissionAttachment,
  replyPortalSubmission,
  withdrawPortalSubmission,
} from "@/fetchers/intake";

export const Route = createFileRoute("/submissions/$ref")({
  component: PortalSubmissionPage,
});

function PortalSubmissionPage() {
  const { t } = useTranslation();
  const { ref } = Route.useParams();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const page = useQuery({
    queryKey: ["portal", "submission", ref],
    queryFn: () => getPortalSubmission(ref),
  });
  const attachments = useQuery({
    queryKey: ["portal", "submission", ref, "attachments"],
    queryFn: () => getPortalSubmissionAttachments(ref),
  });
  const reply = useMutation({
    mutationFn: () => replyPortalSubmission({ ref, body: body.trim() }),
    onSuccess: async () => {
      setBody("");
      await queryClient.invalidateQueries({
        queryKey: ["portal", "submission", ref],
      });
    },
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawPortalSubmission(ref),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["portal", "submission", ref],
      }),
  });
  const upload = useMutation({
    mutationFn: async (input: { fieldKey: string; file: File }) => {
      const signed = await presignPortalSubmissionAttachment({
        ref,
        fieldKey: input.fieldKey,
        filename: input.file.name,
        contentType: input.file.type || "application/octet-stream",
        size: input.file.size,
      });
      const uploaded = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: signed.uploadHeaders as Record<string, string>,
        body: input.file,
      });
      if (!uploaded.ok)
        throw new Error("The file could not be uploaded to storage.");
      return completePortalSubmissionAttachment({
        ref,
        id: signed.attachmentId,
      });
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["portal", "submission", ref, "attachments"],
      }),
  });
  const finishUpload = useMutation({
    mutationFn: (id: string) => completePortalSubmissionAttachment({ ref, id }),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["portal", "submission", ref, "attachments"],
      }),
  });
  const record = page.data as unknown as
    | {
        submission?: {
          state?: string;
          claimedBy?: string | null;
          formData?: Record<string, unknown>;
          workItemId?: string | null;
        };
        requestType?: { name?: string };
        version?: {
          formSchema?: {
            fields?: Array<{
              key: string;
              label: string;
              type: string;
              multiple?: boolean;
            }>;
          };
        };
        messages?: Array<{
          id: string;
          actorType: string;
          body: string;
          createdAt: string;
        }>;
      }
    | undefined;
  const state = record?.submission?.state;
  const canWithdraw =
    (state === "new" || state === "clarifying") &&
    !record?.submission?.claimedBy;
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-semibold text-2xl">
          {t("portal:intake.submissionTitle", {
            defaultValue: "Request {{ref}}",
            ref,
          })}
        </h1>
        <p className="text-muted-foreground">
          {record?.requestType?.name} · {state}
        </p>
      </header>
      {page.isLoading && (
        <p role="status">
          {t("common:empty.loading", { defaultValue: "Loading…" })}
        </p>
      )}
      {(page.isError || reply.isError || withdraw.isError) && (
        <Alert variant="error">
          <AlertDescription>
            {t("portal:intake.pageError", {
              defaultValue: "This request could not be loaded or updated.",
            })}
          </AlertDescription>
        </Alert>
      )}
      {record && (
        <>
          <section className="rounded-md border p-4">
            <h2 className="font-medium">
              {t("portal:intake.answers", { defaultValue: "Your answers" })}
            </h2>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(record.submission?.formData ?? {}).map(
                ([key, value]) => (
                  <div key={key}>
                    <dt className="text-muted-foreground text-sm">{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ),
              )}
            </dl>
          </section>
          {state === "accepted" && (
            <Alert variant="info">
              <AlertDescription>
                {t("portal:intake.accepted", {
                  defaultValue:
                    "This request is now a work item. You can keep replying here and your message will be added to its conversation.",
                })}
              </AlertDescription>
            </Alert>
          )}
          {state === "declined" && (
            <Alert variant="warning">
              <AlertDescription>
                {
                  record.messages
                    ?.filter((message) => message.actorType === "triager")
                    .at(-1)?.body
                }
              </AlertDescription>
            </Alert>
          )}
          <section>
            <h2 className="font-medium">
              {t("portal:intake.conversation", {
                defaultValue: "Conversation",
              })}
            </h2>
            <ol className="mt-3 flex flex-col gap-3">
              {record.messages?.map((message) => (
                <li className="rounded-md border p-3" key={message.id}>
                  <p className="text-muted-foreground text-sm">
                    {message.actorType} ·{" "}
                    {new Date(message.createdAt).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap">{message.body}</p>
                </li>
              ))}
            </ol>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="font-medium">
              {t("portal:intake.attachments", { defaultValue: "Attachments" })}
            </h2>
            {attachments.data?.map((file) => (
              <div
                className="flex items-center justify-between gap-3 rounded border p-3"
                key={file.id}
              >
                <span>
                  {file.filename} · {Math.ceil(file.size / 1024)} KB ·{" "}
                  {file.state}
                </span>
                {file.state === "pending" ? (
                  <Button
                    variant="outline"
                    onClick={() => finishUpload.mutate(file.id)}
                    disabled={finishUpload.isPending}
                  >
                    {t("portal:intake.completeUpload", {
                      defaultValue: "Finish upload",
                    })}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void downloadPortalSubmissionAttachment({
                        ref,
                        id: file.id,
                      })
                    }
                  >
                    {t("portal:intake.download", { defaultValue: "Download" })}
                  </Button>
                )}
              </div>
            ))}
            {record.version?.formSchema?.fields
              ?.filter((field) => field.type === "file" && canWithdraw)
              .map((field) => (
                <label
                  className="flex flex-col gap-2"
                  htmlFor={`submission-file-${field.key}`}
                  key={field.key}
                >
                  <span>
                    {field.label}
                    {field.multiple ? "" : " (one file)"}
                  </span>
                  <Input
                    id={`submission-file-${field.key}`}
                    type="file"
                    multiple={field.multiple}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      const selected = field.multiple
                        ? files
                        : files.slice(0, 1);
                      for (const file of selected)
                        upload.mutate({ fieldKey: field.key, file });
                      event.target.value = "";
                    }}
                  />
                </label>
              ))}
            {upload.isError && (
              <Alert variant="error">
                <AlertDescription>
                  {t("portal:intake.uploadError", {
                    defaultValue:
                      "The attachment could not be uploaded. Try again.",
                  })}
                </AlertDescription>
              </Alert>
            )}
          </section>
          {state !== "declined" && state !== "withdrawn" && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                reply.mutate();
              }}
            >
              <label htmlFor="portal-reply">
                {t("portal:intake.reply", { defaultValue: "Reply" })}
              </label>
              <Textarea
                id="portal-reply"
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
              <Button type="submit" disabled={!body.trim() || reply.isPending}>
                {t("portal:intake.sendReply", { defaultValue: "Send reply" })}
              </Button>
            </form>
          )}
          {canWithdraw && (
            <Button
              variant="outline"
              onClick={() => withdraw.mutate()}
              disabled={withdraw.isPending}
            >
              {t("portal:intake.withdraw", {
                defaultValue: "Withdraw request",
              })}
            </Button>
          )}
        </>
      )}
    </main>
  );
}
