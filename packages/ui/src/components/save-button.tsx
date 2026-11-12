"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "./button";
import { Spinner } from "./spinner";

/** Shared timings for save feedback and its retained completion state. */
export const SAVE_FEEDBACK_DELAY_MS = 150;
export const SAVE_FEEDBACK_HOLD_MS = 1200;

/** Feedback for a single mutation. The labels are supplied by the application. */
export function SaveButton({
  pending,
  success,
  savedLabel,
  workingLabel,
  announceSuccess = true,
  retainedSuccess = false,
  children,
  onClickCapture,
  ...props
}: ButtonProps & {
  pending: boolean;
  success: boolean;
  savedLabel: string;
  workingLabel: string;
  announceSuccess?: boolean;
  retainedSuccess?: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);
  const previousSuccess = useRef(success && !retainedSuccess);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(doneTimer.current), []);

  useEffect(() => {
    if (!pending) {
      setWorking(false);
      return;
    }
    clearTimeout(doneTimer.current);
    setDone(false);
    const timer = setTimeout(() => setWorking(true), SAVE_FEEDBACK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    const becameSuccessful = success && !previousSuccess.current;
    previousSuccess.current = success;
    if (!becameSuccessful) return;
    clearTimeout(doneTimer.current);
    setDone(true);
    doneTimer.current = setTimeout(() => setDone(false), SAVE_FEEDBACK_HOLD_MS);
  }, [success]);

  const showWorking = pending && working;
  const showDone = !pending && done;

  return (
    <>
      <Button
        {...props}
        aria-busy={pending || undefined}
        aria-disabled={pending || props.disabled || undefined}
        onClickCapture={(event) => {
          if (pending) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClickCapture?.(event);
        }}
      >
        <span className="grid items-center justify-items-center">
          <span
            className={`col-start-1 row-start-1 inline-flex items-center gap-2 ${showWorking || showDone ? "invisible" : ""}`}
            aria-hidden={showWorking || showDone}
          >
            {children}
          </span>
          <span
            className="invisible col-start-1 row-start-1 inline-flex items-center gap-2"
            aria-hidden="true"
          >
            <CheckIcon /> {savedLabel}
          </span>
          {showWorking && (
            <span className="col-start-1 row-start-1 inline-flex items-center gap-2 bg-inherit">
              <Spinner
                aria-hidden="true"
                className="motion-reduce:animate-none"
              />
              <span className="sr-only">{children}</span>
            </span>
          )}
          {showDone && (
            <span className="col-start-1 row-start-1 inline-flex items-center gap-2 bg-inherit">
              <CheckIcon aria-hidden="true" /> {savedLabel}
            </span>
          )}
        </span>
      </Button>
      <span className="sr-only" role="status" aria-atomic="true">
        {showWorking
          ? workingLabel
          : showDone && announceSuccess
            ? savedLabel
            : ""}
      </span>
    </>
  );
}
