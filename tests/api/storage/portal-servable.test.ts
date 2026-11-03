import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAttachmentDownloadUrl,
  createAttachmentUploadUrl,
  createPortalAttachmentDownloadUrl,
  createPortalAttachmentUploadUrl,
  readPortalAttachmentDownloadObject,
  StoragePathError,
  writePortalAttachmentUploadedObject,
} from "../../../apps/api/src/storage/filesystem";
import {
  isPortalStorageRequest,
  portalCanDownloadObject,
} from "../../../apps/api/src/storage/portal-servable";

/**
 * CP-19 (3 November 2026): portal-bound signed links for work-item attachment objects on the
 * filesystem driver. The token binds key, person, size ceiling (upload) and expiry, and never
 * accepts an agent token; the portal host admits each route only for its own key shape.
 */
const WORK_ITEM_KEY = "workspace/ws1/work-item/wi1/attachment/att1/screen.pdf";
const FINAL_KEY =
  "workspace/ws1/work-item/wi1/attachment/att1/final/abc123-screen.pdf";
const SUBMISSION_KEY = "workspace/ws1/submission/sub1/attachment/att2/form.pdf";
const BYTES = "%PDF-1.4\nportal\n%%EOF\n";

function body(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function query(url: string) {
  return Object.fromEntries(new URL(url).searchParams) as Record<
    string,
    string
  >;
}

describe("portal-bound filesystem links (CP-19)", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  const originalAuthSecret = process.env.TASKDESK_AUTH_SECRET;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-portal-links-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    process.env.TASKDESK_AUTH_SECRET = `secret-${Math.random()}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalRoot === undefined)
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    if (originalAuthSecret === undefined)
      delete process.env.TASKDESK_AUTH_SECRET;
    else process.env.TASKDESK_AUTH_SECRET = originalAuthSecret;
    await rm(root, { recursive: true, force: true });
  });

  it("uploads and downloads the same bytes for the person the links were minted for", async () => {
    const upload = createPortalAttachmentUploadUrl(
      WORK_ITEM_KEY,
      "application/pdf",
      1024,
      "person-a",
      "https://portal.example.test/api",
    );
    expect(new URL(upload.uploadUrl).pathname).toBe(
      "/api/storage/portal-attachment-upload",
    );
    const put = query(upload.uploadUrl);
    await writePortalAttachmentUploadedObject({
      key: put.key ?? "",
      maxBytes: put.maxBytes ?? "",
      expires: put.expires ?? "",
      token: put.token ?? "",
      personId: "person-a",
      body: body(BYTES),
    });
    expect(await readFile(path.join(root, WORK_ITEM_KEY), "utf8")).toBe(BYTES);

    const download = query(
      createPortalAttachmentDownloadUrl(
        WORK_ITEM_KEY,
        "screen.pdf",
        "person-a",
        "https://portal.example.test/api",
      ),
    );
    const object = await readPortalAttachmentDownloadObject({
      key: download.key ?? "",
      expires: download.expires ?? "",
      token: download.token ?? "",
      personId: "person-a",
    });
    expect(object.body).toBeTruthy();
  });

  it("refuses another person, another key, a raised ceiling, an expired link and an agent token", async () => {
    const put = query(
      createPortalAttachmentUploadUrl(
        WORK_ITEM_KEY,
        "application/pdf",
        1024,
        "person-a",
        "https://portal.example.test/api",
      ).uploadUrl,
    );
    const write = (overrides: Partial<Record<string, string>>) =>
      writePortalAttachmentUploadedObject({
        key: put.key ?? "",
        maxBytes: put.maxBytes ?? "",
        expires: put.expires ?? "",
        token: put.token ?? "",
        personId: "person-a",
        body: body(BYTES),
        ...overrides,
      });
    await expect(write({ personId: "person-b" })).rejects.toThrow(
      StoragePathError,
    );
    await expect(
      write({ key: "workspace/ws1/work-item/wi1/attachment/att9/other.pdf" }),
    ).rejects.toThrow(StoragePathError);
    await expect(write({ maxBytes: "999999" })).rejects.toThrow(
      StoragePathError,
    );
    // The agent's own upload token for the same key is not a portal credential.
    const agent = query(
      createAttachmentUploadUrl(WORK_ITEM_KEY, "application/pdf", 1024)
        .uploadUrl,
    );
    await expect(
      write({ token: agent.token ?? "", expires: agent.expires ?? "" }),
    ).rejects.toThrow(StoragePathError);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60 * 1000);
    await expect(write({})).rejects.toThrow("Upload URL has expired.");
    vi.restoreAllMocks();

    const download = query(
      createPortalAttachmentDownloadUrl(
        WORK_ITEM_KEY,
        "screen.pdf",
        "person-a",
        "https://portal.example.test/api",
      ),
    );
    const read = (overrides: Partial<Record<string, string>>) =>
      readPortalAttachmentDownloadObject({
        key: download.key ?? "",
        expires: download.expires ?? "",
        token: download.token ?? "",
        personId: "person-a",
        ...overrides,
      });
    await expect(read({ personId: "person-b" })).rejects.toThrow(
      StoragePathError,
    );
    await expect(read({ key: FINAL_KEY })).rejects.toThrow(StoragePathError);
    const agentDownload = query(
      createAttachmentDownloadUrl(WORK_ITEM_KEY, "screen.pdf"),
    );
    await expect(
      read({
        token: agentDownload.token ?? "",
        expires: agentDownload.expires ?? "",
      }),
    ).rejects.toThrow(StoragePathError);
  });

  it("admits each portal-host route only for its own key shape", () => {
    // The generic signed routes: submission keys only.
    expect(
      isPortalStorageRequest(
        "PUT",
        "/api/storage/filesystem-attachment-upload",
        SUBMISSION_KEY,
      ),
    ).toBe(true);
    expect(
      isPortalStorageRequest(
        "PUT",
        "/api/storage/filesystem-attachment-upload",
        WORK_ITEM_KEY,
      ),
    ).toBe(false);
    expect(
      isPortalStorageRequest(
        "GET",
        "/api/storage/filesystem-download",
        FINAL_KEY,
      ),
    ).toBe(false);
    // The portal-bound routes: work-item keys only; uploads never to a finalized key.
    expect(
      isPortalStorageRequest(
        "PUT",
        "/api/storage/portal-attachment-upload",
        WORK_ITEM_KEY,
      ),
    ).toBe(true);
    expect(
      isPortalStorageRequest(
        "PUT",
        "/api/storage/portal-attachment-upload",
        FINAL_KEY,
      ),
    ).toBe(false);
    expect(
      isPortalStorageRequest("GET", "/api/storage/portal-download", FINAL_KEY),
    ).toBe(true);
    expect(
      isPortalStorageRequest(
        "GET",
        "/api/storage/portal-download",
        SUBMISSION_KEY,
      ),
    ).toBe(false);
    expect(
      isPortalStorageRequest(
        "GET",
        "/api/storage/portal-download",
        "workspace/ws1/work-item/../../secret/attachment/a/b.pdf",
      ),
    ).toBe(false);
    expect(
      isPortalStorageRequest("POST", "/api/storage/portal-download", FINAL_KEY),
    ).toBe(false);
    expect(portalCanDownloadObject(FINAL_KEY)).toBe(true);
    expect(portalCanDownloadObject("workspace/ws1/other/thing.pdf")).toBe(
      false,
    );
  });
});
