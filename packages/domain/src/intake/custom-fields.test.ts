import { describe, expect, it } from "vitest";
import {
  type CustomFieldDefinition,
  isValidCustomFieldValue,
  normalizeCustomFieldValue,
  resolveCustomFieldValues,
} from "./custom-fields.js";

describe("custom field value validation", () => {
  const options = [
    { key: "open", label: "Open" },
    { key: "closed", label: "Closed" },
  ];
  const people = new Set(["person-a", "person-b"]);
  const context = {
    personIds: people,
    emailIsValid: (value: string) => value === "a@example.com",
  };

  it("accepts each canonical value family and rejects coercion or malformed boundaries", () => {
    expect(isValidCustomFieldValue("text", "", null)).toBe(true);
    expect(isValidCustomFieldValue("text", "x".repeat(501), null)).toBe(false);
    expect(isValidCustomFieldValue("long_text", "line 1\nline 2", null)).toBe(
      true,
    );
    expect(
      isValidCustomFieldValue("number", Number.MAX_SAFE_INTEGER, null),
    ).toBe(true);
    expect(isValidCustomFieldValue("number", 1.5, null)).toBe(false);
    expect(
      isValidCustomFieldValue("decimal", "123456789012.123456", null),
    ).toBe(true);
    expect(isValidCustomFieldValue("decimal", "01", null)).toBe(false);
    expect(isValidCustomFieldValue("decimal", "-0", null)).toBe(false);
    expect(
      isValidCustomFieldValue("decimal", "1234567890123.123456", null),
    ).toBe(false);
    expect(isValidCustomFieldValue("decimal", "1.1234567", null)).toBe(false);
    expect(isValidCustomFieldValue("decimal", "1e2", null)).toBe(false);
    expect(
      isValidCustomFieldValue(
        "currency",
        { amount: "12.5", currency: "USD" },
        null,
      ),
    ).toBe(true);
    expect(
      isValidCustomFieldValue(
        "currency",
        { amount: "12.50", currency: "USD" },
        null,
      ),
    ).toBe(false);
    expect(isValidCustomFieldValue("date", "2024-02-29", null)).toBe(true);
    expect(isValidCustomFieldValue("date", "2025-02-29", null)).toBe(false);
    expect(isValidCustomFieldValue("date", "0000-01-01", null)).toBe(false);
    expect(
      isValidCustomFieldValue("datetime", "2026-10-04T12:30:00+06:30", null),
    ).toBe(true);
    expect(
      isValidCustomFieldValue("datetime", "2026-10-04T12:30:00.1234Z", null),
    ).toBe(false);
    expect(
      normalizeCustomFieldValue("datetime", "2026-10-04T12:30:00+06:30"),
    ).toBe("2026-10-04T06:00:00.000Z");
    expect(
      isValidCustomFieldValue("datetime", "2026-10-04T12:30:00", null),
    ).toBe(false);
    expect(isValidCustomFieldValue("boolean", false, null)).toBe(true);
    expect(isValidCustomFieldValue("boolean", "false", null)).toBe(false);
    expect(isValidCustomFieldValue("select", "open", options)).toBe(true);
    expect(isValidCustomFieldValue("select", "Open", options)).toBe(false);
    expect(
      isValidCustomFieldValue("multi_select", ["open", "closed"], options),
    ).toBe(true);
    expect(
      isValidCustomFieldValue("multi_select", ["open", "open"], options),
    ).toBe(false);
    expect(isValidCustomFieldValue("user", "person-a", null, context)).toBe(
      true,
    );
    expect(isValidCustomFieldValue("user", "person-c", null, context)).toBe(
      false,
    );
    expect(
      isValidCustomFieldValue(
        "multi_user",
        ["person-a", "person-a"],
        null,
        context,
      ),
    ).toBe(false);
    expect(
      isValidCustomFieldValue("url", "https://example.com/path", null),
    ).toBe(true);
    expect(isValidCustomFieldValue("url", "javascript:alert(1)", null)).toBe(
      false,
    );
    expect(
      isValidCustomFieldValue("email", "a@example.com", null, context),
    ).toBe(true);
    expect(
      isValidCustomFieldValue("email", " A@example.com ", null, context),
    ).toBe(false);
    expect(isValidCustomFieldValue("email", "a@example.com", null)).toBe(false);
  });
});

describe("custom field defaults and visibility", () => {
  const base = (
    overrides: Partial<CustomFieldDefinition>,
  ): CustomFieldDefinition => ({
    key: "controller",
    format: "text",
    options: null,
    defaultValue: null,
    condition: null,
    visible: true,
    required: false,
    ...overrides,
  });

  it("resolves unconditional defaults before conditions and preserves explicit null", () => {
    const definitions = [
      base({ key: "controller", defaultValue: "yes" }),
      base({
        key: "dependent",
        condition: { field_key: "controller", op: "eq", value: "yes" },
        defaultValue: "from-default",
      }),
      base({ key: "nullable", format: "number", defaultValue: 42 }),
    ];
    expect(resolveCustomFieldValues(definitions, { nullable: null })).toEqual({
      ok: true,
      values: { controller: "yes", dependent: "from-default" },
    });
  });

  it("does not default hidden, nonapplicable, or deleted definitions and enforces only visible requiredness", () => {
    const definitions = [
      base({ key: "hidden", defaultValue: "x", visible: false }),
      base({ key: "deleted", defaultValue: "x" }),
      base({ key: "required", required: true }),
    ];
    expect(resolveCustomFieldValues(definitions, {})).toEqual({
      ok: false,
      invalidKeys: ["required"],
    });
    expect(resolveCustomFieldValues(definitions.slice(0, 1), {})).toEqual({
      ok: true,
      values: {},
    });
  });

  it("fails closed when a stored condition has an unsupported shape", () => {
    const controller = base({ key: "controller", defaultValue: "yes" });
    const malformed = base({
      key: "required",
      required: true,
      condition: { field_key: "controller", op: "unknown" } as never,
    });
    expect(resolveCustomFieldValues([controller, malformed], {})).toEqual({
      ok: false,
      invalidKeys: ["required"],
    });
    const extraKey = base({
      key: "extra",
      condition: {
        field_key: "controller",
        op: "eq",
        value: "yes",
        arbitrary: true,
      } as never,
    });
    expect(resolveCustomFieldValues([controller, extraKey], {})).toEqual({
      ok: false,
      invalidKeys: ["extra"],
    });
  });
});
