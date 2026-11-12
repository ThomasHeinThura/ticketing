import { z } from "zod/v4";

// Matches the local sign-up minimum and Better Auth's configured default maximum.
export function localPasswordSchema(tooShort: string, tooLong: string) {
  return z
    .string()
    .min(8, { message: tooShort })
    .max(128, { message: tooLong });
}
