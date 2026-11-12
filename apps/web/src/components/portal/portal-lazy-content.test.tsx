import en from "@i18n/en-US.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";
import { portalLazyContent } from "./portal-lazy-content";

afterEach(cleanup);
it.each(["sidebar", "topbar", "announcements", "feature-off"])(
  "keeps the frame while %s loads or fails and retries in place",
  async (name) => {
    const instance = createInstance();
    await instance.init({
      lng: "en-US",
      resources: { "en-US": en },
      defaultNS: "common",
    });
    let reject!: (error: Error) => void;
    let offline = true;
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, no) => {
            reject = no;
          }),
      )
      .mockImplementation(() =>
        offline
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ default: () => <p>{name} loaded</p> }),
      );
    const Content = portalLazyContent(load, <p>Loading {name}</p>);
    render(
      <I18nextProvider i18n={instance}>
        <div>
          Portal frame
          <Content />
        </div>
      </I18nextProvider>,
    );
    expect(screen.getByText(`Loading ${name}`)).toBeVisible();
    reject(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.common.error.messages.unknown,
    );
    expect(screen.getByText("Portal frame")).toBeVisible();
    offline = false;
    fireEvent.click(
      screen.getByRole("button", { name: en.common.actions.retry }),
    );
    expect(await screen.findByText(`${name} loaded`)).toBeVisible();
    expect(load.mock.calls.length).toBeGreaterThan(1);
  },
);

it("reloads only on Retry after a stylesheet preload failure", async () => {
  const originalLocation = window.location;
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
  try {
    const instance = createInstance();
    await instance.init({
      lng: "en-US",
      resources: { "en-US": en },
      defaultNS: "common",
    });
    const load = vi.fn().mockRejectedValue(new Error("Unable to preload CSS"));
    const Content = portalLazyContent(load, <p>Loading</p>);
    render(
      <I18nextProvider i18n={instance}>
        <Content />
      </I18nextProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.common.error.messages.chunkLoad,
    );
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: en.common.actions.retry }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  }
});
