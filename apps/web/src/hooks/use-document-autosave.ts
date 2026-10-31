import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { HttpError } from "@/lib/http-error";

/** How long after the last edit a document saves itself (L-04). */
export const DOCUMENT_AUTOSAVE_DELAY_MS = 1500;
/**
 * After a network or server failure, the unsaved edits are sent again after each of these
 * delays in turn; after the last one autosave waits for the next edit, blur, leave or Ctrl/⌘+S.
 */
export const DOCUMENT_AUTOSAVE_RETRY_DELAYS_MS = [
  5000, 15_000, 30_000,
] as const;

/** A refusal the server gave on purpose (4xx) is not retried; a lost connection or a 5xx is. */
function isRetryable(error: unknown) {
  return !(error instanceof HttpError && error.status < 500);
}

export type DocumentAutosaveStatus = "saved" | "unsaved" | "saving" | "paused";

export type DocumentAutosaveOptions<
  TChanges,
  TResult extends { version: number },
> = {
  /** The version the editor was loaded from. Read on mount; later use `reset` or `resume`. */
  version: number;
  /** Off for a read-only screen: no saves, no shortcut, no leave warning. */
  enabled?: boolean;
  delayMs?: number;
  /** What differs from the last saved state, read when a save starts; null when nothing does. */
  getChanges: () => TChanges | null;
  /** False while the draft cannot be sent (for example a blank title): the edits stay unsaved. */
  canSave?: () => boolean;
  save: (changes: TChanges, expectedVersion: number) => Promise<TResult>;
  /** A stale-version refusal (409): autosave pauses until `resume` or `reset`. */
  isConflict: (error: unknown) => boolean;
  /** `sent` is exactly what this save sent. Never write the saved body back into the editor. */
  onSaved?: (result: TResult, sent: TChanges) => void;
  /** Opens the screen's conflict dialog; also called again by Ctrl/⌘+S while paused. */
  onConflict: (error: unknown) => void;
  /** Any other failure, reported once per run of failures (not for each automatic retry).
   * The edits stay unsaved; a network or server failure is retried on its own
   * (`DOCUMENT_AUTOSAVE_RETRY_DELAYS_MS`), and every failure is retried with the next edit or flush. */
  onError?: (error: unknown) => void;
};

export type DocumentAutosave = {
  status: DocumentAutosaveStatus;
  /** Call for every edit the person made; the save follows `delayMs` after the last one. */
  markDirty: () => void;
  /** Saves now (blur, leaving, Ctrl/⌘+S). Resolves true once nothing is left unsaved. */
  flush: () => Promise<boolean>;
  /** Keeps the edits and continues from `version` (overwrite / keep mine). Call `flush` next. */
  resume: (version: number) => void;
  /** Drops unsaved edits and any pending save, and continues from `version` (load latest, restore). */
  reset: (version: number) => void;
  /** The version the next save is expected to replace. */
  baseVersion: () => number;
  hasUnsavedChanges: () => boolean;
  /** An in-app navigation held because edits could not be saved. */
  leave: { blocked: boolean; proceed: () => void; stay: () => void };
};

/**
 * L-04 document autosave for Pages and KB articles: one save in flight, each save chained on the
 * version the previous one returned, edits made during a save sent in the next one, and a 409
 * pausing autosave for the screen's own conflict dialog instead of retrying.
 */
export function useDocumentAutosave<
  TChanges,
  TResult extends { version: number },
