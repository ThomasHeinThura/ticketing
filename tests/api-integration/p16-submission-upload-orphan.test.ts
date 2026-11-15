import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeSubmissionAttachment } from "../../apps/api/src/attachment/controllers/complete-submission-attachment";
import * as attachmentRepository from "../../apps/api/src/attachment/repository";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import * as storage from "../../apps/api/src/storage";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import { seedIntake, submissionRow, submitAs } from "./helpers/intake-http";

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

describe("P-16: portal submission upload completion never orphans final storage objects", () => {
  let root: string;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated filesystem root for test.
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated storage driver for test.
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "p16-submission-orphan-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated storage driver for test.
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
    if (originalRoot === undefined)
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated filesystem root for test.
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    if (originalDriver === undefined)
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated storage driver for test.
      delete process.env.TASKDESK_STORAGE_DRIVER;
    else process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
  });

  it("deletes authorizedFinalKey and leaves no orphan when the transaction fails after staging the final object", async () => {
    const s = await seedIntake("p16-tx-failure");
    const ref = await submitAs(s, s.customer);
    const submission = await submissionRow(ref);
    const attachmentId = randomUUID();
    const pendingKey = `workspace/${s.t.workspaceId}/submission/${submission.id}/attachment/${attachmentId}/evidence.png`;
    const pendingPath = path.join(root, pendingKey);
    await mkdir(path.dirname(pendingPath), { recursive: true });
    await writeFile(pendingPath, VALID_PNG);

    const pending = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          id: attachmentId,
          workspaceId: s.t.workspaceId,
          organisationId: s.customer.orgId,
          submissionId: submission.id,
          objectKey: pendingKey,
          filename: "evidence.png",
          mimeType: "image/png",
          size: VALID_PNG.byteLength,
          state: "pending",
          customerVisible: true,
          uploadedBy: s.customer.person.id,
        })
        .returning(),
      "pending submission attachment",
    );

    const identity = await resolveIdentity({
      userId: s.customer.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("failed to resolve customer identity");

    const deleteSpy = vi.spyOn(storage, "deleteStorageObject");
    vi.spyOn(
      attachmentRepository,
      "markSubmissionAttachmentReady",
    ).mockRejectedValueOnce(new Error("simulated database write failure"));

    await expect(
      completeSubmissionAttachment({
        attachmentId: pending.id,
        submissionId: submission.id,
        submissionWorkItemId: submission.workItemId,
        requesterId: s.customer.person.id,
        workspaceId: s.t.workspaceId,
        identity,
      }),
    ).rejects.toThrow("simulated database write failure");

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    const deletedKey = deleteSpy.mock.calls[0]?.[0];
    expect(deletedKey).toMatch(
      new RegExp(
        `^workspace/${s.t.workspaceId}/submission/${submission.id}/attachment/${attachmentId}/final/[A-Za-z0-9]+-evidence\\.png$`,
      ),
    );

    // Neither pending nor final files remain on disk.
    expect(await listFilesRecursively(root)).toHaveLength(0);

    // Transaction rolled back cleanly, leaving the pending row untouched.
    const rowAfter = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, pending.id),
    });
    expect(rowAfter?.state).toBe("pending");
    expect(rowAfter?.objectKey).toBe(pendingKey);
  });
});
