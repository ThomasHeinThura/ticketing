import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { KeyboardShortcutsHelp } from "./keyboard-shortcuts-help";

const mocks = vi.hoisted(() => ({ canCreate: false }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
  Trans: () => null,
}));
vi.mock("@/hooks/use-can-create-workspace", () => ({
  default: () => mocks.canCreate,
}));

afterEach(() => {
  cleanup();
  mocks.canCreate = false;
});

describe("KeyboardShortcutsHelp create-workspace row (D-A, 12 Nov 2026)", () => {
  it("lists the create-workspace shortcut only for someone who may create workspaces", () => {
    mocks.canCreate = true;
    render(<KeyboardShortcutsHelp open onOpenChange={vi.fn()} />);

    expect(screen.getByText("Create workspace")).toBeInTheDocument();
  });

  it("hides the create-workspace shortcut from everyone else, and keeps the other create shortcuts", () => {
    render(<KeyboardShortcutsHelp open onOpenChange={vi.fn()} />);

    expect(screen.queryByText("Create workspace")).toBeNull();
    expect(screen.getByText(/^Create project$/i)).toBeInTheDocument();
  });
});
