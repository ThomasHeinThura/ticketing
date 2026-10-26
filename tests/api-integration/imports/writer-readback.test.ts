import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setImportAttachmentDependencies } from "../../../apps/api/src/imports/writer";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/database";
import {
  commitChunk,
  createRun,
  record,
  writerFixture,
} from "./writer-fixture";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);
let root: string;
const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

beforeEach(async () => {
  await resetTestDatabase();
  root = await mkdtemp(path.join(tmpdir(), "p6b-readback-"));
  process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
});
afterEach(async () => {
  setImportAttachmentDependencies(null);
  await rm(root, { recursive: true, force: true });
  if (originalRoot === undefined)
    delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
});

describe("import writer: imported data reads back through the native APIs", () => {
  it("shows placeholder authorship, historical times, history rows and attachments to a staff reader", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    setImportAttachmentDependencies({
      download: async () => ({
        ok: true as const,
        bytes: PNG,
        contentType: "image/png",
      }),
    });
    const run = await createRun(app, f, "readback");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "RB-1", {
        sourceAuthorEmail: "someone.else@example.test",
        sourceAuthorName: "Someone Else",
        sourceCreatedAt: "2021-01-05T09:00:00.000Z",
        comments: [
          {
            sourceId: "rb1-c1",
            authorEmail: "Gone.Person@Example.test",
            authorName: "Gone Person",
            body: "Historic note from a departed colleague",
            createdAt: "2021-02-03T04:05:06.000Z",
          },
        ],
        history: [
          {
            sourceId: "rb1-h1",
            at: "2021-03-04T05:06:07.000Z",
            field: "Severity",
            from: "3 - Medium",
            to: "1 - Critical",
            authorEmail: "Gone.Person@Example.test",
            authorName: "Gone Person",
          },
        ],
        attachments: [
          {
            sourceId: "rb1-a1",
            url: "https://files.source.example.test/spec.png",
            filename: "spec.png",
            mimeType: "image/png",
            authorEmail: "Gone.Person@Example.test",
          },
        ],
      }),
    ]);
    const key = commit.rows[0]?.key as string;
    expect(key).toBeTruthy();
    mockAuthenticatedSession(f.user);

    const detail = await app.request(`/api/work-items/${key}`);
    expect(detail.status, await detail.clone().text()).toBe(200);

    const activity = await app.request(`/api/work-items/${key}/activity`);
    expect(activity.status, await activity.clone().text()).toBe(200);
    const stream = (
      (await activity.json()) as {
        data: Array<Record<string, unknown>>;
      }
    ).data;
    const comment = stream.find((row) => row.kind === "comment");
    expect(comment).toMatchObject({
      actorDisplayName: "Gone Person",
      visibility: "internal",
    });
    expect(new Date(comment?.createdAt as string).toISOString()).toBe(
      "2021-02-03T04:05:06.000Z",
    );
    const history = stream.find((row) => row.field === "Severity");
    expect(history).toMatchObject({
      verb: "updated",
      oldValue: "3 - Medium",
      newValue: "1 - Critical",
    });
    expect(new Date(history?.createdAt as string).toISOString()).toBe(
      "2021-03-04T05:06:07.000Z",
    );
    const created = stream.find((row) => row.verb === "created");
    expect(new Date(created?.createdAt as string).toISOString()).toBe(
      "2021-01-05T09:00:00.000Z",
    );
    expect(stream.find((row) => row.verb === "attachment.added")).toBeTruthy();

    const attachments = await app.request(`/api/work-items/${key}/attachments`);
    expect(attachments.status, await attachments.clone().text()).toBe(200);
    const list = (await attachments.json()) as Array<{
      id: string;
      filename: string;
    }>;
    expect(list).toEqual([expect.objectContaining({ filename: "spec.png" })]);
    const download = await app.request(`/api/attachments/${list[0]?.id}`, {
      redirect: "manual",
    });
    expect(download.status).toBe(302);
    expect(download.headers.get("location")).toContain("/storage/");
  });
});
