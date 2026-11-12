import { SidebarProvider, useSidebar } from "@taskdesk/ui";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const location = vi.hoisted(() => ({ pathname: "/agent/inbox" }));
vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (l: typeof location) => string }) =>
    select(location),
}));

import { CloseSidebarSheetOnNavigate } from "./close-sidebar-sheet-on-navigate";

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
  location.pathname = "/agent/inbox";
});

let openSheet: () => void = () => {};
function SheetState() {
  const { openMobile, setOpenMobile } = useSidebar();
  openSheet = () => setOpenMobile(true);
  return <span data-testid="sheet">{openMobile ? "open" : "closed"}</span>;
}

function Shell() {
  return (
    <SidebarProvider>
      <CloseSidebarSheetOnNavigate />
      <SheetState />
    </SidebarProvider>
  );
}

// UX-10: choosing a page in the sheet sidebar left the sheet open over the new page.
describe("CloseSidebarSheetOnNavigate", () => {
  it("closes the sheet sidebar when the page changes", () => {
    const { rerender } = render(<Shell />);
    act(() => openSheet());
    expect(screen.getByTestId("sheet")).toHaveTextContent("open");

    location.pathname = "/agent/service-management/services";
    rerender(<Shell />);

    expect(screen.getByTestId("sheet")).toHaveTextContent("closed");
  });

  it("leaves an open sheet alone while the page stays the same", () => {
    const { rerender } = render(<Shell />);
    act(() => openSheet());
    rerender(<Shell />);
    expect(screen.getByTestId("sheet")).toHaveTextContent("open");
  });
});
