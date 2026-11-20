import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryTarget } from "@/query-client/settings-history-key";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({ target }: { target: HistoryTarget }) => (
    <span data-testid="history">{JSON.stringify(target)}</span>
  ),
}));

import { EntityHistoryButton } from "./entity-history-button";

afterEach(cleanup);

const target: HistoryTarget = {
  kind: "entity",
  type: "budget",
  id: "b1",
  scope: { kind: "project", workspaceId: "w1", projectId: "p1" },
};

describe("EntityHistoryButton", () => {
  it("loads nothing until opened, then shows that entity's History", async () => {
    render(<EntityHistoryButton target={target} name="Q4" />);
    expect(screen.queryByTestId("history")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: 'settings:history.entityLabel {"name":"Q4"}',
      }),
    );
    expect((await screen.findByTestId("history")).textContent).toBe(
      JSON.stringify(target),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
