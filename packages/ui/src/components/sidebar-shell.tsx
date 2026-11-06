"use client";

import { PanelLeftIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { useIsMobile } from "../lib/use-mobile";
import { Button } from "./button";

// The parts of the sidebar a page shell needs before the sidebar itself (provider, trigger,
// inset). Kept apart from `sidebar.tsx`, whose mobile sheet and menu tooltips pull in the
// popup runtime, so a page can paint inside the shell without loading them (G11).

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";
/** The id `SidebarInset` gives its `main`, which the shell's skip link targets. */
const SIDEBAR_MAIN_ID = "main-content";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

/**
 * WCAG 2.4.1 bypass block: the first focusable element of the shell, visually hidden until it has
 * keyboard focus, that moves focus past the sidebar to the page's `main`. Focus is moved by script
 * (no `#main-content` in the URL, which would disturb router URL state) and the temporary
 * `tabindex` is dropped again on blur so clicks inside `main` never focus it.
 */
function SkipToMainLink({
  label,
  targetId = SIDEBAR_MAIN_ID,
}: {
  label: string;
  targetId?: string;
}) {
  return (
    <a
      className="sr-only rounded-md border bg-popover font-medium text-popover-foreground text-sm shadow-md outline-none focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-100 focus-visible:px-3 focus-visible:py-2 focus-visible:ring-2 focus-visible:ring-ring"
      data-slot="skip-link"
      href={`#${targetId}`}
      onClick={(event) => {
        const document = event.currentTarget.ownerDocument;
        // Fall back to the shell's `main` when a page has no element with `targetId`.
        const target =
          document.getElementById(targetId) ??
          document.getElementById(SIDEBAR_MAIN_ID);
        if (!target) return;
        event.preventDefault();
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
          target.addEventListener(
            "blur",
            () => target.removeAttribute("tabindex"),
            { once: true },
          );
        }
        target.focus();
      }}
    >
      {label}
    </a>
  );
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  skipLinkLabel,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Translated "Skip to main content". When given, the shell's first focusable element is a skip
   * link to `SidebarInset`'s `main`; every shell with a sidebar should pass it.
   */
  skipLinkLabel?: string;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    async (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }

      await cookieStore.set({
        expires: Date.now() + SIDEBAR_COOKIE_MAX_AGE * 1000,
        name: SIDEBAR_COOKIE_NAME,
        path: "/",
        value: String(openState),
      });
    },
    [setOpenProp, open],
  );

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
  }, [isMobile, setOpen]);

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      const isEditableTarget = Boolean(
        target &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
            target.closest('[contenteditable="true"]')),
      );
      if (isEditableTarget) return;

      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      state,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
          className,
        )}
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {skipLinkLabel ? <SkipToMainLink label={skipLinkLabel} /> : null}
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function SidebarTrigger({
  className,
  onClick,
  toggleLabel,
  ...props
}: React.ComponentProps<typeof Button> & { toggleLabel: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      className={cn("size-7", className)}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">{toggleLabel}</span>
    </Button>
  );
}

/** The page's one `main` landmark; pages inside it must not render another `main`. */
function SidebarInset({
  className,
  id = SIDEBAR_MAIN_ID,
  ...props
}: React.ComponentProps<"main">) {
  return (
    <main
      id={id}
      className={cn(
        "outline-none",
        "relative flex w-full flex-1 flex-col bg-background",
        "md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm/5",
        className,
      )}
      data-slot="sidebar-inset"
      {...props}
    />
  );
}

export {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  SkipToMainLink,
  useSidebar,
};
