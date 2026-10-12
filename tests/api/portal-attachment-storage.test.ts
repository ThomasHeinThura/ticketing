import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import {
  createAttachmentDownloadUrl,
  createAttachmentUploadUrl,
} from "../../apps/api/src/storage/filesystem";

const PORTAL = "http://portal.localhost:5174";
const PORTAL_HOST = "portal.localhost:5174";
const AGENT = "http://localhost:5173";
const SUBMISSION_KEY =
  "workspace/ws1/submission/sub1/attachment/att1/report.pdf";
const OTHER_SUBMISSION_KEY =
  "workspace/ws1/submission/sub2/attachment/att2/other.pdf";
const WORK_ITEM_KEY = "workspace/ws1/work-item/wi1/attachment/att3/agent.pdf";

describe("portal host admits only portal-submission attachment storage URLs (CP-19)", () => {
  let root: string;
  let previousRoot: string | undefined;

  beforeAll(() => {
    previousRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    root = mkdtempSync(join(tmpdir(), "taskdesk-portal-storage-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
  });
  afterAll(() => {
    if (previousRoot === undefined)
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  const pathOf = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  };
  const put = (
    app: ReturnType<typeof createApp>["app"],
    url: string,
    host = PORTAL_HOST,
    body = "hello",
  ) =>
    app.request(pathOf(url), {
      method: "PUT",
      headers: { host, "content-type": "application/pdf" },
      body,
    });

  it("uploads and downloads a portal submission attachment through the portal origin", async () => {
    const { app } = createApp();
    const upload = createAttachmentUploadUrl(
      SUBMISSION_KEY,
      "application/pdf",
      1024,
      `${PORTAL}/api`,
    );
    const stored = await put(app, upload.uploadUrl);
    expect(stored.status).toBe(204);
    expect(readFileSync(join(root, SUBMISSION_KEY), "utf8")).toBe("hello");

    const download = await app.request(
      pathOf(
        createAttachmentDownloadUrl(
          SUBMISSION_KEY,
          "report.pdf",
          `${PORTAL}/api`,
        ),
      ),
      { headers: { host: PORTAL_HOST } },
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("hello");
  });

  it("keeps the token binding: another key, a larger body and a bad token are refused", async () => {
    const { app } = createApp();
    const upload = createAttachmentUploadUrl(
      SUBMISSION_KEY,
      "application/pdf",
      4,
      `${PORTAL}/api`,
    );
    const swapped = new URL(upload.uploadUrl);
    swapped.searchParams.set("key", OTHER_SUBMISSION_KEY);
    expect((await put(app, swapped.toString())).status).toBe(400);
    expect(existsSync(join(root, OTHER_SUBMISSION_KEY))).toBe(false);

    const tooLarge = await put(app, upload.uploadUrl, PORTAL_HOST, "12345678");
    expect(tooLarge.status).toBe(400);

    const forged = new URL(upload.uploadUrl);
    forged.searchParams.set("token", "x".repeat(43));
    expect((await put(app, forged.toString())).status).toBe(400);
  });

  it("refuses an agent/work-item token and every non-submission key on the portal host", async () => {
    const { app } = createApp();
    const agentToken = createAttachmentUploadUrl(
      WORK_ITEM_KEY,
      "application/pdf",
      1024,
      `${AGENT}/api`,
    );
    // Valid token, wrong host: denied before the handler, nothing written.
    const refused = await put(app, agentToken.uploadUrl);
    expect(refused.status).toBe(404);
    expect(existsSync(join(root, WORK_ITEM_KEY))).toBe(false);
    const download = await app.request(
      pathOf(
        createAttachmentDownloadUrl(WORK_ITEM_KEY, "agent.pdf", `${AGENT}/api`),
      ),
      { headers: { host: PORTAL_HOST } },
    );
    expect(download.status).toBe(404);

    for (const key of [
      "workspace/ws1/submission/sub1/attachment/att1/../../../x.pdf",
      "workspace/ws1/submission/sub1/x.pdf",
      "other/key.pdf",
    ]) {
      const url = createAttachmentUploadUrl(
        key,
        "application/pdf",
        1024,
        `${PORTAL}/api`,
      );
      expect((await put(app, url.uploadUrl)).status, key).toBe(404);
    }
  });

  it("keeps the rest of the storage surface and the agent host unchanged", async () => {
    const { app } = createApp();
    const upload = createAttachmentUploadUrl(
      SUBMISSION_KEY,
      "application/pdf",
      1024,
      `${PORTAL}/api`,
    );
    // Wrong method on the upload path, and the task-image upload route, stay denied.
    const wrongMethod = await app.request(pathOf(upload.uploadUrl), {
      method: "GET",
      headers: { host: PORTAL_HOST },
    });
    expect(wrongMethod.status).toBe(404);
    const taskImage = await app.request(
      "/api/storage/filesystem-upload?key=a",
      {
        method: "PUT",
        headers: { host: PORTAL_HOST },
        body: "x",
      },
    );
    expect(taskImage.status).toBe(404);
    // The agent host still accepts a valid agent token as before.
    const agent = createAttachmentUploadUrl(
      WORK_ITEM_KEY,
      "application/pdf",
      1024,
      `${AGENT}/api`,
    );
    expect((await put(app, agent.uploadUrl, "localhost:5173")).status).toBe(
      204,
    );
  });

  it("uploads the way the portal page does (plain fetch, File body, image/png) once a storage root exists", async () => {
    const { app } = createApp();
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const file = new File([png], "evidence.png", { type: "image/png" });
    const key = "workspace/ws1/submission/sub1/attachment/att9/evidence.png";
    const signed = createAttachmentUploadUrl(
      key,
      file.type,
      1_000_000,
      `${PORTAL}/api`,
    );
    const clientPut = () =>
      app.request(pathOf(signed.uploadUrl), {
        method: "PUT",
        headers: {
          host: PORTAL_HOST,
          origin: PORTAL,
          cookie: "__Host-tdk_portal_session=signed",
          ...signed.headers,
        },
        body: file,
      });

    const ok = await clientPut();
    expect(ok.status).toBe(204);
    expect(new Uint8Array(readFileSync(join(root, key)))).toEqual(png);

    // A host-run API without TASKDESK_STORAGE_FILESYSTEM_ROOT falls back to the Docker
    // path /app/data/attachments; the missing root surfaces as the generic 400 the real
    // browser run saw. The e2e fixture must therefore always provide a writable root.
    const configured = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = join(root, "does-not-exist");
    try {
      const missingRoot = await clientPut();
      expect(missingRoot.status).toBe(400);
      expect(await missingRoot.text()).toBe("Upload failed.");
    } finally {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = configured;
    }
  });
});
