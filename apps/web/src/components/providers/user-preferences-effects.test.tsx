import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { UserPreferencesEffects } from "./user-preferences-effects";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("UserPreferencesEffects (#673)", () => {
  beforeEach(() => {
    useUserPreferencesStore.setState({ compactMode: false });
    document.documentElement.classList.remove("compact-mode");
  });
  afterEach(() => {
    cleanup();
    useUserPreferencesStore.setState({ compactMode: false });
  });

  it("applies html.compact-mode from a persisted preference without any dashboard layout mounted", () => {
    useUserPreferencesStore.setState({ compactMode: true });
    render(<UserPreferencesEffects />);
    expect(document.documentElement).toHaveClass("compact-mode");
  });

  it("toggles html.compact-mode when setCompactMode is called", () => {
    render(<UserPreferencesEffects />);
    expect(document.documentElement).not.toHaveClass("compact-mode");
    act(() => useUserPreferencesStore.getState().setCompactMode(true));
    expect(document.documentElement).toHaveClass("compact-mode");
    act(() => useUserPreferencesStore.getState().setCompactMode(false));
    expect(document.documentElement).not.toHaveClass("compact-mode");
  });

  it("is mounted at the agent app root, not only in the dashboard layout", () => {
    const main = readFileSync(resolve(srcDir, "main.tsx"), "utf8");
    expect(main).toContain("<UserPreferencesEffects />");
    // A second mount in the dashboard layout would double-apply and its
    // cleanup would strip the class on unmount of that layout.
    const layout = readFileSync(
      resolve(srcDir, "components/common/layout.tsx"),
      "utf8",
    );
    expect(layout).not.toContain("useUserPreferencesEffects");
  });
});
