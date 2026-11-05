import { Button, Popover, PopoverContent, PopoverTrigger } from "@taskdesk/ui";
import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import ProjectTaskSearchInput from "@/components/common/project-task-search-input";

interface ProjectTaskSearchHeaderProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  activeLabel: string;
}

/**
 * Project task search for the project header's actions.
 *
 * From md to below lg the sidebar, both crumbs and the view strip leave no room for a
 * full-width field, so the field collapses to an icon button that opens it in a popover,
 * the same size as the header's "…" menu. Phones and lg and up keep the inline field.
 * Cmd/Ctrl+F focuses whichever form is shown.
 */
export default function ProjectTaskSearchHeader({
  value,
  onValueChange,
  placeholder,
  clearLabel,
  activeLabel,
}: ProjectTaskSearchHeaderProps) {
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const popoverInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const activeDescriptionId = useId();
  const isSearchActive = value.trim().length > 0;

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f")
        return;
      event.preventDefault();
      const inline = inlineInputRef.current;
      // A field inside a display:none wrapper has no client rects.
      if (inline && inline.getClientRects().length > 0) inline.focus();
      else setOpen(true);
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <>
      <div className="w-full max-w-sm md:max-lg:hidden">
        <ProjectTaskSearchInput
          value={value}
          onValueChange={onValueChange}
          placeholder={placeholder}
          clearLabel={clearLabel}
          inputRef={inlineInputRef}
          registerShortcut={false}
        />
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={placeholder}
              aria-describedby={
                isSearchActive ? activeDescriptionId : undefined
              }
              className="relative hidden size-7 border border-transparent text-muted-foreground hover:text-foreground md:max-lg:inline-flex"
            />
          }
        >
          <Search className="size-4" />
          {/* An active query stays visible while the field is collapsed. */}
          {isSearchActive ? (
            <>
              <span
                aria-hidden="true"
                data-testid="project-task-search-active"
                className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
              />
              <span id={activeDescriptionId} className="sr-only">
                {activeLabel}
              </span>
            </>
          ) : null}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 p-1"
          initialFocus={popoverInputRef}
        >
          <ProjectTaskSearchInput
            value={value}
            onValueChange={onValueChange}
            placeholder={placeholder}
            clearLabel={clearLabel}
            inputRef={popoverInputRef}
            registerShortcut={false}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
