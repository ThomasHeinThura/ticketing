import { describe, expect, it } from "vitest";
import { currencyExponent, formatMinor, parseMinor } from "./money-minor";

describe("money in minor units", () => {
  it("knows each currency's decimals", () => {
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("formats without a float", () => {
    expect(formatMinor(12345, "EUR", "en-US")).toBe("123.45 EUR");
    expect(formatMinor(5, "EUR", "en-US")).toBe("0.05 EUR");
    expect(formatMinor(1_234_567, "USD", "en-US")).toBe("12,345.67 USD");
    expect(formatMinor(900, "JPY", "en-US")).toBe("900 JPY");
    expect(formatMinor(-250, "EUR", "en-US")).toBe("-2.50 EUR");
  });

  it("parses an amount into integer minor units", () => {
    expect(parseMinor("123.45", "EUR")).toBe(12345);
    expect(parseMinor("123,45", "EUR")).toBe(12345);
    expect(parseMinor("60", "EUR")).toBe(6000);
    expect(parseMinor("0.1", "EUR")).toBe(10);
    expect(parseMinor("900", "JPY")).toBe(900);
    expect(parseMinor("1.005", "KWD")).toBe(1005);
  });

  it("refuses more decimals than the currency has, signs and text", () => {
    expect(parseMinor("1.234", "EUR")).toBeNull();
    expect(parseMinor("1.5", "JPY")).toBeNull();
    expect(parseMinor("-1", "EUR")).toBeNull();
    expect(parseMinor("abc", "EUR")).toBeNull();
    expect(parseMinor("", "EUR")).toBeNull();
  });
});
