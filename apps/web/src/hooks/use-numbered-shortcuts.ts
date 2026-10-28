import { useEffect } from "react";

type NumberedShortcutOption = {
  onSelect: () => void;
  disabled?: boolean;
};

export function useNumberedShortcuts(
  isOpen: boolean,
  options: NumberedShortcutOption[],
  maxNumbers = 9,
) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.repeat ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey
      )
        return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;
      const isTypingInInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        !!target.closest('[contenteditable]:not([contenteditable="false"])');

      if (isTypingInInput) return;

      const num = Number.parseInt(e.key, 10);
      const isValidNumber =
        !Number.isNaN(num) &&
        num >= 1 &&
        num <= Math.min(options.length, maxNumbers);

      if (isValidNumber && !options[num - 1].disabled) {
        e.preventDefault();
        e.stopPropagation();
        options[num - 1].onSelect();
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [isOpen, options, maxNumbers]);
}
