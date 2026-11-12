import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { PortalKpiCard } from "./portal-kpi-card";

vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }
    >(({ children, to, ...props }, ref) => (
      <a href={to} ref={ref} {...props}>
        {children}
      </a>
    )),
  };
});

describe("PortalKpiCard", () => {
  it("reads as one link naming the figure and its value", () => {
    render(
      <PortalKpiCard
        label="Outstanding"
        value={12}
        hint="3 need your reply"
        icon={Inbox}
        tone="warning"
        to="/requests"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/requests");
    expect(link).toHaveAttribute("data-interactive", "");
    expect(link).toHaveClass("press-feedback", "[--press-scale:0.98]");
    expect(link).not.toHaveClass("transition-colors");
    expect(link).toHaveTextContent("Outstanding123 need your reply");
  });

  it("renders a static tile without a link or press feedback", () => {
    const { container } = render(
      <PortalKpiCard label="Closed (30 days)" value={4} icon={Inbox} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("4")).toBeInTheDocument();
    const card = container.querySelector('[data-slot="portal-kpi-card"]');
    expect(card).not.toHaveClass("press-feedback");
    expect(card).not.toHaveAttribute("data-interactive");
  });
});
