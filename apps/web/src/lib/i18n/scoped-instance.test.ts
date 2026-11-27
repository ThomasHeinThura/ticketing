import { afterEach, describe, expect, it, vi } from "vitest";
import { createScopedI18n, i18n } from "./index";
import { installAudienceTerms } from "./terminology-provider";

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

  it("clones seeded bundles so agent and customer terminology never reach each other or the base", async () => {
    const agent = await createScopedI18n("en-US");
    const customer = await createScopedI18n("en-US");
    const shipped = structuredClone(agent.getResourceBundle("en-US", "term"));
    installAudienceTerms(agent, "en-US", shipped, "agent", {
      work_item: { one: "Ticket", other: "Tickets" },
    });
    installAudienceTerms(customer, "en-US", shipped, "customer", {
      work_item: { one: "Case", other: "Cases" },
    });
    const read = (instance: typeof i18n, audience: string) =>
      instance.t(`${audience}.work_item`, { ns: "term", count: 1 });
    expect(read(agent, "agent")).toBe("Ticket");
    expect(read(customer, "customer")).toBe("Case");
    // Neither overlay leaks across audiences, into the base store or into a fresh clone.
    expect(read(customer, "agent")).not.toBe("Ticket");
    expect(read(agent, "customer")).not.toBe("Case");
    expect(read(i18n, "agent")).not.toBe("Ticket");
    expect(read(i18n, "customer")).not.toBe("Case");
    const fresh = await createScopedI18n("en-US");
    expect(read(fresh, "agent")).not.toBe("Ticket");
    expect(read(fresh, "customer")).not.toBe("Case");
    // The bundles are copies, not shared references.
    expect(agent.getResourceBundle("en-US", "term")).not.toBe(
      i18n.getResourceBundle("en-US", "term"),
    );
  });
});
