import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { Suspense } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installAgentTerminology,
  useAgentTranslation,
} from "./agent-translation";
import {
  BATCHED_RESOURCES_CHANGED,
  installBatchedResourceUpdates,
} from "./batched-resource-updates";

afterEach(cleanup);

async function instance() {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: "en",
    fallbackLng: false,
    ns: ["common"],
    defaultNS: "common",
    resources: { en: { common: { value: "initial" } } },
    react: {
      bindI18n: `languageChanged ${BATCHED_RESOURCES_CHANGED}`,
      bindI18nStore: "",
    },
  });
  installBatchedResourceUpdates(i18n);
  return i18n;
}

describe("batched resource updates", () => {
  it("retains synchronous added events and emits once for a burst", async () => {
    const i18n = await instance();
    const added = vi.fn();
    const batched = vi.fn();
    i18n.store.on("added", added);
    i18n.on(BATCHED_RESOURCES_CHANGED, batched);
    for (let i = 0; i < 50; i++)
      i18n.addResourceBundle("en", `ns${i}`, { label: `${i}` });
    expect(added).toHaveBeenCalledTimes(50);
    expect(batched).not.toHaveBeenCalled();
    await waitFor(() => expect(batched).toHaveBeenCalledTimes(1));
  });

  it("updates mounted cross-namespace labels and overwritten resources", async () => {
    const i18n = await instance();
    function View() {
      const { t } = useTranslation("common");
      return (
        <p>
          {t("other:label")} / {t("terms:label")} / {t("value")}
        </p>
      );
    }
    render(
      <I18nextProvider i18n={i18n}>
        <View />
      </I18nextProvider>,
    );
    await act(async () => {
      i18n.addResourceBundle("en", "other", { label: "other" });
      i18n.addResourceBundle("en", "terms", { label: "term" });
      i18n.addResourceBundle("en", "common", { value: "updated" }, true, true);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText("other / term / updated")).toBeInTheDocument(),
    );
  });

  it("isolates instances, installs once and schedules reentrant additions", async () => {
    const a = await instance();
    const b = await instance();
    installBatchedResourceUpdates(a);
    const notifyB = vi.fn();
    b.on(BATCHED_RESOURCES_CHANGED, notifyB);
    const notifyA = vi.fn(() => {
      if (notifyA.mock.calls.length === 1)
        a.addResourceBundle("en", "nested", { value: "x" });
    });
    a.on(BATCHED_RESOURCES_CHANGED, notifyA);
    a.addResourceBundle("en", "first", { value: "x" });
    await waitFor(() => expect(notifyA).toHaveBeenCalledTimes(2));
    expect(notifyB).not.toHaveBeenCalled();
  });

  it("refreshes actual terminology cache and interpolated agent labels", async () => {
    const i18n = await instance();
    i18n.addResourceBundle("en", "agent", {
      label: "Open {{term_work_item_one}}",
    });
    i18n.addResourceBundle("en", "term", {
      agent: { work_item_one: "Ticket", work_item_other: "Tickets" },
    });
    installAgentTerminology(i18n);
    function View() {
      const { t } = useAgentTranslation("agent");
      return <p>{t("label")}</p>;
    }
    render(
      <I18nextProvider i18n={i18n}>
        <View />
      </I18nextProvider>,
    );
    expect(screen.getByText("Open Ticket")).toBeInTheDocument();
    await act(async () => {
      i18n.addResourceBundle(
        "en",
        "term",
        { agent: { work_item_one: "Request" } },
        true,
        true,
      );
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText("Open Request")).toBeInTheDocument(),
    );
  });

  it("delivers language changes immediately and updates mounted UI", async () => {
    const i18n = await instance();
    i18n.addResourceBundle("fr", "common", { value: "bonjour" });
    const changed = vi.fn();
    i18n.on("languageChanged", changed);
    function View() {
      const { t } = useTranslation("common");
      return <p>{t("value")}</p>;
    }
    render(
      <I18nextProvider i18n={i18n}>
        <View />
      </I18nextProvider>,
    );
    await act(async () => {
      const promise = i18n.changeLanguage("fr");
      expect(changed).toHaveBeenCalledWith("fr");
      await promise;
    });
    expect(screen.getByText("bonjour")).toBeInTheDocument();
  });

  it("does not notify a replacement provider from an old instance pending burst", async () => {
    const a = await instance();
    const b = await instance();
    const setupNotice = vi.fn();
    b.on(BATCHED_RESOURCES_CHANGED, setupNotice);
    b.addResourceBundle("en", "common", { value: "replacement" }, true, true);
    await waitFor(() => expect(setupNotice).toHaveBeenCalledOnce());
    const bNotice = vi.fn();
    b.on(BATCHED_RESOURCES_CHANGED, bNotice);
    function View() {
      const { t } = useTranslation("common");
      return <p>{t("value")}</p>;
    }
    const view = render(
      <I18nextProvider i18n={a}>
        <View />
      </I18nextProvider>,
    );
    const aNotice = vi.fn();
    a.on(BATCHED_RESOURCES_CHANGED, aNotice);
    a.addResourceBundle("en", "common", { value: "old" }, true, true);
    view.rerender(
      <I18nextProvider i18n={b}>
        <View />
      </I18nextProvider>,
    );
    await waitFor(() => expect(aNotice).toHaveBeenCalledOnce());
    expect(screen.getByText("replacement")).toBeInTheDocument();
    expect(bNotice).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "loads real backend resources with useSuspense=%s",
    async (useSuspense) => {
      const i18n = i18next.createInstance();
      i18n.use({
        type: "backend",
        init() {},
        read(
          _language: string,
          namespace: string,
          callback: (error: null, data: object) => void,
        ) {
          queueMicrotask(() =>
            callback(null, { value: `loaded ${namespace}` }),
          );
        },
      });
      await i18n.init({
        lng: "en",
        fallbackLng: false,
        ns: [],
        defaultNS: "common",
        react: {
          useSuspense,
          bindI18n: `languageChanged ${BATCHED_RESOURCES_CHANGED}`,
          bindI18nStore: "",
        },
      });
      installBatchedResourceUpdates(i18n);
      function View() {
        const { t, ready } = useTranslation("remote", { useSuspense });
        return <p>{ready ? t("value") : "waiting"}</p>;
      }
      render(
        <I18nextProvider i18n={i18n}>
          <Suspense fallback={<p>waiting</p>}>
            <View />
          </Suspense>
        </I18nextProvider>,
      );
      await waitFor(() =>
        expect(screen.getByText("loaded remote")).toBeInTheDocument(),
      );
    },
  );
});
