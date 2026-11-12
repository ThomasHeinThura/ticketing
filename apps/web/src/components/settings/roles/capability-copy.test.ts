import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CAPABILITIES } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DESCRIPTION_KEYS,
  CAPABILITY_GROUP_KEYS,
  CAPABILITY_LABEL_KEYS,
} from "./capability-copy";
import { ROLE_CAPABILITY_ITEMS } from "./capability-model";

const directory = path.resolve(__dirname, "../../../../../../i18n");

describe("role capability translations", () => {
  it("covers every registry entry in every locale with the original English copy", () => {
    const entries = ROLE_CAPABILITY_ITEMS.flatMap(
      (item) =>
        [
          [CAPABILITY_LABEL_KEYS[item.id], item.label],
          [CAPABILITY_DESCRIPTION_KEYS[item.id], item.description],
          [CAPABILITY_GROUP_KEYS[item.group], item.group],
        ] as const,
    );
    entries.push(
      ...Object.entries(CAPABILITIES)
        .filter(([, capability]) => capability.group === "Instance")
        .map(
          ([id, capability]) =>
            [CAPABILITY_DESCRIPTION_KEYS[id], capability.description] as const,
        ),
    );
    const locales = readdirSync(directory).filter((file) =>
      /^[a-z]{2}-[A-Z]{2}\.json$/u.test(file),
    );
    expect(locales.length).toBe(19);
    for (const file of locales) {
      const catalog = JSON.parse(
        readFileSync(path.join(directory, file), "utf8"),
      ) as Record<string, unknown>;
      for (const [key, english] of entries) {
        expect(key, `${file}: ${english}`).toBeDefined();
        if (!key) throw new Error(`Missing key for ${english}`);
        const [namespace = "", relative = ""] = key.split(":");
        const value = relative
          .split(".")
          .reduce<unknown>(
            (node, segment) =>
              (node as Record<string, unknown> | undefined)?.[segment],
            catalog[namespace],
          );
        expect(typeof value, `${file}: ${key}`).toBe("string");
        if (file === "en-US.json") expect(value, key).toBe(english);
      }
    }
  });
});
