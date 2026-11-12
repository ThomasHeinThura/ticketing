import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mockFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch: mockFetch }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, args?: { id?: string }) =>
      key === "common:error.reference" ? `Reference: ${args?.id}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { ReportError } from "@/components/reports/report-detail";
import { getReportCatalogue } from "./index";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps a server reference from a real report failure in the report alert", async () => {
  const id = "a".repeat(32);
  mockFetch.mockResolvedValue(
    Response.json(
      { message: "Internal Server Error", requestId: id },
      { status: 500 },
    ),
  );
  const error = await getReportCatalogue("workspace").catch(
    (caught: unknown) => caught,
  );
  render(<ReportError error={error} />);
  expect(screen.getByText(`Reference: ${id}`)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "common:error.copyReference" }),
  ).toBeTruthy();
});

it("retains the 409 and 422 report error classes", async () => {
  const { ReportsDisabledError, ReportRuleError } = await import("./index");
  mockFetch
    .mockResolvedValueOnce(
      Response.json({ message: "feature_disabled" }, { status: 409 }),
    )
    .mockResolvedValueOnce(
      Response.json({ message: "invalid_window" }, { status: 422 }),
    );
  expect(
    await getReportCatalogue("workspace").catch((error: unknown) => error),
  ).toBeInstanceOf(ReportsDisabledError);
  expect(
    await getReportCatalogue("workspace").catch((error: unknown) => error),
  ).toBeInstanceOf(ReportRuleError);
});
