import { render, screen } from "@testing-library/react";
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
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: (props: unknown) => {
    mocks.history(props);
    return <p>Notification history</p>;
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
it("mounts staff notification history by target only", async () => {
  const Page = (Route as unknown as { component: ComponentType }).component;
  render(<Page />);
  await screen.findByText("Notification history");
  expect(mocks.history).toHaveBeenCalledWith({
    target: { kind: "self", audience: "staff", section: "notifications" },
  });
});
