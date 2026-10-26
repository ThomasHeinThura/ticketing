import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

import { ApiKeyCreatedModal } from "./api-key-created-modal";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.write },
  });
});
afterEach(cleanup);

function openModal() {
  render(
    <ApiKeyCreatedModal
      apiKey="test-only-display-value"
      keyName="Test fixture"
      open
      onClose={vi.fn()}
    />,
  );
}

it("confirms copying only after the clipboard write succeeds", async () => {
  let complete: (() => void) | undefined;
  mocks.write.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  openModal();
  fireEvent.click(
    screen.getByRole("button", { name: "settings:apiKey.createdModal.copy" }),
  );
  expect(mocks.success).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", {
      name: "settings:apiKey.createdModal.copyToContinue",
    }),
  ).toBeDisabled();
  complete?.();
  await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  expect(
    screen.getByRole("button", { name: "settings:apiKey.createdModal.done" }),
  ).toBeEnabled();
});

it("handles denied clipboard access without claiming the key was copied", async () => {
  mocks.write.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  openModal();
  fireEvent.click(
    screen.getByRole("button", { name: "settings:apiKey.createdModal.copy" }),
  );
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(
      "settings:apiKey.createdModal.clipboardFailed",
    ),
  );
  expect(mocks.success).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", {
      name: "settings:apiKey.createdModal.copyToContinue",
    }),
  ).toBeDisabled();
  expect(screen.getByText("test-only-display-value")).toBeVisible();
});
