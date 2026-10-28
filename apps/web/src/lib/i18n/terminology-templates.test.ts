import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import english from "../../../../../i18n/en-US.json";

async function customerTranslations(noun = "Request", plural = "Requests") {
  const instance = createInstance();
  await instance.init({
    lng: "en-US",
    fallbackLng: "en-US",
    ns: ["portal", "term"],
    defaultNS: "portal",
    interpolation: {
      escapeValue: false,
      skipOnVariables: true,
      defaultVariables: { term_request_one: noun, term_request_other: plural },
    },
    resources: {
      "en-US": {
        portal: english.portal,
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
  return instance;
}

describe("customer terminology source templates", () => {
  it("uses one override across navigation, catalogue, requests and details", async () => {
    const instance = await customerTranslations("Case", "Cases");
    expect(instance.t("navigation.requests")).toBe("My Cases");
    expect(instance.t("home.recent")).toBe("Recent Cases");
    expect(instance.t("intake.catalogueTitle")).toBe("Case catalogue");
    expect(instance.t("requests.emptyTitle")).toBe("No Cases yet");
    expect(instance.t("intake.submissionTitle", { ref: "SUB-7" })).toBe(
      "Case SUB-7",
    );
    expect(instance.t("request.readOnly")).toContain("this Case");
    expect(instance.t("requests.backlogItem")).toBe("Case");
  });

  it("preserves dynamic user text as literal text, including nested term syntax", async () => {
    const instance = await customerTranslations("Case", "Cases");
    const ref = '$t(term:agent.work_item, {"count":1})';
    expect(instance.t("intake.submissionTitle", { ref })).toBe(`Case ${ref}`);
  });

  it("keeps the shipped customer noun when no override is present", async () => {
    const instance = await customerTranslations();
    expect(instance.t("intake.catalogueTitle")).toBe("Request catalogue");
    expect(instance.t("intake.submissionTitle", { ref: "SUB-7" })).toBe(
      "Request SUB-7",
    );
  });
});
