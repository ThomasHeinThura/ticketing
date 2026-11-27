import de from "@i18n/de-DE.json";
import { afterEach, describe, expect, it, vi } from "vitest";

// Group mode is chosen once at module load from the URL, so each test sets the URL, resets the
// module registry and imports `./index` afresh.
const net = vi.hoisted(() => ({
  hold: false,
  fail: false,
  release: () => {},
  gate: Promise.resolve(),
}));

vi.mock("./after-first-paint", () => ({
  afterFirstPaint: () => Promise.resolve(),
}));
vi.mock("./group-loaders-rest", async () => {
  const actual = await vi.importActual<{
    default: Record<string, () => Promise<unknown>>;
  }>("./group-loaders-rest");
  return {
    default: new Proxy(actual.default, {
      get: (target, locale: string) => () => {
        if (locale !== "de-DE") return target[locale]();
        if (net.fail) return Promise.reject(new Error("rest chunk failed"));
        return net.hold
          ? net.gate.then(() => target[locale]())
          : target[locale]();
      },
    }),
  };
});
vi.mock("@i18n/resources", async () => {
  const actual =
    await vi.importActual<typeof import("@i18n/resources")>("@i18n/resources");
  return {
    ...actual,
    loadLocale: (...args: Parameters<typeof actual.loadLocale>) =>
      net.fail && args[0] === "de-DE"
        ? Promise.reject(new Error("full catalog failed"))
        : actual.loadLocale(...args),
  };
});

async function importInGroupMode() {
  window.history.pushState({}, "", "/agent/projects/WLP/work");
  vi.resetModules();
  net.gate = new Promise<void>((resolve) => {
    net.release = resolve;
  });
  const index = await import("./index");
  await vi.waitFor(() => expect(index.i18n.language).toBe("en-US"));
  await vi.waitFor(() =>
    expect(index.i18n.hasLoadedNamespace("common")).toBe(true),
  );
  return index;
}

afterEach(() => {
  window.history.pushState({}, "", "/");
  net.hold = false;
  net.fail = false;
});

describe("switchLanguage", () => {
  it("lets a newer request, even for the language already shown, cancel a pending switch", async () => {
    const { i18n, switchLanguage } = await importInGroupMode();
    net.hold = true;
    const toGerman = switchLanguage("de-DE");
    // English, German, English: the last request wins.
    expect(await switchLanguage("en-US")).toBe(true);
    net.release();
    expect(await toGerman).toBe(false);
    expect(i18n.language).toBe("en-US");
    expect(i18n.hasResourceBundle("de-DE", "tasksExtra")).toBe(false);
  });

  it("keeps the current language and returns false when the complete locale cannot load, then retries", async () => {
    const { i18n, switchLanguage } = await importInGroupMode();
    net.fail = true;
    expect(await switchLanguage("de-DE")).toBe(false);
    // Nothing was committed: still English, no German bundle half-installed to mix with it.
    expect(i18n.language).toBe("en-US");
    expect(i18n.t("common:actions.cancel")).toBe("Cancel");
    // A later request retries from scratch and succeeds.
    net.fail = false;
    expect(await switchLanguage("de-DE")).toBe(true);
    expect(i18n.language).toBe("de-DE");
    expect(i18n.t("common:actions.cancel")).toBe(de.common.actions.cancel);
    expect(i18n.t("tasksExtra:contextMenu.copyLink")).toBe(
      de.tasksExtra.contextMenu.copyLink,
    );
  });
});
