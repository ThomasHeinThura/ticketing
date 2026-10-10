import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";

const originalAgentUrl = process.env.TASKDESK_AGENT_URL;
const storageDriverEnv = "TASKDESK_STORAGE_DRIVER";
const originalStorageDriver = process.env[storageDriverEnv];
const filesystemRootEnv = "TASKDESK_STORAGE_FILESYSTEM_ROOT";
const originalFilesystemRoot = process.env[filesystemRootEnv];
let filesystemRoot: string;

function restoreAgentUrl() {
  if (originalAgentUrl === undefined) delete process.env.TASKDESK_AGENT_URL;
  else process.env.TASKDESK_AGENT_URL = originalAgentUrl;
}

function restoreStorageDriver() {
  if (originalStorageDriver === undefined) delete process.env[storageDriverEnv];
  else process.env[storageDriverEnv] = originalStorageDriver;
}

function restoreFilesystemRoot() {
  if (originalFilesystemRoot === undefined)
    delete process.env[filesystemRootEnv];
  else process.env[filesystemRootEnv] = originalFilesystemRoot;
}

describe("API integration: task image upload finalize", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    filesystemRoot = await mkdtemp(join(tmpdir(), "taskdesk-task-image-"));
    process.env[filesystemRootEnv] = filesystemRoot;

    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    delete process.env.S3_KEY_PREFIX;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreAgentUrl();
    restoreStorageDriver();
    restoreFilesystemRoot();
    await rm(filesystemRoot, { recursive: true, force: true });
  });

  it("uses the configured HTTPS origin for task image URLs behind internal HTTP", async () => {
    // Match the host captured by the integration auth setup while changing
    // only the public scheme. This models HTTPS at the proxy and internal HTTP.
    process.env.TASKDESK_AGENT_URL = "https://localhost:1337";
    process.env.TASKDESK_STORAGE_DRIVER = "filesystem";

    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "URL test task",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const uploadResponse = await app.request(
      new Request(`http://localhost:1337/api/task/image-upload/${task.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          host: "localhost:1337",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "http",
        },
        body: JSON.stringify({
          filename: "test-image.png",
          contentType: "image/png",
          size: 12345,
          surface: "description",
        }),
      }),
    );
    expect(uploadResponse.status).toBe(200);
    const upload = (await uploadResponse.json()) as { uploadUrl: string };
    expect(upload.uploadUrl).toMatch(
      /^https:\/\/localhost:1337\/api\/storage\/filesystem-upload\?/u,
    );
    expect(upload.uploadUrl.match(/\/api\//gu)).toHaveLength(1);

    const key = `workspace/${member.workspace.id}/project/${project.id}/task/${task.id}/descriptions/test-image.png`;

    const response = await app.request(
      new Request(
        `http://localhost:1337/api/task/image-upload/${task.id}/finalize`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "localhost:1337",
            "x-forwarded-host": "attacker.example",
            "x-forwarded-proto": "http",
          },
          body: JSON.stringify({
            key,
            filename: "test-image.png",
            contentType: "image/png",
            size: 12345,
            surface: "description",
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };
    expect(payload).toHaveProperty("id");
    expect(payload).toHaveProperty("url");
    expect(payload.url).toBe(`https://localhost:1337/api/asset/${payload.id}`);
    expect(payload.url.match(/\/api\//gu)).toHaveLength(1);
  });

  it("does not use a forwarded or spoofed Host value as a public origin", async () => {
    process.env.TASKDESK_AGENT_URL = "https://localhost:1337";
    const { app } = createApp();
    const response = await app.request(
      new Request(
        "http://attacker.example/api/task/image-upload/not-a-task/finalize",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "attacker.example",
            "x-forwarded-host": "localhost:1337",
            "x-forwarded-proto": "https",
          },
          body: JSON.stringify({
            key: "irrelevant",
            filename: "file.png",
            contentType: "image/png",
            size: 1,
            surface: "description",
          }),
        },
      ),
    );
    expect(response.status).toBe(404);
  });

  it("uses the configured public origin when no URL override is set", async () => {
    const configuredAgentUrl = process.env.TASKDESK_AGENT_URL;
    if (!configuredAgentUrl) throw new Error("Missing configured agent URL");
    const agentOrigin = new URL(configuredAgentUrl).origin;

    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "Fallback test",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const key = `workspace/${member.workspace.id}/project/${project.id}/task/${task.id}/descriptions/fallback-image.png`;

    const response = await app.request(
      `${agentOrigin}/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key,
          filename: "fallback-image.png",
          contentType: "image/png",
          size: 12345,
          surface: "description",
        }),
      },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };
    expect(payload.url).toBe(`${agentOrigin}/api/asset/${payload.id}`);
  });

  it("persists a new asset record with correct metadata", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "Persist test",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const key = `workspace/${member.workspace.id}/project/${project.id}/task/${task.id}/descriptions/persist-asset.png`;

    const response = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key,
          filename: "persist-asset.png",
          contentType: "image/png",
          size: 45678,
          surface: "description",
        }),
      },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };

    const asset = await db.query.assetTable.findFirst({
      where: (t, { eq }) => eq(t.id, payload.id),
    });

    expect(asset).toBeDefined();
    expect(asset?.id).toBe(payload.id);
    expect(asset?.objectKey).toBe(key);
    expect(asset?.filename).toBe("persist-asset.png");
    expect(asset?.mimeType).toBe("image/png");
    expect(asset?.size).toBe(45678);
    expect(asset?.kind).toBe("image");
    expect(asset?.surface).toBe("description");
    expect(asset?.workspaceId).toBe(member.workspace.id);
    expect(asset?.projectId).toBe(project.id);
    expect(asset?.taskId).toBe(task.id);
    expect(asset?.createdBy).toBe(member.user.id);
  });

  it("creates attachment records for non-image content types", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "Attachment test",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const key = `workspace/${member.workspace.id}/project/${project.id}/task/${task.id}/descriptions/report.pdf`;

    const response = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key,
          filename: "report.pdf",
          contentType: "application/pdf",
          size: 102400,
          surface: "description",
        }),
      },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };

    const asset = await db.query.assetTable.findFirst({
      where: (t, { eq }) => eq(t.id, payload.id),
    });
    expect(asset?.kind).toBe("attachment");
  });

  it("rejects key that does not match the task context", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "Bad key test",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "totally/wrong/path/image.png",
          filename: "test.png",
          contentType: "image/png",
          size: 100,
          surface: "description",
        }),
      },
    );

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toBe("Image upload key does not match the task context.");
  });

  it("rejects unauthenticated requests", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "Auth test",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "some/key.png",
          filename: "test.png",
          contentType: "image/png",
          size: 100,
          surface: "description",
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("issue #290: answers requests from users outside the workspace with the same 404 an unknown task id gets, not a distinguishing 403", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const outsiderId = `user-${randomUUID()}`;

    const outsider = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: outsiderId,
          email: `${outsiderId}@example.com`,
          emailVerified: true,
          name: "Outsider",
        })
        .returning(),
      "outsider",
    );
    await prepareAuthenticatedApiFixture(outsider.id);

    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "RBAC test",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: `workspace/${member.workspace.id}/project/${project.id}/task/${task.id}/descriptions/rbac-test.png`,
          filename: "rbac-test.png",
          contentType: "image/png",
          size: 100,
          surface: "description",
        }),
      },
    );

    // Before #290, `workspaceAccess.fromTask()` answered 403 for a task that exists in
    // a workspace the caller can't reach, distinguishing it from a nonexistent task
    // (404). It now answers both identically -- see
    // `tests/api/utils/workspace-access-middleware.test.ts` for the helper-level proof.
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Task not found");
  });
});
