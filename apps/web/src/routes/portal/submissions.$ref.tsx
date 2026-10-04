import { createFileRoute, Link } from "@tanstack/react-router";
import { apiFetch } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Label,
  Skeleton,
  Textarea,
} from "@taskdesk/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";

export const Route = createFileRoute("/submissions/$ref")({
  component: SubmissionThread,
});

type SubmissionState =
  | "new"
  | "clarifying"
  | "accepted"
  | "declined"
  | "duplicate"
  | "withdrawn";
type Message = {
  id: string;
  actorType: "customer" | "triager";
  body: string;
  createdAt: string;
};
type Submission = {
  ref: string;
  state: SubmissionState;
  workItemKey: string | null;
  createdAt: string;
  requestTypeName: string;
  messages: Message[];
};

function SubmissionThread() {
  const { t } = useTranslation("portal");
  const { ref } = Route.useParams();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [replyError, setReplyError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await apiFetch(
        getApiUrl(`portal/submissions/${encodeURIComponent(ref)}`),
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("submission unavailable");
      setSubmission((await response.json()) as Submission);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [ref]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submission || !reply.trim()) return;
    setSaving(true);
    setReplyError(false);
    try {
      const response = await apiFetch(
        getApiUrl(`portal/submissions/${encodeURIComponent(ref)}/messages`),
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: reply }),
        },
      );
      if (!response.ok) throw new Error("reply unavailable");
      setReply("");
      await load();
    } catch {
      setReplyError(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main
        className="mx-auto min-h-svh w-full max-w-3xl space-y-4 bg-background p-6"
        role="status"
        aria-label={t("thread.loading")}
      >
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }

  if (failed || !submission) {
    return (
      <main className="mx-auto min-h-svh w-full max-w-3xl space-y-4 bg-background p-6">
        <Alert variant="error">
          <AlertTitle>{t("thread.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("thread.loadErrorDescription")}
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void load()}
            >
              {t("thread.retry")}
            </Button>
          </AlertDescription>
        </Alert>
        <Button variant="ghost" render={<Link to="/submissions" />}>
          {t("thread.backToRequests")}
        </Button>
      </main>
    );
  }

  const closed = ["accepted", "declined", "duplicate", "withdrawn"].includes(
    submission.state,
  );

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 bg-background p-6">
      <Button variant="ghost" render={<Link to="/submissions" />}>
        {t("thread.backToRequests")}
      </Button>
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">{submission.ref}</p>
        <h1 className="text-3xl font-semibold">{submission.requestTypeName}</h1>
        <p className="capitalize text-muted-foreground">
          {t(`state.${submission.state}`)}
        </p>
        {submission.workItemKey ? (
          <p>{t("thread.acceptedAs", { key: submission.workItemKey })}</p>
        ) : null}
      </header>

      <section className="space-y-3" aria-label={t("thread.messagesLabel")}>
        {submission.messages.map((message) => (
          <Card key={message.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex justify-between gap-3 text-sm">
                <p className="font-medium">
                  {t(`thread.actor.${message.actorType}`)}
                </p>
                <time
                  dateTime={message.createdAt}
                  className="text-muted-foreground"
                >
                  {new Date(message.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="whitespace-pre-wrap">{message.body}</p>
            </CardContent>
          </Card>
        ))}
        {submission.messages.length === 0 ? (
          <p className="text-muted-foreground">{t("thread.noMessages")}</p>
        ) : null}
      </section>

      {!closed ? (
        <Card>
          <CardContent className="p-4">
            <form
              className="space-y-3"
              onSubmit={(event) => void sendReply(event)}
            >
              <Label htmlFor="submission-reply">{t("thread.replyLabel")}</Label>
              <Textarea
                id="submission-reply"
                value={reply}
                maxLength={20_000}
                onChange={(event) => setReply(event.currentTarget.value)}
              />
              {replyError ? (
                <Alert variant="error">
                  <AlertTitle>{t("thread.replyErrorTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("thread.replyErrorDescription")}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button disabled={saving || !reply.trim()}>
                {saving ? t("thread.sending") : t("thread.send")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
