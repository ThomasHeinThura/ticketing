import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Input, Textarea } from "@taskdesk/ui";
import { Paperclip, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { formatPortalFileSize } from "@/components/portal/portal-format";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";

export type PortalReplyFileFailure = { name: string; reason: string | null };

/**
 * The customer's reply box on a request or submission page, with files staged for the reply
 * (A-08). Keyboard users keep their place: while the reply is on its way the box is read-only and
 * Send stays focusable (`aria-disabled`, not `disabled`, which would drop focus to the page); once
 * it is sent, focus returns to the empty box and a status line announces it. Removing a staged
 * file moves focus to the next file, or to Attach files when none is left.
 */
export function PortalReplyForm({
  canUpload,
  send,
  onSent,
}: {
  canUpload: boolean;
  /** Posts the reply and uploads the files to it; resolves with the files that failed. */
  send: (input: {
    body: string;
    files: File[];
  }) => Promise<PortalReplyFileFailure[]>;
  onSent: () => Promise<unknown>;
}) {
  const { t } = usePortalTranslation("portal");
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const stagedListRef = useRef<HTMLUListElement>(null);
  // The staged file whose Remove button takes focus after a removal; -1: Attach files.
  const [focusAfterRemove, setFocusAfterRemove] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  const [failed, setFailed] = useState<PortalReplyFileFailure[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const reply = useMutation({
    mutationFn: () => send({ body: body.trim(), files: staged }),
    onMutate: () => setAnnouncement(""),
    onSuccess: async (failures) => {
      // Focus moves first, so emptying the box (which disables Send) never strands it.
      bodyRef.current?.focus();
      setBody("");
      setStaged([]);
      setFailed(failures);
      setAnnouncement(t("requestPage.replySent"));
      await onSent();
    },
  });
  const busy = reply.isPending;

  useEffect(() => {
    if (focusAfterRemove === null) return;
    const buttons =
      stagedListRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-remove-file]",
      ) ?? [];
    const target =
      focusAfterRemove >= 0 && buttons.length > 0
        ? buttons[Math.min(focusAfterRemove, buttons.length - 1)]
        : attachRef.current;
    target?.focus();
    setFocusAfterRemove(null);
  }, [focusAfterRemove]);

  function remove(index: number) {
    const next = staged.filter((_, position) => position !== index);
    setStaged(next);
    setFocusAfterRemove(next.length > 0 ? index : -1);
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() && !busy) reply.mutate();
      }}
    >
      <label htmlFor={`${id}-body`} className="font-medium">
        {t("intake.reply")}
      </label>
      <Textarea
        id={`${id}-body`}
        ref={bodyRef}
        value={body}
        readOnly={busy}
        aria-busy={busy || undefined}
        onChange={(event) => {
          setBody(event.target.value);
          setAnnouncement("");
        }}
      />
      {staged.length > 0 ? (
        <ul
          ref={stagedListRef}
          className="flex flex-col gap-1"
          aria-label={t("requestPage.filesToSend")}
        >
          {staged.map((file, index) => (
            <li
              key={`${file.name}:${file.size}:${file.lastModified}`}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5"
            >
              <span className="truncate text-sm">
                {file.name}
                <span className="text-muted-foreground">
                  {" · "}
                  {formatPortalFileSize(file.size)}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                data-remove-file=""
                disabled={busy}
                aria-label={t("requestPage.removeFile", { name: file.name })}
                onClick={() => remove(index)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {reply.isError ? (
        <Alert variant="error">
          <AlertDescription>{t("intake.pageError")}</AlertDescription>
        </Alert>
      ) : null}
      {failed.length > 0 ? (
        <Alert variant="error">
          <AlertDescription>
            <span>{t("requestPage.uploadFailed")}</span>
            <ul className="mt-1 list-disc ps-4">
              {failed.map((file) => (
                <li key={file.name}>
                  {file.reason ? `${file.name}: ${file.reason}` : file.name}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canUpload ? (
          <div className="flex items-center">
            <Button
              ref={attachRef}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Paperclip aria-hidden="true" />
              {t("requestPage.attach")}
            </Button>
            <Input
              ref={inputRef}
              id={`${id}-files`}
              type="file"
              multiple
              unstyled
              className="sr-only"
              tabIndex={-1}
              aria-label={t("requestPage.attach")}
              onChange={(event) => {
                const chosen = Array.from(event.target.files ?? []);
                setStaged((current) => [...current, ...chosen]);
                event.target.value = "";
              }}
            />
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <p role="status" className="text-muted-foreground text-sm">
            {announcement}
          </p>
          <Button
            type="submit"
            disabled={!busy && !body.trim()}
            aria-disabled={busy || undefined}
          >
            {busy ? t("requestPage.sending") : t("intake.sendReply")}
          </Button>
        </div>
      </div>
    </form>
  );
}
