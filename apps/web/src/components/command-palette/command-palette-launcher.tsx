import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { shortcuts } from "@/constants/shortcuts";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { CommandPaletteIntent, CommandPaletteRequest } from "./index";

const CommandPalette = lazy(async () => {
  const module = await import("./index");
  return { default: module.CommandPalette };
});

let nextRequestId = 0;

/** Small eager shortcut boundary; the command UI and its queries load on intent. */
export default function CommandPaletteLauncher() {
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<CommandPaletteRequest | null>(null);
  const [keepMounted, setKeepMounted] = useState(false);

  const dispatch = useCallback((intent: CommandPaletteIntent) => {
    setRequested(true);
    setRequest({ id: ++nextRequestId, intent });
  }, []);
  const togglePalette = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      dispatch(next ? "open" : "close");
      return next;
    });
  }, [dispatch]);

  useRegisterShortcuts({
    shortcuts: { [shortcuts.search.prefix]: () => dispatch("search") },
    modifierShortcuts: {
      [shortcuts.palette.prefix]: {
        [shortcuts.palette.open]: togglePalette,
      },
    },
    sequentialShortcuts: {
      [shortcuts.project.prefix]: {
        [shortcuts.project.list]: () => dispatch("projects"),
        [shortcuts.project.create]: () => dispatch("create-project"),
      },
      [shortcuts.task.prefix]: {
        [shortcuts.task.create]: () => dispatch("create-task"),
      },
      [shortcuts.workspace.prefix]: {
        [shortcuts.workspace.create]: () => dispatch("create-workspace"),
      },
    },
  });

  const onRequestHandled = useCallback((id: number) => {
    setRequest((current) => (current?.id === id ? null : current));
  }, []);

  useEffect(() => {
    // On the heavy work and board screens, wait for their real primary content
    // commit before warming the closed palette. This avoids competing with the
    // list/board's first render while retaining immediate shortcut intent.
    const path = window.location.pathname;
    const waitsForPrimaryContent =
      (path.includes("/agent/projects/") && path.endsWith("/work")) ||
      path.endsWith("/board");
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;
    let observer: MutationObserver | undefined;
    let cancelled = false;
    const mountAfterCommit = () => {
      if (cancelled || firstFrame !== undefined || secondFrame !== undefined)
        return;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setKeepMounted(true));
      });
    };
    if (waitsForPrimaryContent) {
      if (document.querySelector("[data-primary-content-ready='true']")) {
        mountAfterCommit();
      } else {
        observer = new MutationObserver(() => {
          if (document.querySelector("[data-primary-content-ready='true']")) {
            observer?.disconnect();
            mountAfterCommit();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } else {
      mountAfterCommit();
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (firstFrame !== undefined) cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
  }, []);

  if (!requested && !keepMounted) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        request={request}
        onRequestHandled={onRequestHandled}
        keepMounted={keepMounted}
      />
    </Suspense>
  );
}
