import { cn } from "../lib/cn";

type ShortcutNumberProps = {
  number: number;
  className?: string;
};

export function ShortcutNumber({ number, className }: ShortcutNumberProps) {
  return (
    <span
      className={cn(
        "ml-auto text-[11px] font-medium text-muted-foreground",
        "select-none pointer-events-none",
        className,
      )}
      aria-hidden="true"
    >
      {number}
    </span>
  );
}
