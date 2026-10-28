import { describe, expect, it } from "vitest";
import { translate } from "./en-translation";

describe("English catalog test translator", () => {
  it("resolves closed agent and customer terms from the canonical English catalog", () => {
    expect(translate("navigation:projectViews.workItems")).toBe("Work items");
    expect(translate("navigation:projectViews.selectProject")).toBe(
      "Select Project",
    );
    expect(translate("portal:notifications.events.comment")).toBe(
      "New comment on your Request",
    );
  });

  it("resolves the registered organisation deletion action in the real catalog", () => {
    expect(translate("pendingActions:registered.actions.organisation")).toBe(
      "Delete organisation",
    );
  });

  it("keeps count and user text literal while resolving term slots once", () => {
    const userText = '$t(term:agent.project, {"count":1}) {{term_project_one}}';
    expect(
      translate("common:a11y.taskContainerLabel", {
        key: "SUP-7",
        title: userText,
        term_work_item_one: "Injected label",
      }),
    ).toBe(`Work item SUP-7: ${userText}`);
    expect(translate("tasks:calendar.noTasks", { count: 0 })).toContain(
      "Work items",
    );
  });

  it("preserves missing-key errors and rejects unknown terminology placeholders", () => {
    expect(() => translate("common:not.a.real.key")).toThrow(
      "Missing en-US key common:not.a.real.key",
    );
    expect(() =>
      translate("common:not.a.real.key", {
        defaultValue: "Missing {{term_unregistered_one}}",
      }),
    ).toThrow(
      "Unknown closed English terminology placeholder term_unregistered_one",
    );
  });
});
