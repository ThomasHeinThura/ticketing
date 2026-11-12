"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import * as React from "react";

import { cn } from "../lib/cn";

/**
 * A line of text under the switch, one per state. Both lines share one grid cell, so the
 * reserved height is the taller of the two and the layout never jumps when the state changes.
 */
interface SwitchHelper {
  /** Shown while the switch is on. */
  checked?: React.ReactNode;
  /** Shown while the switch is off. */
  unchecked?: React.ReactNode;
}

type SwitchProps = SwitchPrimitive.Root.Props & {
  /** Optional helper text that fades and slides in when the state changes. */
  helper?: SwitchHelper;
};

function SwitchControl({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-[background-color,box-shadow] duration-base [--thumb-size:--spacing(5)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-64 sm:[--thumb-size:--spacing(4)]",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block aspect-square h-full origin-left in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-110 in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] rounded-(--thumb-size) bg-background shadow-sm/5 will-change-transform [transition:translate_var(--duration-base)_var(--ease-spring),border-radius_var(--duration-fast),scale_.1s_.1s,transform-origin_var(--duration-fast)] data-checked:origin-[var(--thumb-size)_50%] data-checked:translate-x-[calc(var(--thumb-size)-4px)]",
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

function SwitchHelperLine({
  active,
  children,
  id,
}: {
  active: boolean;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <span
      className="invisible col-start-1 row-start-1 translate-y-1 opacity-0 transition-[opacity,translate,visibility] duration-base ease-out data-active:visible data-active:translate-y-0 data-active:opacity-100"
      data-active={active ? "" : undefined}
      data-slot="switch-helper-line"
      id={id}
      // The inactive line is out of the accessibility tree at once; only the active one
      // describes the switch.
      inert={!active}
    >
      {children}
    </span>
  );
}

function SwitchWithHelper({
  helper,
  checked: checkedProp,
  defaultChecked,
  onCheckedChange,
  "aria-describedby": describedBy,
  ...props
}: SwitchPrimitive.Root.Props & { helper: SwitchHelper }) {
  const [uncontrolledChecked, setUncontrolledChecked] = React.useState(
    Boolean(defaultChecked),
  );
  const checked = checkedProp ?? uncontrolledChecked;
  const id = React.useId();
  const checkedId = `${id}-checked`;
  const uncheckedId = `${id}-unchecked`;
  const activeHelper = checked ? helper.checked : helper.unchecked;
  const describedByIds = [
    describedBy,
    activeHelper == null ? undefined : checked ? checkedId : uncheckedId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col items-start gap-1.5" data-slot="switch-field">
      <SwitchControl
        {...props}
        aria-describedby={describedByIds || undefined}
        checked={checkedProp}
        defaultChecked={defaultChecked}
        onCheckedChange={(next, eventDetails) => {
          onCheckedChange?.(next, eventDetails);
          if (!eventDetails.isCanceled && checkedProp === undefined) {
            setUncontrolledChecked(next);
          }
        }}
      />
      <span
        className="grid text-muted-foreground text-xs"
        data-slot="switch-helper"
      >
        <SwitchHelperLine active={checked} id={checkedId}>
          {helper.checked}
        </SwitchHelperLine>
        <SwitchHelperLine active={!checked} id={uncheckedId}>
          {helper.unchecked}
        </SwitchHelperLine>
      </span>
    </div>
  );
}

function Switch({ helper, ...props }: SwitchProps) {
  // Without a helper the DOM is exactly the bare switch, so existing layouts do not shift.
  if (!helper) return <SwitchControl {...props} />;
  return <SwitchWithHelper helper={helper} {...props} />;
}

export { Switch };
