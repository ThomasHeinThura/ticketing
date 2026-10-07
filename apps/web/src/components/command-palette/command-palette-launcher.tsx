import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { shortcuts } from "@/constants/shortcuts";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { CommandPaletteIntent, CommandPaletteRequest } from "./index";

const CommandPalette = lazy(async () => {
  const module = await import("./index");
  return { default: module.CommandPalette };
});

function preloadCommandPalette() {
  // Importing warms the code-split module without rendering CommandPalette's
  // closed dialog, queries, or command-list primitives on the initial screen.
  // A failed background preload is ignored; the normal lazy import still runs
  // when the user requests the palette.
  void import("./index").catch(() => {});
}

let nextRequestId = 0;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Small eager shortcut boundary; the command UI and its queries load on intent. */
export default function CommandPaletteLauncher() {
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<CommandPaletteRequest | null>(null);
  const requestedRef = useRef(false);
  const idleMountRef = useRef<number | undefined>(undefined);

  const cancelIdleMount = useCallback(() => {
    const handle = idleMountRef.current;
    if (handle === undefined) return;
    (window as IdleWindow).cancelIdleCallback?.(handle);
    idleMountRef.current = undefined;
  }, []);

  const dispatch = useCallback(
    (intent: CommandPaletteIntent) => {
      cancelIdleMount();
      requestedRef.current = true;
      setRequested(true);
      setRequest({ id: ++nextRequestId, intent });
    },
    [cancelIdleMount],
  );
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
    // paint before warming the palette module. Explicit shortcut intent still
    // loads and renders immediately through `requested`.
    const path = window.location.pathname;
    const waitsForPrimaryContent =
      (path.includes("/agent/projects/") && path.endsWith("/work")) ||
      path.endsWith("/board");
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;
    let observer: MutationObserver | undefined;
    let cancelled = false;
    const idleWindow = window as IdleWindow;
    const mountAfterCommit = () => {
      if (
        cancelled ||
        requestedRef.current ||
        firstFrame !== undefined ||
        secondFrame !== undefined
      )
        return;
      firstFrame = requestAnimationFrame(() => {
        if (cancelled || requestedRef.current) return;
        secondFrame = requestAnimationFrame(() => {
          if (cancelled || requestedRef.current) return;
          if (typeof idleWindow.requestIdleCallback !== "function") {
            preloadCommandPalette();
            return;
          }
          idleMountRef.current = idleWindow.requestIdleCallback(() => {
            idleMountRef.current = undefined;
            if (!cancelled && !requestedRef.current) preloadCommandPalette();
          });
        });
      });
    };
    if (waitsForPrimaryContent) {
      if (document.querySelector("[data-primary-content-ready='true']")) {
        mountAfterCommit();
      } else {
        observer = new MutationObserver(() => {
          if (requestedRef.current) {
            observer?.disconnect();
            return;
          }
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
      cancelIdleMount();
    };
  }, [cancelIdleMount]);

  if (!requested) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        request={request}
        onRequestHandled={onRequestHandled}
        keepMounted={requested}
      />
    </Suspense>
  );
}
