import { Button, Input } from "@taskdesk/ui";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

interface ProjectTaskSearchInputProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Off when a parent owns Cmd/Ctrl+F, as the collapsible header search does. */
  registerShortcut?: boolean;
}

export default function ProjectTaskSearchInput({
  value,
  onValueChange,
  placeholder,
  clearLabel,
  inputRef,
  registerShortcut = true,
}: ProjectTaskSearchInputProps) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      internalInputRef.current = node;
      if (typeof inputRef === "function") inputRef(node);
      else if (inputRef) inputRef.current = node;
    },
    [inputRef],
  );

  useEffect(() => {
    if (!registerShortcut) return;
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        internalInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [registerShortcut]);

  return (
    <div className="relative w-full max-w-sm">
      {/* z-10: the Input's positioned frame paints an opaque light-theme background over an
          earlier absolute sibling, which hid this icon in light mode. */}
      <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={setInputRef}
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
          onClick={() => {
            internalInputRef.current?.focus();
            onValueChange("");
          }}
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
