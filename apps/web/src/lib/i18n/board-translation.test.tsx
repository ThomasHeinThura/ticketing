import { act, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { installAgentTerminology } from "./agent-translation";
import { bindBoardTranslationEvents } from "./index";
import { BOARD_TRANSLATION_OPTIONS } from "./work-route-namespaces";

describe("board translation events", () => {
  it("ignores deferred namespaces but updates relevant translations, terminology and language", async () => {
    const instance = createInstance();
    await instance.init({
      lng: "en",
      fallbackLng: "en",
      defaultNS: "common",
      react: { bindI18nStore: "added" },
      resources: {
        en: { common: { label: "English" }, term: { noun: "Task" } },
        fr: { common: { label: "Français" }, term: { noun: "Tâche" } },
      },
    });
    bindBoardTranslationEvents(instance);
    let renders = 0;
    function Card() {
      renders += 1;
      const { t } = useTranslation(undefined, BOARD_TRANSLATION_OPTIONS);
      return (
        <div>
          {t("label")} {t("term:noun")}
        </div>
      );
    }
    render(
      <I18nextProvider i18n={instance}>
        <Card />
      </I18nextProvider>,
    );
    expect(screen.getByText("English Task")).toBeVisible();
    const initial = renders;
    act(() =>
      instance.addResourceBundle("en", "settings", { title: "Settings" }),
    );
    expect(renders).toBe(initial);
    act(() =>
      instance.addResourceBundle("en", "term", { noun: "Ticket" }, false, true),
    );
    expect(screen.getByText("English Ticket")).toBeVisible();
    act(() =>
      instance.addResourceBundle(
        "en",
        "common",
        { label: "Updated" },
        false,
        true,
      ),
    );
    expect(screen.getByText("Updated Ticket")).toBeVisible();
    await act(async () => {
      await instance.changeLanguage("fr");
    });
    expect(screen.getByText("Français Tâche")).toBeVisible();
  });

  it("refreshes agent terminology injected into card translations", async () => {
    const instance = createInstance();
    await instance.init({
      lng: "en",
      defaultNS: "common",
      resources: {
        en: {
          common: { label: "Open {{term_work_item_one}}" },
          term: { agent: { work_item_one: "task", work_item_other: "tasks" } },
        },
      },
    });
    bindBoardTranslationEvents(instance);
    installAgentTerminology(instance);
    function Card() {
      const { t } = useTranslation(undefined, BOARD_TRANSLATION_OPTIONS);
      return <div>{t("label")}</div>;
    }
    render(
      <I18nextProvider i18n={instance}>
        <Card />
      </I18nextProvider>,
    );
    expect(screen.getByText("Open task")).toBeVisible();
    act(() =>
      instance.addResourceBundle(
        "en",
        "term",
        { agent: { work_item_one: "ticket", work_item_other: "tickets" } },
        false,
        true,
      ),
    );
    expect(screen.getByText("Open ticket")).toBeVisible();
  });
});
