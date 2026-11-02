import { Label, Switch } from "@taskdesk/ui";
import { MoonIcon, SunIcon } from "lucide-react";
import { useId, useSyncExternalStore } from "react";
import { useUserPreferencesStore } from "@/store/user-preferences";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia?.(DARK_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function systemPrefersDark() {
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

export function ThemeToggleDropdown({
  label = "Toggle theme",
}: {
  /** Accessible name of the switch; callers pass their own translated text. */
  label?: string;
}) {
  const { theme, setTheme } = useUserPreferencesStore();
  const prefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    systemPrefersDark,
    () => false,
  );
  const id = useId();
  // "system" shows whichever theme the OS currently resolves to.
  const checked = theme === "system" ? !prefersDark : theme === "light";

  const handleThemeChange = (nextChecked: boolean) => {
    setTheme(nextChecked ? "light" : "dark");
  };

  return (
    <div>
      <div className="relative inline-grid h-7 grid-cols-[1fr_1fr] items-center font-medium text-sm">
        <Switch
          checked={checked}
          className="peer absolute inset-0 h-[inherit] w-auto rounded-full bg-input/50 data-checked:bg-input/50 data-unchecked:bg-input/50 [&_[data-slot=switch-thumb]]:h-full [&_[data-slot=switch-thumb]]:w-1/2 [&_[data-slot=switch-thumb]]:rounded-full [&_[data-slot=switch-thumb]]:transition-transform [&_[data-slot=switch-thumb]]:duration-300 [&_[data-slot=switch-thumb]]:ease-out [&_[data-slot=switch-thumb]]:data-checked:translate-x-full [&_[data-slot=switch-thumb]]:rtl:data-checked:-translate-x-full"
          id={id}
          onCheckedChange={handleThemeChange}
        />
        <span className="pointer-events-none relative ms-0.5 flex min-w-7 items-center justify-center text-center peer-data-[state=checked]:text-muted-foreground">
          <MoonIcon aria-hidden="true" size={13} />
        </span>
        <span className="pointer-events-none relative me-0.5 flex min-w-7 items-center justify-center text-center peer-data-[state=unchecked]:text-muted-foreground">
          <SunIcon aria-hidden="true" size={13} />
        </span>
      </div>
      <Label className="sr-only" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}
