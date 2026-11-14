"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import * as React from "react";

import { cn } from "../lib/cn";

const PopoverCreateHandle = PopoverPrimitive.createHandle;

const Popover = PopoverPrimitive.Root;

function PopoverTrigger({
  asChild = false,
  nativeButton = true,
  className,
  children,
  render,
  ...props
}: PopoverPrimitive.Trigger.Props & { asChild?: boolean }) {
  const resolvedRender =
    asChild && React.isValidElement(children) ? children : render;

  return (
    <PopoverPrimitive.Trigger
      className={className}
      data-slot="popover-trigger"
      nativeButton={nativeButton}
      render={resolvedRender}
      {...props}
    >
      {asChild ? undefined : children}
    </PopoverPrimitive.Trigger>
  );
}

/**
 * A popover is a `role="dialog"` popup, and a dialog needs an accessible name (axe
 * `aria-dialog-name`). A caller should pass `aria-label`, `aria-labelledby` or a `PopoverTitle`;
 * when none is given the popup is named by the trigger that opened it (Base UI points the trigger's
 * `aria-controls` at the popup), so an unlabelled option picker still reads as, say, "Priority".
 * Returns false while the popup's id or the trigger's `aria-controls` has not landed yet.
 */
function nameFromTrigger(popup: HTMLElement) {
  if (
    !popup.isConnected ||
    popup.hasAttribute("aria-labelledby") ||
    popup.hasAttribute("aria-label")
  )
    return true;
  if (!popup.id) return false;
  const trigger = popup.ownerDocument.querySelector(
    `[aria-controls="${CSS.escape(popup.id)}"][aria-expanded="true"]`,
  );
  if (!trigger) return false;
  // A trigger rendered through `render` can lose Base UI's id; give it a stable one to point at.
  if (!trigger.id) trigger.id = `${popup.id}-trigger`;
  popup.setAttribute("aria-labelledby", trigger.id);
  return true;
}

/** The popup mounts in the portal's own commit; its id and the trigger catch up within frames. */
function nameFromTriggerSoon(popup: HTMLElement, attemptsLeft = 5) {
  if (nameFromTrigger(popup) || attemptsLeft === 0) return;
  requestAnimationFrame(() => nameFromTriggerSoon(popup, attemptsLeft - 1));
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as React.RefObject<T>).current = value;
}

function PopoverPopup({
  children,
  className,
  side = "bottom",
  align = "center",
  sideOffset = 4,
  alignOffset = 0,
  tooltipStyle = false,
  anchor,
  disableAnchorTracking = false,
  ref,
  ...props
}: PopoverPrimitive.Popup.Props & {
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  tooltipStyle?: boolean;
  anchor?: PopoverPrimitive.Positioner.Props["anchor"];
  disableAnchorTracking?: PopoverPrimitive.Positioner.Props["disableAnchorTracking"];
}) {
  const named = props["aria-label"] != null || props["aria-labelledby"] != null;
  const setPopupRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      assignRef(ref, element);
      if (element && !named) nameFromTriggerSoon(element);
    },
    [ref, named],
  );
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] duration-fast ease-out data-instant:transition-none"
        data-slot="popover-positioner"
        disableAnchorTracking={disableAnchorTracking}
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none transition-[width,height,scale,opacity,transform] duration-fast ease-out before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] has-data-[slot=calendar]:rounded-xl has-data-[slot=calendar]:before:rounded-[calc(var(--radius-xl)-1px)] data-starting-style:scale-98 data-starting-style:opacity-0 data-ending-style:scale-98 data-ending-style:opacity-0 data-[side=top]:data-starting-style:translate-y-1 data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=left]:data-starting-style:translate-x-1 data-[side=right]:data-starting-style:-translate-x-1 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            tooltipStyle &&
              "w-fit text-balance rounded-md text-xs shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]",
            className,
          )}
          data-slot="popover-popup"
          ref={setPopupRef}
          {...props}
        >
          <PopoverPrimitive.Viewport
            className={cn(
              "relative size-full max-h-(--available-height) overflow-clip px-(--viewport-inline-padding) py-0.5 [--viewport-inline-padding:--spacing(1)] has-data-[slot=calendar]:p-2 data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-current:duration-fast **:data-current:ease-out **:data-previous:transition-opacity **:data-previous:duration-fast **:data-previous:ease-out",
              tooltipStyle
                ? "py-0.5 [--viewport-inline-padding:--spacing(1)]"
                : "not-data-transitioning:overflow-y-auto",
            )}
            data-slot="popover-viewport"
          >
            {children}
          </PopoverPrimitive.Viewport>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      className={cn("font-semibold text-lg leading-none", className)}
      data-slot="popover-title"
      {...props}
    />
  );
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="popover-description"
      {...props}
    />
  );
}

export {
  Popover,
  PopoverClose,
  PopoverCreateHandle,
  PopoverDescription,
  PopoverPopup,
  PopoverPopup as PopoverContent,
  PopoverTitle,
  PopoverTrigger,
};
