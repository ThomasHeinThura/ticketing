import { afterEach, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "./user-preferences";

afterEach(() => {
  Reflect.deleteProperty(document, "startViewTransition");
  vi.unstubAllGlobals();
});

it.each([true, false])(
  "honours reduced motion %s for theme transitions",
  (reduced) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: reduced })),
    );
    const transition = vi.fn((change: () => void) => change());
    vi.stubGlobal(
      "document",
      Object.assign(document, { startViewTransition: transition }),
    );
    useUserPreferencesStore.getState().setTheme("light");
    expect(useUserPreferencesStore.getState().theme).toBe("light");
    expect(transition).toHaveBeenCalledTimes(reduced ? 0 : 1);
  },
);
