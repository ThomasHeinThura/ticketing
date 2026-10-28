import {
  type AppendAuditLogInput,
  appendAuditLog,
} from "../audit/audit-writer";
import type { Executor } from "../database/executor";
import { recordAuditWriteFailure } from "../instance/observability/runtime";

/**
 * `AU-14`: an audit write failure never fails the mutation, and is never silent. The audit row is
 * appended inside a savepoint of the caller's transaction so a failed append rolls back only
 * itself; the bounded operational signal is recorded and `true` is returned so the caller can
 * notify instance administrators after its own transaction commits
 * (`notifyCurrentInstanceAdminsOfAuditFailure`). Same shape the service-calendar writer uses.
 */
export async function appendAuditSavepoint(
  tx: Executor,
  input: AppendAuditLogInput,
): Promise<boolean> {
  try {
    await (
      tx as unknown as {
        transaction: <T>(fn: (inner: Executor) => Promise<T>) => Promise<T>;
      }
    ).transaction(async (inner) => appendAuditLog(inner, input));
  } catch {
    recordAuditWriteFailure("mutation");
    return true;
  }
  return false;
}