>(options: DocumentAutosaveOptions<TChanges, TResult>): DocumentAutosave {
  const enabled = options.enabled ?? true;
  const delayMs = options.delayMs ?? DOCUMENT_AUTOSAVE_DELAY_MS;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [status, setStatusState] = useState<DocumentAutosaveStatus>("saved");
  const mounted = useRef(false);
  const versionRef = useRef(options.version);
  /** Edits made so far, and how many of them the server has. */
  const edits = useRef(0);
  const savedEdits = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The debounce ran out while a save was in flight: send again as soon as it ends. */
  const sendAfterFlight = useRef(false);
  const paused = useRef(false);
  const conflict = useRef<unknown>(null);
  const failed = useRef(false);
  /** Bumped by `reset`: a save that started before it no longer applies. */
  const epoch = useRef(0);
  /** Automatic retries made since the last success or edit. */
  const retries = useRef(0);

  const dirty = useCallback(() => edits.current > savedEdits.current, []);
  const setStatus = useCallback((next: DocumentAutosaveStatus) => {
    if (mounted.current) setStatusState(next);
  }, []);
  const settledStatus = useCallback(() => {
    if (paused.current) return setStatus("paused");
    if (inFlight.current) return setStatus("saving");
    setStatus(edits.current > savedEdits.current ? "unsaved" : "saved");
  }, [setStatus]);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // `send` and `schedule` call each other; the ref breaks the cycle.
  const sendRef = useRef<() => Promise<boolean>>(async () => false);

  const schedule = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (inFlight.current) sendAfterFlight.current = true;
      else void sendRef.current();
    }, delayMs);
  }, [clearTimer, delayMs]);

  /** After a retryable failure: one more try after the next backoff delay, if any is left. */
  const scheduleRetry = useCallback(() => {
    const delay = DOCUMENT_AUTOSAVE_RETRY_DELAYS_MS[retries.current];
    if (delay === undefined) return;
    retries.current += 1;
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (inFlight.current) sendAfterFlight.current = true;
      else void sendRef.current();
    }, delay);
  }, [clearTimer]);

  /** Sends one save of everything unsaved; false when nothing could be saved. */
  const send = useCallback(async (): Promise<boolean> => {
    if (inFlight.current || paused.current) return false;
    if (!dirty()) return true;
    const current = optionsRef.current;
    if (current.canSave && !current.canSave()) {
      settledStatus();
      return false;
    }
    const mark = edits.current;
    const changes = current.getChanges();
    if (changes === null) {
      savedEdits.current = mark;
      settledStatus();
      return true;
    }
    const started = epoch.current;
    let ok = false;
    let retry = false;
    failed.current = false;
    const flight = (async () => {
      try {
        const result = await current.save(changes, versionRef.current);
        if (started !== epoch.current) return;
        versionRef.current = result.version;
        savedEdits.current = Math.max(savedEdits.current, mark);
        ok = true;
        optionsRef.current.onSaved?.(result, changes);
      } catch (error) {
        if (started !== epoch.current) return;
        if (optionsRef.current.isConflict(error)) {
          paused.current = true;
          conflict.current = error;
          optionsRef.current.onConflict(error);
        } else {
          failed.current = true;
          retry = isRetryable(error);
          // One message per run of retried failures; a final refusal (4xx) is always reported.
          if (retries.current === 0 || !retry)
            optionsRef.current.onError?.(error);
        }
      }
    })();
    inFlight.current = flight;
    setStatus("saving");
    await flight;
    if (inFlight.current === flight) inFlight.current = null;
    const again = sendAfterFlight.current;
    sendAfterFlight.current = false;
    if (ok) retries.current = 0;
    if (ok && dirty() && !paused.current && (again || !timer.current)) {
      // Edits made during this save: their debounce already ran out, so send them now.
      void sendRef.current();
    } else if (retry && dirty() && !paused.current && !timer.current) {
      // No edit is waiting to trigger a save: try again after a backoff delay.
      scheduleRetry();
    }
    settledStatus();
    return ok;
  }, [setStatus, settledStatus, dirty, scheduleRetry]);
  sendRef.current = send;

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    // An explicit save (Ctrl/Cmd+S, blur, leave) starts a new run, so its failure is reported.
    retries.current = 0;
    // A bounded loop: each pass either waits for the save in flight or sends one.
    for (let pass = 0; pass < 8; pass += 1) {
      if (inFlight.current) {
        await inFlight.current;
        continue;
      }
      if (paused.current) return false;
      if (!dirty()) return true;
      if (!(await send())) return !dirty() && !paused.current;
    }
    return !dirty() && !paused.current;
  }, [clearTimer, send, dirty]);

  const markDirty = useCallback(() => {
    if (!enabled) return;
    edits.current += 1;
    retries.current = 0;
    if (paused.current) return;
    if (!inFlight.current) setStatus("unsaved");
    schedule();
  }, [enabled, schedule, setStatus]);

  const resume = useCallback(
    (version: number) => {
      versionRef.current = version;
      paused.current = false;
      conflict.current = null;
      failed.current = false;
      settledStatus();
    },
    [settledStatus],
  );

  const reset = useCallback(
    (version: number) => {
      epoch.current += 1;
      clearTimer();
      sendAfterFlight.current = false;
      retries.current = 0;
      inFlight.current = null;
      versionRef.current = version;
      savedEdits.current = edits.current;
      paused.current = false;
      conflict.current = null;
      failed.current = false;
      setStatus("saved");
    },
    [clearTimer, setStatus],
  );

  const hasUnsavedChanges = useCallback(
    () => dirty() || inFlight.current !== null,
    [dirty],
  );

  // Ctrl/⌘+S saves now; while paused it reopens the conflict dialog.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (paused.current) optionsRef.current.onConflict(conflict.current);
      else void flush();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, flush]);

  // Leaving the screen saves what is left. Set in the effect (not on render) so a StrictMode
  // remount does not leave the hook thinking it is gone.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      if (paused.current || !dirty()) return;
      if (inFlight.current) sendAfterFlight.current = true;
      else void sendRef.current();
    };
  }, [clearTimer, dirty]);

  const blocker = useBlocker({
    // Same-path navigations (search state such as the KB customer preview) never leave.
    shouldBlockFn: async ({ current, next }) => {
      if (current.pathname === next.pathname) return false;
      if (!hasUnsavedChanges()) return false;
      return !(await flush());
    },
    enableBeforeUnload: () => enabled && hasUnsavedChanges(),
    disabled: !enabled,
    withResolver: true,
  });

  const baseVersion = useCallback(() => versionRef.current, []);
  return {
    status,
    markDirty,
    flush,
    resume,
    reset,
    baseVersion,
    hasUnsavedChanges,
    leave: {
      blocked: blocker.status === "blocked",
      proceed: () => blocker.proceed?.(),
      stay: () => blocker.reset?.(),
    },
  };
}
