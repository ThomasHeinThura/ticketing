import { afterEach, describe, expect, it, vi } from "vitest";
import { createScopedI18n, i18n } from "./index";

// The portal deliberately emits no grouped agent catalog loaders.
vi.mock("./group-loaders-slim", () => ({ default: {} }));
vi.mock("./group-loaders-rest", () => ({ default: {} }));

const locale = "fr-FR";
let restoreBaseIntake: Record<string, unknown> | undefined;

afterEach(() => {
  if (restoreBaseIntake) {
    i18n.addResourceBundle(
      locale,
      "intake",
      structuredClone(restoreBaseIntake),
      false,
      true,
    );
    restoreBaseIntake = undefined;
  }
});

describe("scoped i18next instances", () => {
  it("loads portal namespaces when grouped agent loaders are absent", async () => {
    const scoped = await createScopedI18n("en-US", ["common"]);
    await scoped.loadNamespaces(["portal", "term"]);
    expect(scoped.t("notifications.title", { ns: "portal" })).toBe(
      "Notifications",
    );
    expect(scoped.t("customer.request", { ns: "term", count: 1 })).toBe(
      "Request",
    );
  });

  it("loads a deferred namespace into its own store without mutating the base", async () => {
    const loadedBaseIntake = i18n.getResourceBundle(locale, "intake");
    restoreBaseIntake = loadedBaseIntake
      ? structuredClone(loadedBaseIntake)
      : undefined;
    i18n.removeResourceBundle(locale, "intake");

    const scoped = await createScopedI18n(locale, ["common"]);
    expect(scoped.hasResourceBundle(locale, "intake")).toBe(false);

    await scoped.loadNamespaces("intake");

    expect(scoped.hasResourceBundle(locale, "intake")).toBe(true);
    expect(scoped.t("queue.saveTitle", { ns: "intake" })).toBe(
      "Save intake queue",
    );
    expect(i18n.hasResourceBundle(locale, "intake")).toBe(false);
  });
});
