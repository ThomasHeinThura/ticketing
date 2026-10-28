import {
  type NotificationCopyDescriptorV1,
  type NotificationCopySegment,
  TERMINOLOGY_TERM_KEYS,
  type TerminologyTermKey,
} from "@taskdesk/domain";
import { z } from "../openapi";

export const NOTIFICATION_COPY_EVENT_DATA_KEY = "systemCopy";
export const NOTIFICATION_TITLE_MAX_LENGTH = 160;
export const NOTIFICATION_BODY_MAX_LENGTH = 5000;
const NOTIFICATION_COPY_MAX_SEGMENTS = 24;

const termKeySchema = z.enum(TERMINOLOGY_TERM_KEYS);
const copySegmentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      text: z.string().min(1).max(NOTIFICATION_BODY_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal("term"),
      termKey: termKeySchema,
      count: z
        .number()
        .refine(
          (value) => Number.isSafeInteger(value) && value >= 0,
          "count must be a nonnegative safe integer",
        ),
    })
    .strict(),
]);

export const notificationCopyDescriptorSchema = z
  .object({
    version: z.literal(1),
    title: z
      .array(copySegmentSchema)
      .min(1)
      .max(NOTIFICATION_COPY_MAX_SEGMENTS),
    body: z.array(copySegmentSchema).min(1).max(NOTIFICATION_COPY_MAX_SEGMENTS),
  })
  .strict()
  .superRefine((descriptor, context) => {
    for (const [field, segments, maximum] of [
      ["title", descriptor.title, NOTIFICATION_TITLE_MAX_LENGTH],
      ["body", descriptor.body, NOTIFICATION_BODY_MAX_LENGTH],
    ] as const) {
      const literalLength = segments.reduce(
        (total, segment) =>
          total + (segment.kind === "text" ? segment.text.length : 0),
        0,
      );
      if (literalLength > maximum)
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} literal text exceeds its notification limit`,
        });
    }
  });

export type NotificationTermResolver = (
  key: TerminologyTermKey,
  count: number,
) => Promise<string>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse only our versioned, closed system-copy format; arbitrary eventData is never templated. */
export function parseNotificationCopyDescriptor(
  value: unknown,
): NotificationCopyDescriptorV1 | null {
  const parsed = notificationCopyDescriptorSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data as NotificationCopyDescriptorV1;
}

/** Store the descriptor beside existing eventData without changing any existing fields. */
export function withNotificationCopyDescriptor(
  eventData: unknown,
  descriptor: NotificationCopyDescriptorV1,
): Record<string, unknown> {
  return {
    ...(record(eventData) ? eventData : {}),
    [NOTIFICATION_COPY_EVENT_DATA_KEY]: descriptor,
  };
}

/** Internal copy metadata is not returned by notification APIs. */
export function withoutNotificationCopyDescriptor(eventData: unknown): unknown {
  if (!record(eventData) || !(NOTIFICATION_COPY_EVENT_DATA_KEY in eventData))
    return eventData;
  const { [NOTIFICATION_COPY_EVENT_DATA_KEY]: _copy, ...publicData } =
    eventData;
  return publicData;
}

async function renderSegments(
  segments: readonly NotificationCopySegment[],
  resolveTerm: NotificationTermResolver,
): Promise<string> {
  let result = "";
  for (const segment of segments) {
    result +=
      segment.kind === "text"
        ? segment.text
        : await resolveTerm(segment.termKey, segment.count);
  }
  return result;
}

/** Resolve only typed term segments; literal segments remain byte-for-byte literal text. */
export async function renderNotificationCopyDescriptor(
  descriptor: NotificationCopyDescriptorV1,
  resolveTerm: NotificationTermResolver,
): Promise<{ title: string; body: string } | null> {
  const [title, body] = await Promise.all([
    renderSegments(descriptor.title, resolveTerm),
    renderSegments(descriptor.body, resolveTerm),
  ]);
  if (
    title.length === 0 ||
    title.length > NOTIFICATION_TITLE_MAX_LENGTH ||
    body.length === 0 ||
    body.length > NOTIFICATION_BODY_MAX_LENGTH
  )
    return null;
  return { title, body };
}
