import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn<() => Promise<void>>(),
  translated: [] as string[],
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  // Identity `t`: an untranslated string shows as its raw key, as i18next renders it.
  useTranslation: () => ({
    t: (key: string) => {
      mocks.translated.push(key);
      return key;
    },
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({
  areAllNamespacesLoaded: () => false,
  whenAllNamespacesLoaded: () => mocks.load(),
}));
vi.mock("@/hooks/queries/notification/use-get-notifications", () => ({
  default: () => ({ data: { pages: [{ data: [], unreadCount: 0 }] } }),
}));
vi.mock("@/hooks/mutations/notification/use-clear-notifications", () => ({
  default: () => ({ mutate: vi.fn() }),
}));
vi.mock(
  "@/hooks/mutations/notification/use-mark-all-notifications-as-read",
  () => ({ default: () => ({ mutate: vi.fn() }) }),
);
vi.mock("@/hooks/mutations/notification/use-mark-notification-as-read", () => ({
  default: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => {},
}));

import NotificationDropdown, {
  type NotificationDropdownRef,
} from "./notification-dropdown";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const notificationReads = () =>
  mocks.translated.filter((key) => key.startsWith("notifications:"));

beforeEach(() => {
  mocks.translated = [];
});
afterEach(() => {
  cleanup();
  mocks.load.mockReset();
});

describe("NotificationDropdown before the deferred strings land", () => {
  it("never reads its namespace on paint, holds the menu as a busy skeleton, then reveals it", async () => {
    const strings = deferred();
    mocks.load.mockReturnValue(strings.promise);
    const ref = createRef<NotificationDropdownRef>();
    render(<NotificationDropdown ref={ref} />);
    expect(notificationReads()).toEqual([]);

    await act(async () => ref.current?.toggle());
    const skeleton = await screen.findByTestId("notification-menu-loading");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(notificationReads()).toEqual([]);
    expect(screen.queryByText(/^notifications:/)).toBeNull();

    await act(async () => strings.resolve());
    // The skeleton keeps its minimum visible time, then the real menu takes over.
    await waitFor(
      () =>
        expect(screen.getByRole("group")).toHaveAccessibleName(
          "notifications:title",
        ),
      { timeout: 2000 },
    );
    expect(screen.queryByTestId("notification-menu-loading")).toBeNull();
    expect(screen.getByRole("menu")).not.toHaveAttribute("aria-busy");
  });

  it("keeps the failure and its retry inside the popup, closes them with it, and retries by keyboard", async () => {
    const failed = deferred();
    const retried = deferred();
    mocks.load
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(retried.promise);
    const ref = createRef<NotificationDropdownRef>();
    render(<NotificationDropdown ref={ref} />);
    await act(async () => ref.current?.toggle());
    await act(async () => failed.reject(new Error("offline")));

    const popup = await screen.findByTestId("notification-menu-error");
    expect(popup).toHaveAttribute("role", "menu");
    within(popup).getByRole("menuitem", {
      name: "common:actions.retry",
    });
    expect(within(popup).getByRole("group")).toHaveAccessibleName(
      "common:error.messages.unknown",
    );
    // No error panel outside the popup.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "common:actions.retry" }),
    ).toBeNull();

    await act(async () => ref.current?.toggle());
    await waitFor(() =>
      expect(screen.queryByTestId("notification-menu-error")).toBeNull(),
    );
    expect(screen.queryByText("common:actions.retry")).toBeNull();

    await act(async () => ref.current?.toggle());
    const reopened = await screen.findByRole("menuitem", {
      name: "common:actions.retry",
    });
    reopened.focus();
    fireEvent.keyDown(reopened, { key: "Enter" });
    await act(async () => retried.resolve());
    await waitFor(
      () =>
        expect(screen.getByRole("group")).toHaveAccessibleName(
          "notifications:title",
        ),
      { timeout: 2000 },
    );
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
});
