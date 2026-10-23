import { z } from "../openapi";
export const relationTypes = [
  "relates",
  "blocks",
  "duplicates",
  "precedes",
  "requires",
] as const;
const identifier = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) => !value.includes("\u0000"),
    "Identifier must not contain NUL",
  );
export const relationKeyParam = z.object({ key: identifier });
export const relationIdParam = z.object({ key: identifier, id: identifier });
export const createRelationBody = z
  .object({ targetKey: identifier, type: z.enum(relationTypes) })
  .strict();
export const relationCandidatesQuery = z.object({
  q: z
    .string()
    .max(200)
    .refine((value) => !value.includes("\u0000"), "Search must not contain NUL")
    .optional(),
  cursor: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
