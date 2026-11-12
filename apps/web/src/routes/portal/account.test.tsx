import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./account";

const mocks = vi.hoisted(() => ({ change: vi.fn(), success: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useRouteContext: () => ({ portalUserId: "customer" }),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/account/portal-canonical-preferences", () => ({
  PortalCanonicalPreferencesPage: () => null,
}));
vi.mock("@/components/portal/portal-page-title", () => ({
  PortalPageTitle: () => null,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: { $fetch: mocks.change },
}));
const Account = (Route as unknown as { component: ComponentType }).component;

function status(hasLocalPassword: boolean) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ hasLocalPassword }), { status: 200 }),
      ),
  );
}
function fillAndSubmit() {
  fireEvent.change(
    screen.getByLabelText("auth:changePassword.currentPassword"),
    { target: { value: "current-password" } },
  );
  fireEvent.change(screen.getByLabelText("auth:changePassword.newPassword"), {
    target: { value: "new-password" },
  });
  fireEvent.change(
    screen.getByLabelText("auth:changePassword.confirmPassword"),
    { target: { value: "new-password" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "auth:changePassword.submit" }),
  );
}
beforeEach(() => {
  mocks.change.mockReset();
  mocks.success.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("portal account password section", () => {
  it("hides for SSO-only accounts", async () => {
    status(false);
    render(<Account />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "auth:changePassword.submit" }),
    ).toBeNull();
  });
  it("sends the current user's change to portal auth and reports wrong passwords", async () => {
    status(true);
    mocks.change.mockResolvedValueOnce({ error: { code: "INVALID_PASSWORD" } });
    render(<Account />);
    await screen.findByRole("button", { name: "auth:changePassword.submit" });
    fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "auth:changePassword.wrongCurrent",
    );
    expect(mocks.change).toHaveBeenCalledWith("/change-password", {
      method: "POST",
      body: {
        currentPassword: "current-password",
        newPassword: "new-password",
        revokeOtherSessions: true,
      },
    });
  });
  it("clears the fields and shows a toast after success", async () => {
    status(true);
    mocks.change.mockResolvedValueOnce({ data: {}, error: null });
    render(<Account />);
    await screen.findByRole("button", { name: "auth:changePassword.submit" });
    fillAndSubmit();
    await waitFor(() =>
      expect(
        screen.getByLabelText("auth:changePassword.currentPassword"),
      ).toHaveValue(""),
    );
    expect(mocks.success).toHaveBeenCalled();
  });
});
