import { Button, Input } from "@taskdesk/ui";
import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface ProjectTaskSearchInputProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

export default function ProjectTaskSearchInput({
  value,
  onValueChange,
  placeholder,
  clearLabel,
  inputRef,
}: ProjectTaskSearchInputProps) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const resolvedInputRef = inputRef ?? internalInputRef;

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (resolvedInputRef && "current" in resolvedInputRef) {
          resolvedInputRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [resolvedInputRef]);

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={resolvedInputRef}
        aria-label={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        className="min-h-11 touch-manipulation sm:min-h-0 [&_[data-slot=input]]:pr-9 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
      />
      {value.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={clearLabel}
          onClick={() => onValueChange("")}
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
