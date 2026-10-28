import { describe, expect, it } from "vitest";
import { buildTerminologyPreviewExamples } from "../../../apps/api/src/terminology/preview";
import { terminologyPreviewResponseSchema } from "../../../apps/api/src/terminology/schema";
import { TERMINOLOGY_LOCALES } from "../../../packages/domain/src/terminology-defaults.generated";

describe("terminology preview CLDR examples", () => {
  it.each(TERMINOLOGY_LOCALES)(
    "returns a representative valid count for every %s plural category",
    (locale) => {
      const categories = new Intl.PluralRules(locale).resolvedOptions()
        .pluralCategories;
      const forms = Object.fromEntries(
        categories.map((category) => [category, `${locale} ${category}`]),
      );
      const examples = buildTerminologyPreviewExamples({ locale, forms });

      expect(examples?.map(({ category }) => category)).toEqual(categories);
      for (const example of examples ?? []) {
        expect(new Intl.PluralRules(locale).select(example.count)).toBe(
          example.category,
        );
        expect(example.label).toBe(forms[example.category]);
      }
    },
  );

  it("includes high and fractional samples where CLDR requires them", () => {
    const frenchCategories = new Intl.PluralRules("fr-FR").resolvedOptions()
      .pluralCategories;
    const french = buildTerminologyPreviewExamples({
      locale: "fr-FR",
      forms: Object.fromEntries(frenchCategories.map((key) => [key, key])),
    });
    expect(french?.find(({ category }) => category === "many")?.count).toBe(
      1_000_000,
    );

    const russianCategories = new Intl.PluralRules("ru-RU").resolvedOptions()
      .pluralCategories;
    const russian = buildTerminologyPreviewExamples({
      locale: "ru-RU",
      forms: Object.fromEntries(russianCategories.map((key) => [key, key])),
    });
    const other = russian?.find(({ category }) => category === "other");
    expect(other).toBeDefined();
    if (!other) throw new Error("Russian CLDR other example is missing");
    expect(new Intl.PluralRules("ru-RU").select(other.count)).toBe("other");
    expect(Number.isInteger(other.count)).toBe(false);
  });

  it("rejects missing, blank, and extra category forms", () => {
    expect(
      buildTerminologyPreviewExamples({
        locale: "en-US",
        forms: { one: "Case", few: "Cases" },
      }),
    ).toBeNull();
    expect(
      buildTerminologyPreviewExamples({
        locale: "en-US",
        forms: { one: "Case", other: " " },
      }),
    ).toBeNull();
  });

  it("accepts fractional sample counts in the documented response schema", () => {
    expect(
      terminologyPreviewResponseSchema.safeParse({
        termKey: "request",
        locale: "ru-RU",
        audience: "agent",
        examples: [{ category: "other", count: 0.1, label: "запрос" }],
      }).success,
    ).toBe(true);
  });
});
