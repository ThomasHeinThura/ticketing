import { render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import english from "../../../../../i18n/en-US.json";
import {
  getDefaultAgentTerm,
  installAgentTerminology,
  withAgentTerminology,
} from "./agent-translation";
import { i18n as baseI18n } from "./index";

async function isolatedTranslator(noun = "Ticket", plural = "Tickets") {
  const instance = createInstance();
  await instance.init({
    lng: "en-US",
    fallbackLng: "en-US",
    ns: ["agent", "term"],
    defaultNS: "agent",
    interpolation: { escapeValue: false, skipOnVariables: true },
    resources: {
      "en-US": {
        agent: {
          navigation: { workItems: "{{term_work_item_other}}" },
          intake: {
            title: "{{term_request_one}} {{ref}}",
          },
          counters: { modules: "{{count}} {{term_module_other}}" },
        },
        term: {
          ...english.term,
          agent: {
            ...english.term.agent,
            work_item_one: noun,
            work_item_other: plural,
          },
        },
      },
    },
  });
  return { instance, t: withAgentTerminology(instance.t, instance) };
}

describe("agent terminology translation", () => {
  it("injects the active one and other forms without affecting plural counts", async () => {
    const { t, instance } = await isolatedTranslator();
    expect(t("agent:navigation.workItems")).toBe("Tickets");
    expect(t("agent:intake.title", { ref: "REQ-7" })).toBe("Request REQ-7");
    expect(t("agent:counters.modules", { count: 3 })).toBe("3 Modules");
    expect(instance.t("agent.work_item", { ns: "term", count: 1 })).toBe(
      "Ticket",
    );
  });

  it("reuses the nouns between calls and refreshes them when a terminology overlay or language lands", async () => {
    const { t, instance } = await isolatedTranslator();
    expect(t("agent:navigation.workItems")).toBe("Tickets");
    instance.addResourceBundle(
      "en-US",
      "term",
      { agent: { work_item_one: "Case", work_item_other: "Cases" } },
      true,
      true,
    );
    expect(t("agent:navigation.workItems")).toBe("Cases");
    instance.addResourceBundle("de", "agent", {
      navigation: { workItems: "{{term_work_item_other}}" },
    });
    instance.addResourceBundle("de", "term", {
      agent: { work_item_one: "Vorgang", work_item_other: "Vorgänge" },
    });
    await instance.changeLanguage("de");
    expect(t("agent:navigation.workItems")).toBe("Vorgänge");
  });

  it("keeps user interpolation literal and prevents callers overriding nouns", async () => {
    const { t } = await isolatedTranslator();
    const ref = '$t(term:agent.work_item, {"count":1})';
    expect(
      t("agent:intake.title", {
        ref,
        term_request_one: "Injected noun",
      }),
    ).toBe(`Request ${ref}`);
  });

  it("installs per-call variables on an isolated instance for existing t callers", async () => {
    const { instance } = await isolatedTranslator();
    installAgentTerminology(instance);
    expect(instance.t("agent:navigation.workItems")).toBe("Tickets");
    expect(instance.getFixedT("en-US", "agent")("navigation.workItems")).toBe(
      "Tickets",
    );
    expect(instance.t(["agent:missing", "agent:navigation.workItems"])).toBe(
      "Tickets",
    );
    expect(
      instance.t("agent:missing.key", "Missing {{term_work_item_one}}"),
    ).toBe("Missing Ticket");
    expect(
      instance.t("agent:missing.key", "Missing {{term_project_other}}", {
        count: 5,
      }),
    ).toBe("Missing Projects");
    expect(
      instance.t("agent:intake.title", {
        ref: '$t(term:agent.work_item, {"count":1})',
        term_request_one: "Injected noun",
      }),
    ).toBe('Request $t(term:agent.work_item, {"count":1})');
  });

  it("uses the caller count to resolve all shipped CLDR project forms", async () => {
    const instance = createInstance();
    await instance.init({
      lng: "ru-RU",
      fallbackLng: false,
      ns: ["agent", "term"],
      defaultNS: "agent",
      interpolation: { escapeValue: false, skipOnVariables: true },
      resources: {
        "ru-RU": {
          agent: { projectCount: "{{count}} {{term_project_other}}" },
          term: {
            agent: {
              project_one: "проект",
              project_few: "проекта",
              project_many: "проектов",
              project_other: "project",
            },
          },
        },
      },
    });
    installAgentTerminology(instance);

    expect(instance.t("projectCount", { count: 0 })).toBe("0 проектов");
    expect(instance.t("projectCount", { count: 1 })).toBe("1 проект");
    expect(instance.t("projectCount", { count: 2 })).toBe("2 проекта");
    expect(instance.t("projectCount", { count: 5 })).toBe("5 проектов");
  });

  it("renders real agent catalog labels through the active terminology", async () => {
    const instance = createInstance();
    await instance.init({
      lng: "en-US",
      fallbackLng: "en-US",
      ns: [
        "navigation",
        "workItems",
        "settings",
        "agile",
        "serviceManagement",
        "term",
      ],
      defaultNS: "navigation",
      interpolation: { escapeValue: false, skipOnVariables: true },
      resources: {
        "en-US": {
          navigation: english.navigation,
          workItems: english.workItems,
          settings: english.settings,
          agile: english.agile,
          serviceManagement: english.serviceManagement,
          term: {
            ...english.term,
            agent: {
              ...english.term.agent,
              work_item_one: "Ticket",
              work_item_other: "Tickets",
              project_one: "Space",
              project_other: "Spaces",
              cycle_one: "Iteration",
              cycle_other: "Iterations",
              module_one: "Component",
              module_other: "Components",
              service_one: "Offering",
              service_other: "Offerings",
              change_one: "Release",
              change_other: "Releases",
            },
          },
        },
      },
    });
    installAgentTerminology(instance);

    expect(instance.t("navigation:projectViews.workItems")).toBe("Tickets");
    expect(instance.t("workItems:list.emptyTitle")).toBe("No Tickets yet");
    expect(instance.t("settings:projectGeneral.pageTitle")).toBe(
      "Space Settings",
    );
    expect(instance.t("agile:cycles.title")).toContain("Iteration");
    expect(instance.t("serviceManagement:nav.services")).toBe("Offerings");
    expect(instance.t("serviceManagement:nav.changes")).toBe(
      "Release calendar",
    );
  });

  it("uses the shipped noun in title while the renamed visible label stays accessible", async () => {
    await baseI18n.changeLanguage("en-US");
    await baseI18n.loadNamespaces("term");
    const { instance, t } = await isolatedTranslator();
    const title = getDefaultAgentTerm(instance, "work_item", 2);
    render(
      createElement(
        "a",
        { href: "/agent/work-items", title },
        t("agent:navigation.workItems"),
      ),
    );

    const link = screen.getByRole("link", { name: "Tickets" });
    expect(link).toHaveAttribute("title", "Work items");
    expect(link).not.toHaveAttribute("aria-label");
  });

  it("uses an actual typed work-item name when one is supplied", async () => {
    const { instance } = await isolatedTranslator();
    expect(getDefaultAgentTerm(instance, "work_item", 1, "Customer case")).toBe(
      "Customer case",
    );
    expect(getDefaultAgentTerm(instance, "project", 1)).toBe("Project");
  });
});
