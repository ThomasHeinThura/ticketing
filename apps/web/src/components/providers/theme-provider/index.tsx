import { useEffect, useState } from "react";
import { useUserPreferencesStore } from "@/store/user-preferences";

const PREFERENCES_STORAGE_KEY = "user-preferences";

/** True when a theme choice was explicitly persisted by the user. */
function hasStoredThemePreference(): boolean {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as { state?: { theme?: unknown } };
    const theme = stored.state?.theme;
    return theme === "light" || theme === "dark" || theme === "system";
  } catch {
    return false;
  }
}

type ThemeProviderProps = {
  children: React.ReactNode;
  /**
   * When true, a visitor with no stored theme preference follows the OS
   * light/dark setting instead of the store's default theme. A stored
   * preference (set from the agent app) still wins. Used by the portal.
   */
  followSystemWhenUnset?: boolean;
};

export function ThemeProvider({
  children,
  followSystemWhenUnset = false,
}: ThemeProviderProps) {
  const { theme: storedTheme } = useUserPreferencesStore();
  const [unset] = useState(
    () => followSystemWhenUnset && !hasStoredThemePreference(),
  );
  const theme = unset ? "system" : storedTheme;

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    root.classList.remove("light", "dark");

    if (theme === "system") {
      root.classList.add(mediaQuery?.matches ? "dark" : "light");
    } else {
      root.classList.add(theme);
    }

    if (!mediaQuery) return;
    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === "system") {
        root.classList.remove("light", "dark");
        root.classList.add(e.matches ? "dark" : "light");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  return <>{children}</>;
}
