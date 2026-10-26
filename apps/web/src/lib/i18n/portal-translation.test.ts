import { render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import english from "../../../../../i18n/en-US.json";
import { i18n as baseI18n } from "./index";
import {
  getDefaultPortalTerm,
  withPortalTerminology,
} from "./portal-translation";

async function isolatedTranslator(noun = "Case", plural = "Cases") {
  const instance = createInstance();
  await instance.init({
    lng: "en-US",
    fallbackLng: "en-US",
    ns: ["portal", "term"],
    defaultNS: "portal",
    interpolation: { escapeValue: false, skipOnVariables: true },
    resources: {
      "en-US": {
        portal: {
          navigation: { requests: "My {{term_request_other}}" },
          intake: {
            submissionTitle: "{{term_request_one}} {{ref}}",
          },
        },
        term: {
          ...english.term,
          customer: {
            ...english.term.customer,
            request_one: noun,
            request_other: plural,
          },
        },
      },
    },
  });
  return { instance, t: withPortalTerminology(instance.t, instance) };
}

describe("portal terminology translation", () => {
  it("injects the active isolated customer noun into one and other forms", async () => {
    const { t } = await isolatedTranslator();
    expect(t("portal:navigation.requests")).toBe("My Cases");
    expect(t("portal:intake.submissionTitle", { ref: "SUB-7" })).toBe(
      "Case SUB-7",
    );
  });

  it("keeps user interpolation literal and prevents overriding the noun", async () => {
    const { t } = await isolatedTranslator();
    const ref = '$t(term:agent.work_item, {"count":1})';
    expect(
      t("portal:intake.submissionTitle", {
        ref,
        term_request_one: "Injected noun",
      }),
    ).toBe(`Case ${ref}`);
  });

  it("uses the active instance term bundle", async () => {
    const { instance, t } = await isolatedTranslator("Ticket", "Tickets");
    expect(t("portal:navigation.requests")).toBe("My Tickets");
    expect(instance.t("customer.request", { ns: "term", count: 1 })).toBe(
      "Ticket",
    );
  });

  it("keeps the shipped noun in title while the renamed link stays the accessible name", async () => {
    await baseI18n.changeLanguage("en-US");
    await baseI18n.loadNamespaces("term");
    const { instance, t } = await isolatedTranslator("Case", "Cases");
    const title = getDefaultPortalTerm(instance, "request", 2);
    render(
      createElement(
        "a",
        { href: "/portal/requests", title },
        t("portal:navigation.requests"),
      ),
    );

    const link = screen.getByRole("link", { name: "My Cases" });
    expect(link).toHaveAttribute("title", "Requests");
    expect(link).not.toHaveAttribute("aria-label");
  });
});
