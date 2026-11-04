import { cn } from "@/lib/cn";

/**
 * Kaneo's property-row trigger (`task-properties-controls.tsx` `buttonClass`). It never grows
 * wider than the property strip, so a long name truncates instead of pushing the strip off
 * the screen at phone width.
 */
export const propertyRowClass = (compact: boolean) =>
  cn(
    "h-7 min-w-0 max-w-full justify-start gap-1.5 px-1.5",
    !compact && "lg:w-full",
  );

/**
 * Props for a property row's `Button`. A row the caller can change stays a button. A row
 * the caller cannot change keeps Kaneo's row geometry but renders as plain text: no button
 * role, no tab stop and no pointer cursor, so it does not look like a control that does
 * nothing.
 */
export function propertyTriggerProps(editable: boolean, compact: boolean) {
  if (editable) return { className: propertyRowClass(compact) };
  return {
    className: cn(
      propertyRowClass(compact),
      "cursor-default hover:bg-transparent active:scale-100",
    ),
    render: <div />,
    "data-read-only": "true",
  };
}
