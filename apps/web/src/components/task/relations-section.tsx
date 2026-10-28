import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@taskdesk/ui";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";

/** Original Kaneo relation disclosure shared by canonical and legacy controllers. */
export default function RelationsSection({
  open,
  onOpenChange,
  count,
  title,
  canEdit,
  addLabel,
  onAdd,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  title: string;
  canEdit: boolean;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {open ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <span>{title}</span>
            </Button>
          </CollapsibleTrigger>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">{count}</span>
          )}
        </div>
        {canEdit && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            aria-label={addLabel}
            onClick={onAdd}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
