import { z } from "../openapi";
import { MAX_PAGE_TITLE_LENGTH } from "./logic";

const noNul = (value: string) => !value.includes("\u0000");
const NO_NUL = "Must not contain a NUL byte";
const id = z.string().min(1).max(128).refine(noNul, NO_NUL);
const title = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PAGE_TITLE_LENGTH)
  .refine(noNul, NO_NUL);
/** A Tiptap document; the server sanitises it against the KB allowlist before storing. */
const body = z.record(z.string(), z.unknown());

export const projectParam = z.object({
  projectId: z.string().min(1).max(128),
});
export const pageParam = z.object({
  projectId: z.string().min(1).max(128),
  id,
});
export const versionParam = z.object({
  projectId: z.string().min(1).max(128),
  id,
  number: z.coerce.number().int().min(1),
});
export const createPageBody = z.object({
  title,
  body: body.optional(),
  parentId: id.nullable().optional(),
});
export const updatePageBody = z
  .object({
    /** PG-5: the version the client last read. A stale value is a 409 and nothing is written. */
    expectedVersion: z.number().int().min(1),
    title: title.optional(),
    body: body.optional(),
    parentId: id.nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.body !== undefined ||
      value.parentId !== undefined,
    { message: "Nothing to change" },
  );
export const restorePageBody = z.object({
  /** The version number whose title and body are restored (as a new version). */
  number: z.number().int().min(1),
  expectedVersion: z.number().int().min(1),
});
