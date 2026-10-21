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
import { waitsForPrimaryContent } from "@/lib/after-primary-content";
import { whenSidebarShown } from "@/lib/sidebar-shown";
import type { CommandPaletteIntent, CommandPaletteRequest } from "./index";

let paletteModule: Promise<typeof import("./index")> | undefined;
/** One download of the palette module, shared by the warm-up prefetch and the lazy mount. */
function loadPaletteModule() {
  paletteModule ??= import("./index");
  return paletteModule;
}

const CommandPalette = lazy(async () => {
  const module = await loadPaletteModule();
  return { default: module.CommandPalette };
});

let nextRequestId = 0;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Small eager shortcut boundary; the command UI and its queries load on intent. */
export default function CommandPaletteLauncher() {
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<CommandPaletteRequest | null>(null);
  const [keepMounted, setKeepMounted] = useState(false);
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
    // paint before warming the closed palette. Explicit shortcut intent still
    // loads immediately through `requested`.
    const waitsForPrimary = waitsForPrimaryContent(window.location.pathname);
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;
    let observer: MutationObserver | undefined;
    let cancelled = false;
    const idleWindow = window as IdleWindow;
    let started = false;
    const mountAfterCommit = () => {
      if (cancelled || requestedRef.current || started) return;
      started = true;
      // Start the download now; only the mount waits (for the sidebar on the heavy screens,
      // then for paint frames and idle time).
      void loadPaletteModule().catch(() => {});
      // On those screens the sidebar has already taken its turn, so idle time is only
      // waited for briefly: the popup must be up well inside G11's 5 s.
      if (waitsForPrimary)
        void whenSidebarShown().then(() => {
          if (!cancelled && !requestedRef.current) mountWhenIdle(300);
        });
      else mountWhenIdle(1_000);
    };
    const mountWhenIdle = (idleTimeoutMs: number) => {
      firstFrame = requestAnimationFrame(() => {
        if (cancelled || requestedRef.current) return;
        secondFrame = requestAnimationFrame(() => {
          if (cancelled || requestedRef.current) return;
          if (typeof idleWindow.requestIdleCallback !== "function") {
            setKeepMounted(true);
            return;
          }
          // Bounded, so a busy main thread on a slow machine cannot leave the palette cold.
          idleMountRef.current = idleWindow.requestIdleCallback(
            () => {
              idleMountRef.current = undefined;
              if (!cancelled) setKeepMounted(true);
            },
            { timeout: idleTimeoutMs },
          );
        });
      });
    };
    if (waitsForPrimary) {
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
