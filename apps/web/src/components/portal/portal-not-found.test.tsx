import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { PortalNotFoundPage } from "./portal-not-found";

afterEach(cleanup);

function renderPage(signedIn: boolean, path = "/private-looking-path") {
  const rootRoute = createRootRoute({
    component: () => <PortalNotFoundPage signedIn={signedIn} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("PortalNotFoundPage", () => {
  it("offers a signed-in customer the way back to the portal dashboard inside the layout", async () => {
    const { container } = renderPage(true);
    expect(
      await screen.findByRole("heading", { level: 1, name: "notFound.title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("notFound.description")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "notFound.backToDashboard" });
    expect(back).toHaveAttribute("href", "/");
    expect(
      screen.queryByRole("link", { name: "notFound.signIn" }),
    ).not.toBeInTheDocument();
    // The portal layout's inset is the page's one `main`.
    expect(container.querySelector("main")).toBeNull();
    expect(document.title).toContain("notFound.title");
  });

  it("offers a visitor without a session sign-in, in the portal's own frame", async () => {
    const { container } = renderPage(false);
    const signIn = await screen.findByRole("link", { name: "notFound.signIn" });
    expect(signIn.getAttribute("href")).toMatch(/^\/sign-in\?/u);
    expect(signIn.getAttribute("href")).not.toContain("redirect");
    expect(
      screen.queryByRole("link", { name: "notFound.backToDashboard" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("never echoes the requested address", async () => {
    const { container } = renderPage(true, "/requests-of-acme/secret-ref");
    await screen.findByTestId("portal-not-found");
    expect(container.textContent).not.toContain("acme");
    expect(container.textContent).not.toContain("secret-ref");
  });
});
