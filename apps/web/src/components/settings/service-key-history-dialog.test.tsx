import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ServiceKeyHistoryDialog from "./service-key-history-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./settings-history", () => ({
  SettingsHistory: () => <div>History content</div>,
}));

it("places History in the shared scrolling dialog panel", () => {
  render(
    <ServiceKeyHistoryDialog
      name="key"
      onClose={() => {}}
      target={{
        kind: "entity",
        type: "service_api_key",
        id: "k1",
        scope: { kind: "workspace", workspaceId: "w1" },
      }}
    />,
  );
  expect(
    screen.getByText("History content").closest('[data-slot="dialog-panel"]'),
  ).not.toBeNull();
});
