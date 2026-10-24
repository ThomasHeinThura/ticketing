/**
 * Money is integer minor units end to end (`TC-1`: no floating point on an invoice). The currency
 * decides how many decimals a minor unit is (EUR 2, JPY 0, KWD 3); amounts are formatted and
 * parsed with string and integer arithmetic only.
 */

export function currencyExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** `12345`, `EUR` -> `123.45 EUR`, grouped for the locale, never through a float. */
export function formatMinor(
  amountMinor: number,
  currency: string,
  locale?: string,
): string {
  const exponent = currencyExponent(currency);
  const negative = amountMinor < 0;
  const absolute = BigInt(Math.abs(Math.trunc(amountMinor)));
  const unit = BigInt(10) ** BigInt(exponent);
  const major = (absolute / unit).toString();
  const fraction = (absolute % unit).toString().padStart(exponent, "0");
  const grouped = new Intl.NumberFormat(locale).format(BigInt(major));
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? ".";
  return `${negative ? "-" : ""}${grouped}${exponent > 0 ? `${decimal}${fraction}` : ""} ${currency}`;
}

/** Parse `123.45` (or `123,45`) into minor units for `currency`; null when it is not an amount. */
export function parseMinor(input: string, currency: string): number | null {
  const exponent = currencyExponent(currency);
  const match = /^(\d{1,12})(?:[.,](\d+))?$/u.exec(input.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return null;
  const minor =
    Number(match[1]) * 10 ** exponent +
    Number(fraction.padEnd(exponent, "0") || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}
