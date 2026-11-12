import { useSidebar } from "@taskdesk/ui";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sidebar module mounts only after primary content; keep it pending so these tests read
// the shell itself.
vi.mock("@/lib/after-primary-content", () => ({
  afterPrimaryContent: () => new Promise(() => {}),
}));
vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (l: { pathname: string }) => string }) =>
    select({ pathname: "/agent/inbox" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import Layout from "./layout";

function SidebarMode() {
  const { isMobile } = useSidebar();
  return <span data-testid="mode">{isMobile ? "sheet" : "docked"}</span>;
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

const originalWidth = window.innerWidth;

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  vi.stubGlobal("cookieStore", { set: vi.fn().mockResolvedValue(undefined) });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setWidth(originalWidth);
});

// UX-10: at a 768 px tablet the docked sidebar squeezed pages to about 520 px.
describe("Layout sidebar mode", () => {
  it("uses the sheet sidebar below lg (1024 px)", () => {
    setWidth(1023);
    render(
      <Layout>
        <SidebarMode />
      </Layout>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("sheet");
  });

  it("keeps the docked sidebar from lg up", () => {
    setWidth(1024);
    render(
      <Layout>
        <SidebarMode />
      </Layout>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("docked");
  });

  it("reserves the docked sidebar's width only from lg up, so nothing shifts on a tablet", () => {
    setWidth(1024);
    const { container } = render(
      <Layout>
        <SidebarMode />
      </Layout>,
    );
    const placeholder = container.querySelector(
      '[aria-hidden="true"][data-variant="inset"]',
    );
    expect(placeholder).toHaveClass("hidden", "lg:block");
    expect(placeholder).not.toHaveClass("md:block");
  });

  it("reserves no docked width below lg, where the sidebar is the sheet", () => {
    setWidth(768);
    const { container } = render(
      <Layout>
        <SidebarMode />
      </Layout>,
    );
    // A hidden placeholder still marks the inset as beside a docked sidebar (no left margin).
    expect(
      container.querySelector('[aria-hidden="true"][data-variant="inset"]'),
    ).toBeNull();
  });

  it("drops the inset card's margin, radius and border on phones", () => {
    render(
      <Layout>
        <SidebarMode />
      </Layout>,
    );
    expect(screen.getByRole("main")).toHaveClass(
      "m-2",
      "max-md:m-0",
      "max-md:rounded-none",
      "max-md:border-0",
      "max-md:shadow-none",
    );
  });
});
