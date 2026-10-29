import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Freeze } from "@/fetchers/service-management";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key.includes(":") ? key : `${namespace}:${key}`, options),
  }),
}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@/hooks/queries/service-management", () => ({
  useInvalidateServiceManagement: () => vi.fn(),
}));
vi.mock("@/fetchers/service-management", () => ({
  createFreeze: (...args: unknown[]) => mocks.create(...args),
  updateFreeze: (...args: unknown[]) => mocks.update(...args),
}));

import { FreezeDialog } from "./freeze-dialog";

const freeze: Freeze = {
  id: "freeze-one",
  workspaceId: "workspace-one",
  name: "Maintenance",
  reason: null,
  startsAt: "2026-10-31T03:15:00.000Z",
  endsAt: "2026-10-31T13:15:00.000Z",
  cancelledAt: null,
  version: 7,
};

function setup(value: Freeze | undefined = freeze) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FreezeDialog
        workspaceId="workspace-one"
        freeze={value}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onClose };
}

async function chooseTime(name: "Hour" | "Minute", value: string) {
  const trigger = screen.getByRole("combobox", { name });
  trigger.focus();
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute("role", "option"),
  );
  const option = screen.getByRole("option", { name: value });
  fireEvent.pointerDown(option, {
    pointerType: "mouse",
    button: 0,
    buttons: 1,
  });
  fireEvent.mouseDown(option, { button: 0, buttons: 1 });
  option.focus();
  fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(option, { button: 0 });
  fireEvent.click(option, { button: 0, detail: 1 });
}

beforeEach(() => {
  vi.stubEnv("TZ", "Asia/Yangon");
  mocks.create.mockResolvedValue({ freeze, affectedChanges: 0 });
  mocks.update.mockResolvedValue({ freeze, affectedChanges: 0 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("freeze calendar controls", () => {
  it("converts the selected local time to the existing versioned request only on form save", async () => {
    setup();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Starts" }));
    await chooseTime("Hour", "18");
    await chooseTime("Minute", "42");
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Starts" })).getByRole(
        "button",
        { name: "Save" },
      ),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith("freeze-one", {
        name: "Maintenance",
        reason: null,
        startsAt: "2026-10-31T12:12:00.000Z",
        endsAt: "2026-10-31T13:15:00.000Z",
        version: 7,
      }),
    );
  });

  it("clears a required bound without allowing an incomplete range to submit", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Starts" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    expect(screen.getByRole("button", { name: "Starts" })).toHaveTextContent(
      "Not set",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const form = screen.getByRole("button", { name: "Save" }).closest("form");
    if (!form) throw new Error("Freeze save button must belong to its form");
    fireEvent.submit(form);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps the ordering error and blocks a reversed range", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Ends" }));
    await chooseTime("Hour", "08");
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Ends" })).getByRole("button", {
        name: "Save",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The freeze must end after it starts.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("cancels a picker draft with Escape, restores focus, and leaves the outer dialog open", async () => {
    const { onClose } = setup();
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    const trigger = screen.getByRole("button", { name: "Starts" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Go to the Previous Month" }),
      ).toHaveFocus(),
    );
    await chooseTime("Minute", "42");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    const minute = await screen.findByRole("combobox", { name: "Minute" });
    await waitFor(() => expect(minute).toHaveFocus());
    fireEvent.keyDown(minute, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(screen.getByRole("combobox", { name: "Minute" })).toHaveTextContent(
      "45",
    );
  });
});
