import type { HTMLAttributes, ReactNode } from "react";

/** Kaneo column surface shared by task and canonical work-item controllers. */
export function ColumnShell({
  header,
  children,
  isOver = false,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  header: ReactNode;
  children: ReactNode;
  isOver?: boolean;
}) {
  return (
    <div
      {...props}
      className={`group relative flex h-full min-h-0 w-full flex-col rounded-xl border transition-colors duration-150 ${
        isOver
          ? "border-ring/40 bg-accent/60 shadow-md ring-2 ring-ring/30"
          : "border-border/70 bg-muted/40 shadow-xs/5 hover:border-border/90 dark:bg-card/90"
      }`}
    >
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    </div>
  );
}
