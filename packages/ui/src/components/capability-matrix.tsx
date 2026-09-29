"use client";

import { cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn";
import { Checkbox } from "./checkbox";

const capabilityMatrixVariants = cva("grid gap-4");

export type CapabilityMatrixItem = {
  /** Stable identifier supplied by the capability vocabulary. */
  id: string;
  /** Short display name for the capability. */
  label: string;
  /** Plain-language explanation supplied by the capability vocabulary. */
  description: string;
  /** Display group supplied by the capability vocabulary. */
  group: string;
};

export type CapabilityMatrixProps = Omit<
  React.ComponentPropsWithoutRef<"div">,
  "children"
> & {
  /** Capability metadata; items are grouped in the order they first appear. */
  items: readonly CapabilityMatrixItem[];
  /** Controlled selected capability identifiers. */
  selected: readonly string[];
  /** Identifiers that the caller has determined cannot be changed. */
  disabled?: readonly string[];
  /** Optional plain-language explanations for disabled identifiers. */
  disabledReasons?: Readonly<Record<string, string>>;
  /** Reports the next controlled selection without changing authorization state. */
  onSelectedChange: (selected: string[]) => void;
  className?: string;
};

const CapabilityMatrix = React.forwardRef<
  HTMLDivElement,
  CapabilityMatrixProps
>(
  (
    {
      items,
      selected,
      disabled = [],
      disabledReasons = {},
      onSelectedChange,
      className,
      ...props
    },
    ref,
  ) => {
    const idPrefix = React.useId();
    const selectedIds = new Set(selected);
    const disabledIds = new Set(disabled);
    const groups = new Map<string, CapabilityMatrixItem[]>();

    for (const item of items) {
      const groupItems = groups.get(item.group);
      if (groupItems) {
        groupItems.push(item);
      } else {
        groups.set(item.group, [item]);
      }
    }

    return (
      <div
        ref={ref}
        className={cn(capabilityMatrixVariants(), className)}
        {...props}
        data-slot="capability-matrix"
      >
        {[...groups.entries()].map(([group, groupItems], groupIndex) => {
          const groupHeadingId = `${idPrefix}-group-${groupIndex}`;

          return (
            <fieldset
              className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-0"
              data-slot="capability-matrix-group"
              key={group}
            >
              <legend
                className="px-4 py-3 font-medium text-foreground text-sm"
                id={groupHeadingId}
              >
                {group}
              </legend>
              <ul className="divide-y divide-border">
                {groupItems.map((item, itemIndex) => {
                  const checkboxId = `${idPrefix}-item-${groupIndex}-${itemIndex}`;
                  const labelId = `${checkboxId}-label`;
                  const descriptionId = `${checkboxId}-description`;
                  const reasonId = `${checkboxId}-disabled-reason`;
                  const isDisabled = disabledIds.has(item.id);
                  const disabledReason = isDisabled
                    ? disabledReasons[item.id]
                    : undefined;

                  return (
                    <li
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3"
                      key={item.id}
                    >
                      <Checkbox
                        aria-describedby={
                          disabledReason
                            ? `${descriptionId} ${reasonId}`
                            : descriptionId
                        }
                        aria-labelledby={labelId}
                        checked={selectedIds.has(item.id)}
                        disabled={isDisabled}
                        id={checkboxId}
                        onCheckedChange={(checked) => {
                          if (checked !== true && checked !== false) return;
                          const next = new Set(selected);
                          if (checked) next.add(item.id);
                          else next.delete(item.id);
                          onSelectedChange([...next]);
                        }}
                      />
                      <div className="min-w-0">
                        <label
                          className="font-medium text-foreground text-sm"
                          htmlFor={checkboxId}
                          id={labelId}
                        >
                          {item.label}
                        </label>
                        <p
                          className="mt-1 text-muted-foreground text-sm"
                          id={descriptionId}
                        >
                          {item.description}
                        </p>
                        {disabledReason && (
                          <p
                            className="mt-1 text-muted-foreground text-xs"
                            id={reasonId}
                          >
                            {disabledReason}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>
    );
  },
);

CapabilityMatrix.displayName = "CapabilityMatrix";

export { CapabilityMatrix };
