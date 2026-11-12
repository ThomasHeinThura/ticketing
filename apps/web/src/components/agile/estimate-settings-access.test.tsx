import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/agile", async (original) => ({
  ...(await original<typeof import("@/fetchers/agile")>()),
  getEstimates: async () => ({
    system: "points",
    points: [
      { key: "one", value: "1" },
      { key: "three", value: "3" },
    ],
    defaults: { points: ["1", "3"], categories: [], time: [] },
    incompletePolicy: "leave",
    canManage: false,
  }),
}));

import { EstimateSettings } from "./estimate-settings";

afterEach(cleanup);
it.each(["viewer", "member", "lead"])(
  "shows estimates without mutation controls to a %s without management",
  async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EstimateSettings projectKey="HELP" canManage={false} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("1, 3")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  },
);
