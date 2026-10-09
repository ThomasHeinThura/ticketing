import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "../database";
import { publishEvent } from "../events";
import { type DbTransaction, enqueueOutboxEvent } from "../events/outbox";

type SubmissionEvent =
  | {
      kind: "submission.received";
      payload: { ref: string; requestTypeId: string; organisationId: string };
    }
  | {
      kind: "submission.replied";
      payload: { ref: string; by: "customer" | "staff" };
    }
  | {
      kind: "submission.accepted";
      payload: { ref: string; workItemKey: string };
    }
  | { kind: "submission.declined"; payload: { ref: string; reason: string } }
  | { kind: "submission.withdrawn"; payload: { ref: string } };

export async function getSubmissionEventScope(
  tx: DbTransaction,
  submissionId: string,
): Promise<{ workspaceId: string; organisationId: string } | null> {
  const [row] = await tx
    .select({
      workspaceId: schema.requestTypeTable.workspaceId,
      organisationId: schema.submissionTable.organisationId,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(eq(schema.submissionTable.id, submissionId))
    .limit(1);
  return row ?? null;
}

export async function recordSubmissionEvent(
  tx: DbTransaction,
  input: SubmissionEvent & {
    workspaceId: string;
    organisationId: string;
    actorId: string | null;
    actorType: "person" | "system";
  },
): Promise<void> {
  const occurredAt = new Date().toISOString();
  await enqueueOutboxEvent(tx, {
    id: `evt_${randomUUID()}`,
    kind: input.kind,
    occurredAt,
    actor: {
      type: input.actorType,
      id: input.actorId,
      name:
        input.actorType === "system" ? "TaskDesk system" : "TaskDesk person",
    },
    scope: {
      workspaceId: input.workspaceId,
      organisationId: input.organisationId,
    },
    payload: input.payload,
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
}

/** The outbox is authoritative; a transient in-process notification may not fail a committed request. */
export async function notifySubmissionEvent(
  event: SubmissionEvent,
): Promise<void> {
  let publication: Promise<void>;
  switch (event.kind) {
    case "submission.received":
      publication = publishEvent("submission.received", event.payload);
      break;
    case "submission.replied":
      publication = publishEvent("submission.replied", event.payload);
      break;
    case "submission.accepted":
      publication = publishEvent("submission.accepted", event.payload);
      break;
    case "submission.declined":
      publication = publishEvent("submission.declined", event.payload);
      break;
    case "submission.withdrawn":
      publication = publishEvent("submission.withdrawn", event.payload);
      break;
    default:
      return assertNever(event);
  }

  try {
    await publication;
  } catch (error) {
    console.error(
      "Submission event notification failed; durable event retained",
      {
        kind: event.kind,
        error: error instanceof Error ? error.message : "unknown error",
      },
    );
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled submission event: ${JSON.stringify(value)}`);
}
