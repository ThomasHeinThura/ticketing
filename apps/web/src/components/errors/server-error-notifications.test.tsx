vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  add: vi.fn((_arg: unknown) => "toast-id"),
  close: vi.fn(),
}));
vi.mock("@taskdesk/ui", () => ({ toastManager: toast }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, args?: { id?: string }) =>
      key === "common:error.serverReferenceToast"
        ? `Something went wrong on the server. Reference ${args?.id}`
        : "Copy reference",
  }),
}));

import { ServerErrorNotifications } from "./server-error-notifications";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("server error notifications", () => {
  it("deduplicates references, replaces the prior toast, and copies the id", () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    render(<ServerErrorNotifications />);
    const first = "a".repeat(32);
    const second = "b".repeat(32);
    const emit = (reference: string, status = 500) =>
      window.dispatchEvent(
        new CustomEvent("taskdesk:server-error", {
          detail: { reference, status },
        }),
      );
    act(() => {
      emit(first);
      emit(first);
    });
    expect(toast.add).toHaveBeenCalledTimes(1);
    const initial = toast.add.mock.calls[0]?.[0] as {
      title: string;
      priority: string;
      actionProps: { children: string; onClick: () => void };
    };
    expect(initial.title).toBe(
      `Something went wrong on the server. Reference ${first}`,
    );
    expect(initial.priority).toBe("low");
    expect(initial.actionProps.children).toBe("Copy reference");
    initial.actionProps.onClick();
    expect(copy).toHaveBeenCalledWith(first);
    act(() => {
      emit(second);
      emit("invalid");
      window.dispatchEvent(
        new CustomEvent("taskdesk:server-error", {
          detail: { reference: null, status: 503 },
        }),
      );
      emit("c".repeat(32), 403);
    });
    expect(toast.close).toHaveBeenCalledWith("toast-id");
    expect(toast.add).toHaveBeenCalledTimes(2);
  });
});
