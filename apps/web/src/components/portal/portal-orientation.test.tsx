import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const dismiss = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-portal-orientation", () => ({
  usePortalOrientation: () => ({ visible: true, dismiss }),
}));
vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.PropsWithChildren<{ to: string }>
    >(({ children, to, ...props }, ref) => (
      <a href={to} ref={ref} {...props}>
        {children}
      </a>
    )),
  };
});
vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(key.includes(":") ? key : `${namespace}:${key}`, options),
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

import { PortalOrientation } from "./portal-orientation";

afterEach(() => cleanup());

describe("PortalOrientation", () => {
  it("leaves raising a request to the page's New Request button and keeps the dismiss (CP-7)", () => {
    render(<PortalOrientation portalUserId="customer-a" />);
    expect(screen.getByText("Welcome to your portal")).toBeVisible();
    expect(screen.queryByRole("link", { name: /^Raise a / })).toBeNull();
    expect(screen.getByRole("link", { name: /^See my / })).toHaveAttribute(
      "href",
      "/requests",
    );
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(dismiss).toHaveBeenCalled();
  });
});
