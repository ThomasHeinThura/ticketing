import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalSlaStatus } from "./portal-sla-status";

vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(`${namespace}:${key}`, options),
      i18n: {
        language: "en-US",
        resolvedLanguage: "en-US",
        t: (_key: string, options?: { count?: number }) =>
          translate(
            `term:customer.request_${options?.count === 1 ? "one" : "other"}`,
          ),
      },
    }),
  };
});

afterEach(() => cleanup());
const now = new Date(2026, 9, 23, 9, 0);

describe("PortalSlaStatus (CP-6)", () => {
  it("says what is due and when, in plain words", () => {
    render(
      <PortalSlaStatus
        now={now}
        sla={{
          state: "on_track",
          dueAt: new Date(2026, 9, 23, 14, 0).toISOString(),
        }}
      />,
    );
    expect(screen.getByText("On track")).toBeVisible();
    expect(screen.getByText("Resolution due by 2:00 PM today")).toBeVisible();
  });

  it("names a missed target without a due time and renders nothing without a target", () => {
    const { container, rerender } = render(
      <PortalSlaStatus
        now={now}
        sla={{ state: "missed", dueAt: "2026-10-22T10:00:00Z" }}
      />,
    );
    expect(screen.getByText("Target missed")).toBeVisible();
    expect(screen.queryByText(/Response/u)).not.toBeInTheDocument();
    rerender(<PortalSlaStatus now={now} sla={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the first-response target when the metric says so", () => {
    render(
      <PortalSlaStatus
        now={now}
        sla={{
          state: "on_track",
          metric: "first_response",
          dueAt: new Date(2026, 9, 23, 14, 0).toISOString(),
        }}
      />,
    );
    expect(
      screen.getByText("First response due by 2:00 PM today"),
    ).toBeVisible();
  });

  it("says a breached target was due", () => {
    render(
      <PortalSlaStatus
        now={now}
        sla={{
          state: "breached",
          dueAt: new Date(2026, 9, 23, 8, 0).toISOString(),
        }}
      />,
    );
    expect(screen.getByText("Overdue")).toBeVisible();
    expect(
      screen.getByText("Resolution was due by 8:00 AM today"),
    ).toBeVisible();
  });
});
