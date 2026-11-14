import en from "@i18n/en-US.json";
import { Button } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance } from "i18next";
import { useState } from "react";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemNamespaceBoundary from "./work-item-namespace-boundary";

const loader = vi.hoisted(() => vi.fn());
vi.mock("@/lib/i18n", () => ({
  whenAllNamespacesLoaded: loader,
  areAllNamespacesLoaded: () => false,
}));
let resolve: () => void;
let reject: (error: Error) => void;
beforeEach(() => {
  window.history.replaceState({}, "", "/agent/projects/TEST/work?item=TEST-1");
  loader.mockReset();
  loader.mockImplementation(
    () =>
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});
function DetailText() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(0);
  return (
    <span>
      <Button onClick={() => setDraft((value) => value + 1)}>
        Draft {draft}
      </Button>
      {t("workItemExtras:detail.projectLabel", { term_project_one: "Project" })}{" "}
      {t("workItems:detail.unassigned")}
    </span>
  );
}
async function mount() {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    lng: "en-US",
    fallbackLng: "en-US",
    resources: { "en-US": { common: en.common, workItems: en.workItems } },
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  render(
    <I18nextProvider i18n={instance}>
      <WorkItemNamespaceBoundary>
        <DetailText />
      </WorkItemNamespaceBoundary>
    </I18nextProvider>,
  );
  return instance;
}
describe("direct-link detail translations", () => {
  it("holds the pane until all text is ready and then shows human labels", async () => {
    const instance = await mount();
    expect(screen.getByTestId("work-item-detail-loading")).toHaveTextContent(
      en.workItems.detail.loading,
    );
    expect(screen.queryByText(/Project Unassigned/)).not.toBeInTheDocument();
    await act(async () => {
      instance.addResourceBundle("en-US", "workItemExtras", en.workItemExtras);
      resolve();
    });
    expect(screen.getByText(/Project Unassigned/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\w+:[\w.]+/);
  });
  it("shows a translated failure and retries without painting keys", async () => {
    const instance = await mount();
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.common.error.messages.unknown,
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.common.actions.retry }),
    );
    expect(screen.getByTestId("work-item-detail-loading")).toBeVisible();
    await act(async () => {
      instance.addResourceBundle("en-US", "workItemExtras", en.workItemExtras);
      resolve();
    });
    expect(screen.getByText(/Project Unassigned/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\w+:[\w.]+/);
  });
  it("holds detail again when the language changes", async () => {
    const instance = await mount();
    await act(async () => {
      instance.addResourceBundle("en-US", "workItemExtras", en.workItemExtras);
      resolve();
    });
    expect(screen.getByText(/Project Unassigned/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Draft 0" }));
    await act(async () => {
      await instance.changeLanguage("de-DE");
    });
    expect(screen.getByTestId("work-item-detail-loading")).toBeVisible();
    await act(async () => {
      instance.addResourceBundle("de-DE", "workItemExtras", en.workItemExtras);
      resolve();
    });
    expect(screen.getByText(/Project Unassigned/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Draft 1" })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\w+:[\w.]+/);
  });
});
