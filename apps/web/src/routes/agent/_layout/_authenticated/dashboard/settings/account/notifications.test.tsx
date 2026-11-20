import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { expect, it, vi } from "vitest";
import { Route } from "./notifications";

const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "staff" }, session: { id: "session" } },
    }),
  },
}));
vi.mock("@/components/settings/personal-notification-history", () => ({
  PersonalNotificationHistory: (props: unknown) => {
    mocks.history(props);
    return null;
  },
}));
vi.mock("@/components/account/canonical-mention-preference", () => ({
  CanonicalMentionPreference: () => null,
}));
vi.mock("@/components/account/notification-preferences-settings", () => ({
  NotificationPreferencesSettings: () => null,
}));
vi.mock("@/components/account/quiet-hours-preference", () => ({
  QuietHoursPreference: () => null,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
it("mounts staff history for the current session", () => {
  const Page = (Route as unknown as { component: ComponentType }).component;
  render(<Page />);
  expect(mocks.history).toHaveBeenCalledWith({
    audience: "staff",
    userId: "staff",
    sessionId: "session",
  });
});
