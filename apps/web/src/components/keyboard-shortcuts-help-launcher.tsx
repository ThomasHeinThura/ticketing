import { lazy, Suspense, useEffect, useState } from "react";

const KeyboardShortcutsHelp = lazy(async () => {
  const module = await import("./keyboard-shortcuts-help");
  return { default: module.KeyboardShortcutsHelp };
});

/** Keep the global help key available without loading its dialog on app startup. */
export default function KeyboardShortcutsHelpLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";

      if (event.key === "?" && !isTyping) {
        event.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <KeyboardShortcutsHelp open={open} onOpenChange={setOpen} />
    </Suspense>
  );
}
