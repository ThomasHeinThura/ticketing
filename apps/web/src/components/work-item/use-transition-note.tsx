import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@taskdesk/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Ask for the same transition note used by the state control; null means cancelled. */
export function useTransitionNote(projectId: string) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<{
    state: string;
    required: boolean;
  }>();
  const [note, setNote] = useState("");
  const requests = useRef<
    Array<{
      state: string;
      required: boolean;
      resolve: (value: string | null) => void;
    }>
  >([]);
  function finish(value: string | null) {
    const current = requests.current.shift();
    setNote("");
    setRequest(requests.current[0]);
    current?.resolve(value);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel prompts on project change.
  useEffect(
    () => () => {
      for (const pending of requests.current) pending.resolve(null);
      requests.current = [];
      setRequest(undefined);
      setNote("");
    },
    [projectId],
  );
  function ask(state: string, required: boolean) {
    return new Promise<string | null>((resolve) => {
      const next = { state, required, resolve };
      requests.current.push(next);
      if (requests.current.length === 1) setRequest(next);
    });
  }
  const dialog = (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{request?.state}</DialogTitle>
          <DialogDescription>
            {t("workItems:properties.transitionNote")}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label={t("workItems:properties.transitionNote")}
          value={note}
          maxLength={4000}
          onChange={(event) => setNote(event.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(null)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            disabled={Boolean(request?.required && !note.trim())}
            onClick={() => finish(note)}
          >
            {t("workItems:properties.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { ask, dialog };
}
