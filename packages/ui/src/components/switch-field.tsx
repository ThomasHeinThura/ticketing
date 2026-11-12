"use client";

import * as React from "react";

import { Switch, type SwitchProps } from "./switch";

/**
 * A line of text under the switch, one per state. Both lines share one grid cell, so the
 * reserved height is the taller of the two and the layout never jumps when the state changes.
 */
export interface SwitchHelper {
  /** Shown while the switch is on. */
  checked?: React.ReactNode;
  /** Shown while the switch is off. */
  unchecked?: React.ReactNode;
}

export type SwitchFieldProps = SwitchProps & {
  /** Helper text that fades and slides in when the state changes. */
  helper: SwitchHelper;
};

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

function SwitchField({
  helper,
  checked: checkedProp,
  defaultChecked,
  onCheckedChange,
  "aria-describedby": describedBy,
  ...props
}: SwitchFieldProps) {
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
      <Switch
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

export { SwitchField };
