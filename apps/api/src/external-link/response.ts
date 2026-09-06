import { responseTimestamp, z } from "../openapi";

export const externalLinkSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    resourceType: z.string().openapi({
      description:
        "The kind of remote resource, e.g. `issue` or `pull_request`.",
    }),
    externalId: z.string().openapi({
      description: "The provider's own identifier for the linked resource.",
    }),
    url: z.string(),
    title: z.string().nullable(),
    metadata: z.unknown().nullable().openapi({
      description:
        "Provider-specific payload, parsed from the stored JSON string. Null when the link has no metadata.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("ExternalLink");

export const externalLinkListSchema = z.array(externalLinkSchema);
