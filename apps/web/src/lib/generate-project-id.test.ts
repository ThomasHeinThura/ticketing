import { describe, expect, it } from "vitest";
import generateProjectSlug from "./generate-project-id";

describe("generateProjectSlug", () => {
  it.each([
    ["TaskDesk", "TASKDESK"],
    ["Alpha Beta Gamma", "ALPHABETAGAMMA"],
    ["Alpha Beta Gamma Delta", "ALPHABETAGAMMAD"],
    [" TaskDesk", "TASKDESK"],
    [" Alpha Beta Gamma", "ALPHABETAGAMMA"],
    ["- Alpha Beta Gamma", "ALPHABETAGAMMA"],
    ["Проект Альфа", ""],
    ["Sprint 2", "SPRINT"],
    ["[Alpha] Beta Gamma", "ALPHABETAGAMMA"],
    ["𠀀𠀁𠀂𠀃", ""],
    ["𐌰lpha 𐌱eta", "LPHAETA"],
    ["́alpha ́beta", "ALPHABETA"],
    ["́alpha", "ALPHA"],
    ["!!!", ""],
    ["   ", ""],
    ["Customer Support", "CUSTOMERSUPPORT"],
    ["Financial Operations", "FINANCIALOPERAT"],
    ["ＡＢＣ", "ABC"],
    ["Alpha - 123 Beta", "ALPHABETA"],
    ["тест", ""],
    ["测试项目", ""],
    ["A", "A"],
    ["123 !!!", ""],
  ])("suggests ASCII letters from %s", (name, expected) => {
    expect(generateProjectSlug(name)).toBe(expected);
  });
});
