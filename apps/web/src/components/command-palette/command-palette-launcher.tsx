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
    // The layout commits the Outlet and this launcher together. Waiting for
    // two browser frames lets that real route content paint before the closed
    // palette is warmed and mounted; this is lifecycle scheduling, not a timer.
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setKeepMounted(true));
    });
    return () => {
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
