import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { FormSchema } from "@taskdesk/domain/intake";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
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
  Textarea,
} from "@taskdesk/ui";
import { ChevronLeft, MessageSquare, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { getApiUrl } from "@/fetchers/get-api-url";
import getProjects from "@/fetchers/project/get-projects";
import {
  acceptIntakeSubmission,
  claimIntakeSubmission,
  declineIntakeSubmission,
  getIntakeSubmission,
  sendIntakeMessage,
} from "@/fetchers/request-type";
import getWorkItemTypes from "@/fetchers/work-item/get-work-item-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/submissions/$ref",
)({ component: IntakeSubmissionRoute });

function IntakeSubmissionRoute() {
  const { ref } = Route.useParams();
  const { t } = useTranslation("intakeTriage");
  const { data: workspace } = useActiveWorkspace();
  const cache = useQueryClient();
  const { canTriageIntake, isCheckingPermissions } = useWorkspacePermission(
    workspace?.id ?? null,
  );
  const allowed = canTriageIntake();
  const detail = useQuery({
    queryKey: ["intake-submission", ref],
    queryFn: () => getIntakeSubmission(ref),
    enabled: allowed,
  });
  const projects = useQuery({
    queryKey: ["projects", workspace?.id ?? ""],
    queryFn: () => getProjects({ workspaceId: workspace!.id }),
    enabled: Boolean(workspace?.id && allowed),
  });
  const types = useQuery({
    queryKey: ["work-item-types", workspace?.id ?? ""],
    queryFn: () => getWorkItemTypes(workspace!.id),
    enabled: Boolean(workspace?.id && allowed),
  });
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [projectId, setProjectId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canAct =
    detail.data?.state === "new" || detail.data?.state === "clarifying";
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["intake-submission", ref] });
    await cache.invalidateQueries({ queryKey: ["intake-queue"] });
  };
  const claim = useMutation({
    mutationFn: () => claimIntakeSubmission(ref),
    onSuccess: refresh,
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t("claimError")),
  });
  const send = useMutation({
    mutationFn: () => sendIntakeMessage(ref, message),
    onSuccess: async () => {
      setMessage("");
      await refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t("claimError")),
  });
  const decline = useMutation({
    mutationFn: () => declineIntakeSubmission(ref, reason),
    onSuccess: async () => {
      setReason("");
      await refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t("declineError")),
  });
  const accept = useMutation({
    mutationFn: () => acceptIntakeSubmission(ref, { projectId, typeId }),
    onSuccess: refresh,
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t("actionUnavailable")),
  });

  if (!isCheckingPermissions && !allowed)
    return (
      <main className="p-6">
        <Alert variant="error">
          <AlertTitle>{t("title")}</AlertTitle>
          <AlertDescription>{t("loadError")}</AlertDescription>
        </Alert>
      </main>
    );
  if (detail.isLoading)
    return (
      <main className="space-y-4 p-6" role="status">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-56 w-full" />
      </main>
    );
  if (detail.isError || !detail.data)
    return (
      <main className="p-6">
        <Alert variant="error">
          <AlertTitle>{t("loadError")}</AlertTitle>
          <AlertDescription>{t("loadError")}</AlertDescription>
        </Alert>
      </main>
    );
  const submission = detail.data;
  const schema = submission.formSchema as FormSchema;
  const selectedProject = projectId || submission.suggestedProjectId || "";
  const selectedType = typeId || submission.suggestedWorkItemTypeId || "";
  const values = Object.entries(submission.formData);
  return (
    <>
      <PageTitle title={`${submission.ref} · ${submission.requestTypeName}`} />
      <main className="flex h-full flex-col gap-5 overflow-y-auto p-6">
        <Button
          variant="ghost"
          render={<Link to="/agent/triage" search={{ tab: "intake" }} />}
        >
          <ChevronLeft aria-hidden="true" />
          {t("back")}
        </Button>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{submission.ref}</h1>
            <p className="text-sm text-muted-foreground">
              {submission.requestTypeName} · {t(`states.${submission.state}`)}
            </p>
          </div>
          {canAct && !submission.claimedBy ? (
            <Button
              variant="outline"
              onClick={() => claim.mutate()}
              disabled={claim.isPending}
            >
              <ShieldCheck aria-hidden="true" />
              {t("claim")}
            </Button>
          ) : null}
        </header>
        {error ? (
          <Alert variant="error">
            <AlertTitle>{t("actionUnavailable")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>{t("answers")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {values.map(([key, value]) => {
                  const label =
                    schema.fields.find((field) => field.key === key)?.label ??
                    key;
                  return (
                    <div key={key} className="min-w-0">
                      <p className="text-sm text-muted-foreground">{label}</p>
                      <p className="break-words">
                        {typeof value === "string"
                          ? value
                          : value === null
                            ? "—"
                            : JSON.stringify(value)}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            {submission.attachments.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("attachments")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {submission.attachments.map((attachment) => (
                    <a
                      className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm underline-offset-4 hover:underline"
                      href={getApiUrl(
                        `submissions/${encodeURIComponent(ref)}/attachments/${encodeURIComponent(attachment.id)}`,
                      )}
                      key={attachment.id}
                    >
                      <span className="min-w-0 truncate">
                        {attachment.filename}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {t("downloadAttachment")}
                      </span>
                    </a>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>{t("thread")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {submission.messages.map((entry) => (
                  <article key={entry.id} className="rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {t(`actor.${entry.actorType}`)}
                    </p>
                    <p className="whitespace-pre-wrap">{entry.body}</p>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={new Date(entry.createdAt).toISOString()}
                    >
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                  </article>
                ))}
                {canAct ? (
                  <div className="grid gap-2">
                    <Label htmlFor="triage-message">{t("message")}</Label>
                    <Textarea
                      id="triage-message"
                      value={message}
                      onChange={(event) =>
                        setMessage(event.currentTarget.value)
                      }
                      placeholder={t("messagePlaceholder")}
                    />
                    <Button
                      className="justify-self-start"
                      variant="outline"
                      disabled={!message.trim() || send.isPending}
                      onClick={() => send.mutate()}
                    >
                      <MessageSquare aria-hidden="true" />
                      {t("sendMessage")}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
          {canAct ? (
            <aside className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t("accept")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label>{t("project")}</Label>
                    <Select
                      value={selectedProject}
                      onValueChange={(value) => setProjectId(value ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("project")} />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.data?.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>{t("workItemType")}</Label>
                    <Select
                      value={selectedType}
                      onValueChange={(value) => setTypeId(value ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("workItemType")} />
                      </SelectTrigger>
                      <SelectContent>
                        {types.data?.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {projects.data?.length ? (
                    <Button
                      className="w-full"
                      disabled={
                        !selectedProject || !selectedType || accept.isPending
                      }
                      onClick={() => accept.mutate()}
                    >
                      {t("accept")}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("noProjects")}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t("decline")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Label htmlFor="decline-reason">{t("decline")}</Label>
                  <Input
                    id="decline-reason"
                    value={reason}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    placeholder={t("declinePlaceholder")}
                  />
                  <Button
                    variant="destructive"
                    disabled={!reason.trim() || decline.isPending}
                    onClick={() => decline.mutate()}
                  >
                    {t("decline")}
                  </Button>
                </CardContent>
              </Card>
            </aside>
          ) : null}
        </div>
      </main>
    </>
  );
}
