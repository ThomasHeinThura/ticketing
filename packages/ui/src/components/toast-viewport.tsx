"use client";

import { Toast } from "@base-ui/react/toast";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { cn } from "../lib/cn";
import { buttonVariants } from "./button";

import type { ToastPosition } from "./toast";

const TOAST_ICONS = {
  error: CircleAlertIcon,
  info: InfoIcon,
  loading: LoaderCircleIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

function useVisibleToasts() {
  const { toasts } = Toast.useToastManager();
  const shown = useRef(new Set<string>());
  const hidden = new Set<string>();
  for (const toast of toasts) {
    if (toast.transitionStatus === "ending" && !shown.current.has(toast.id))
      hidden.add(toast.id);
    else shown.current.add(toast.id);
  }
  return { toasts, hidden };
}

function Toasts({ position = "bottom-right" }: { position: ToastPosition }) {
  const { toasts, hidden } = useVisibleToasts();
  const isTop = position.startsWith("top");

  return (
    <>
      {toasts.map((toast) => {
        // Let Base UI complete removal/onRemove without ever flashing a cancelled notification.
        if (hidden.has(toast.id))
          return <Toast.Root className="hidden" key={toast.id} toast={toast} />;
        const Icon = toast.type
          ? TOAST_ICONS[toast.type as keyof typeof TOAST_ICONS]
          : null;

        return (
          <Toast.Root
            className={cn(
              "absolute z-[calc(9999-var(--toast-index))] h-(--toast-calc-height) w-full select-none rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 [transition:transform_.5s_cubic-bezier(.22,1,.36,1),opacity_.5s,height_.15s] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
              // Base positioning using data-position
              "data-[position*=right]:right-0 data-[position*=right]:left-auto",
              "data-[position*=left]:right-auto data-[position*=left]:left-0",
              "data-[position*=center]:right-0 data-[position*=center]:left-0",
              "data-[position*=top]:top-0 data-[position*=top]:bottom-auto data-[position*=top]:origin-top",
              "data-[position*=bottom]:top-auto data-[position*=bottom]:bottom-0 data-[position*=bottom]:origin-bottom",
              // Gap fill for hover
              "after:absolute after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full",
              "data-[position*=top]:after:top-full",
              "data-[position*=bottom]:after:bottom-full",
              // Define some variables
              "[--toast-calc-height:var(--toast-frontmost-height,var(--toast-height))] [--toast-gap:--spacing(3)] [--toast-peek:--spacing(3)] [--toast-scale:calc(max(0,1-(var(--toast-index)*.1)))] [--toast-shrink:calc(1-var(--toast-scale))]",
              // Define offset-y variable
              "data-[position*=top]:[--toast-calc-offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap)+var(--toast-swipe-movement-y))]",
              "data-[position*=bottom]:[--toast-calc-offset-y:calc(var(--toast-offset-y)*-1+var(--toast-index)*var(--toast-gap)*-1+var(--toast-swipe-movement-y))]",
              // Default state transform
              "data-[position*=top]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
              "data-[position*=bottom]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--toast-peek))-(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
              // Limited state
              "data-limited:opacity-0",
              // Expanded state
              "data-expanded:h-(--toast-height)",
              "data-position:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-calc-offset-y))]",
              // Starting and ending animations
              "data-[position*=top]:data-starting-style:transform-[translateY(calc(-100%-var(--toast-inset)))]",
              "data-[position*=bottom]:data-starting-style:transform-[translateY(calc(100%+var(--toast-inset)))]",
              "data-ending-style:opacity-0",
              // Ending animations (direction-aware)
              "data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(100%+var(--toast-inset)))]",
              "data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
              "data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
              "data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
              "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
              // Ending animations (expanded)
              "data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
              "data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
              "data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
              "data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
            )}
            data-position={position}
            key={toast.id}
            swipeDirection={
              position.includes("center")
                ? [isTop ? "up" : "down"]
                : position.includes("left")
                  ? ["left", isTop ? "up" : "down"]
                  : ["right", isTop ? "up" : "down"]
            }
            toast={toast}
          >
            <Toast.Content className="pointer-events-auto flex items-center justify-between gap-1.5 overflow-hidden px-3.5 py-3 text-sm transition-opacity duration-250 data-behind:not-data-expanded:pointer-events-none data-behind:opacity-0 data-expanded:opacity-100">
              <div className="flex gap-2">
                {Icon && (
                  <div
                    className="[&>svg]:h-lh [&>svg]:w-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                    data-slot="toast-icon"
                  >
                    <Icon className="in-data-[type=loading]:animate-spin in-data-[type=error]:text-destructive in-data-[type=info]:text-info in-data-[type=success]:text-success in-data-[type=warning]:text-warning in-data-[type=loading]:opacity-80" />
                  </div>
                )}

                <div className="flex flex-col gap-0.5">
                  <Toast.Title
                    className="font-sans font-normal tracking-normal"
                    data-slot="toast-title"
                  />
                  <Toast.Description
                    className="text-muted-foreground"
                    data-slot="toast-description"
                  />
                </div>
              </div>
              {toast.actionProps && (
                <Toast.Action
                  className={buttonVariants({ size: "xs" })}
                  data-slot="toast-action"
                >
                  {toast.actionProps.children}
                </Toast.Action>
              )}
            </Toast.Content>
          </Toast.Root>
        );
      })}
    </>
  );
}

function AnchoredToasts() {
  const { toasts, hidden } = useVisibleToasts();

  return (
    <>
      {toasts.map((toast) => {
        // Let Base UI complete removal/onRemove without ever flashing a cancelled notification.
        if (hidden.has(toast.id))
          return <Toast.Root className="hidden" key={toast.id} toast={toast} />;
        const Icon = toast.type
          ? TOAST_ICONS[toast.type as keyof typeof TOAST_ICONS]
          : null;
        const tooltipStyle =
          (toast.data as { tooltipStyle?: boolean })?.tooltipStyle ?? false;
        const positionerProps = toast.positionerProps;

        if (!positionerProps?.anchor) {
          return null;
        }

        return (
          <Toast.Positioner
            className="z-50 max-w-[min(--spacing(64),var(--available-width))]"
            data-slot="toast-positioner"
            key={toast.id}
            sideOffset={positionerProps.sideOffset ?? 4}
            toast={toast}
          >
            <Toast.Root
              className={cn(
                "relative text-balance border bg-popover not-dark:bg-clip-padding text-popover-foreground text-xs transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
                tooltipStyle
                  ? "rounded-md shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]"
                  : "rounded-lg shadow-lg/5 before:rounded-[calc(var(--radius-lg)-1px)]",
              )}
              data-slot="toast-popup"
              toast={toast}
            >
              {tooltipStyle ? (
                <Toast.Content className="pointer-events-auto px-2 py-1">
                  <Toast.Title
                    className="font-sans tracking-normal"
                    data-slot="toast-title"
                  />
                </Toast.Content>
              ) : (
                <Toast.Content className="pointer-events-auto flex items-center justify-between gap-1.5 overflow-hidden px-3.5 py-3 text-sm">
                  <div className="flex gap-2">
                    {Icon && (
                      <div
                        className="[&>svg]:h-lh [&>svg]:w-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                        data-slot="toast-icon"
                      >
                        <Icon className="in-data-[type=loading]:animate-spin in-data-[type=error]:text-destructive in-data-[type=info]:text-info in-data-[type=success]:text-success in-data-[type=warning]:text-warning in-data-[type=loading]:opacity-80" />
                      </div>
                    )}

                    <div className="flex flex-col gap-0.5">
                      <Toast.Title
                        className="font-sans font-normal tracking-normal"
                        data-slot="toast-title"
                      />
                      <Toast.Description
                        className="text-muted-foreground"
                        data-slot="toast-description"
                      />
                    </div>
                  </div>
                  {toast.actionProps && (
                    <Toast.Action
                      className={buttonVariants({ size: "xs" })}
                      data-slot="toast-action"
                    >
                      {toast.actionProps.children}
                    </Toast.Action>
                  )}
                </Toast.Content>
              )}
            </Toast.Root>
          </Toast.Positioner>
        );
      })}
    </>
  );
}

export default function ToastContents({
  position,
  anchored,
  onReady,
}: {
  position: ToastPosition;
  anchored: boolean;
  onReady: () => void;
}) {
  useLayoutEffect(onReady, [onReady]);
  return anchored ? <AnchoredToasts /> : <Toasts position={position} />;
}
