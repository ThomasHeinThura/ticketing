import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const origin = "https://ticketing.localhost";
const fixtureKey = "CCY-5";
const stateRoot = path.join(
  os.homedir(),
  "Library/Application Support/TaskDesk/codex-sit-20261025",
);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const artifactRoot = path.join(repoRoot, "docs");
const unsafeMath = String.raw`flowchart TD
  A["$$\href{javascript:alert(1)}{math probe}$$"] --> B["safe node"]
  click B "javascript:alert(2)" "unsafe click probe"`;
const ordinaryDiagram = `flowchart TD
  Start[Persisted diagram] --> Review[Rendered in browser]
  Review --> Done[Safe destination]`;

function markdown(previousDescription: string) {
  const preserved = previousDescription.trim();
  const prefix = preserved ? `${preserved}\n\n` : "";
  return `${prefix}Mermaid runtime compatibility probe.\n\n\`\`\`mermaid\n${ordinaryDiagram}\n\`\`\`\n\n\`\`\`mermaid\n${unsafeMath}\n\`\`\``;
}

async function issueCsrf(page: import("@playwright/test").Page) {
  const issued = await page.request.get(`${origin}/api/me/csrf-token`, {
    headers: { Origin: origin },
  });
  expect(issued.status()).toBe(200);
  const { token } = (await issued.json()) as { token: string };
  expect(token).toBeTruthy();
  return {
    Origin: origin,
    "X-TaskDesk-CSRF": token,
    "X-TaskDesk-Window-Id": randomUUID(),
    "Content-Type": "application/json",
  };
}

test("persisted Mermaid diagrams remain strict and inert in task and comment surfaces", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    storageState: path.join(stateRoot, "lead-state.json"),
    ignoreHTTPSErrors: false,
    locale: "en-US",
    colorScheme: "light",
    viewport: { width: 1440, height: 950 },
  });
  const page = await context.newPage();
  const summary = {
    status: "running",
    tlsVerification: "strict",
    fixture: fixtureKey,
    descriptionRestored: false,
    controlledCommentCreated: false,
    controlledCommentReused: false,
    commentUpdated: false,
    hostileRenderOutcome: "unknown",
    sanitizedRenderError: "none",
    commentData: {
      returnedAsDocument: false,
      containsMermaidCodeBlock: false,
      renderedCodeBlocks: 0,
      renderedPreviews: 0,
      renderedSvgs: 0,
      normalDiagramDone: false,
      renderedPreviewStates: [] as string[],
      codeLanguageClass: "",
      codeContainsFlowchart: false,
    },
    captures: [] as string[],
    ordinaryDiagramRendered: false,
    unsafeDiagramRendered: false,
    unsafePayload: {
      javascriptHrefCount: 0,
      eventHandlerAttributeCount: 0,
      foreignObjectCount: 0,
      probeTextVisible: false,
      mathOutputVisible: false,
    },
    sanitizerBaseline:
      "SVG-only DOMPurify can strip MathML/foreignObject; math display is recorded without weakening sanitization.",
    errors: [] as string[],
  };
  page.on("pageerror", (error) => summary.errors.push(error.name));

  let originalDescription: string | null = null;
  let testDescription: string | null = null;
  let descriptionWriteAttempted = false;
  let descriptionChanged = false;
  let originalPreferences: string | null = null;
  let preferencesCaptured = false;
  let thrownError: unknown;
  try {
    const initial = await page.request.get(
      `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}`,
      { headers: { Origin: origin } },
    );
    expect(initial.status()).toBe(200);
    const item = (await initial.json()) as {
      description?: string | null;
      version: number;
    };
    originalDescription = item.description ?? "";
    testDescription = markdown(originalDescription);
    await page.goto(
      `${origin}/agent/work-items/${encodeURIComponent(fixtureKey)}`,
    );
    originalPreferences = await page.evaluate(() =>
      localStorage.getItem("user-preferences"),
    );
    preferencesCaptured = true;

    descriptionWriteAttempted = true;
    const updated = await page.request.patch(
      `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}`,
      {
        headers: {
          ...(await issueCsrf(page)),
          "If-Match": `"${item.version}"`,
        },
        data: { description: testDescription },
      },
    );
    expect(updated.status(), await updated.text()).toBe(200);
    descriptionChanged = true;
    const persisted = await page.request.get(
      `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}`,
      { headers: { Origin: origin } },
    );
    expect(persisted.status()).toBe(200);
    expect(
      ((await persisted.json()) as { description?: string }).description,
    ).toBe(testDescription);

    await page.goto(
      `${origin}/agent/work-items/${encodeURIComponent(fixtureKey)}`,
    );
    const description = page.getByRole("region", {
      name: "Description",
      exact: true,
    });
    await expect(description).toBeVisible();
    await expect
      .poll(() =>
        description
          .locator(".taskdesk-mermaid-preview[data-state='done']")
          .count(),
      )
      .toBeGreaterThanOrEqual(2);

    const commentDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Controlled Mermaid security probe (Codex runtime check).",
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: ordinaryDiagram }],
        },
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: unsafeMath }],
        },
      ],
    };
    const activity = page.getByTestId("work-item-activity");
    const marker = "Controlled Mermaid security probe (Codex runtime check).";
    if (!(await activity.innerText()).includes(marker)) {
      const commentResponse = await page.request.post(
        `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}/comments`,
        {
          headers: await issueCsrf(page),
          data: { body: commentDocument, visibility: "internal" },
        },
      );
      expect(commentResponse.status(), await commentResponse.text()).toBe(200);
      summary.controlledCommentCreated = true;
    } else {
      summary.controlledCommentReused = true;
    }
    await page.reload();
    await expect(activity).toContainText(marker);

    const activityResponse = await page.request.get(
      `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}/activity?limit=50`,
      { headers: { Origin: origin } },
    );
    expect(activityResponse.status()).toBe(200);
    const activityPage = (await activityResponse.json()) as {
      data: Array<{ body?: unknown; id?: string; kind?: string }>;
    };
    const persistedComment = activityPage.data.find(
      (row) =>
        row.kind === "comment" &&
        (JSON.stringify(row.body ?? null)?.includes(marker) ?? false),
    );
    expect(persistedComment).toBeTruthy();
    expect(persistedComment?.id).toBeTruthy();
    let persistedBody = persistedComment?.body as {
      type?: string;
      content?: Array<{
        type?: string;
        attrs?: { language?: string };
        content?: Array<{ text?: string }>;
      }>;
    };
    const extractMermaidCode = (document: typeof persistedBody) =>
      (document.content ?? [])
        .filter(
          (node) =>
            node.type === "codeBlock" && node.attrs?.language === "mermaid",
        )
        .map((node) =>
          (node.content ?? []).map((part) => part.text ?? "").join(""),
        );
    if (
      !extractMermaidCode(persistedBody).includes(ordinaryDiagram) ||
      !extractMermaidCode(persistedBody).includes(unsafeMath)
    ) {
      if (!persistedComment?.id) {
        throw new Error("The controlled comment id is missing.");
      }
      const updatedComment = await page.request.patch(
        `${origin}/api/comments/${encodeURIComponent(persistedComment.id)}`,
        {
          headers: await issueCsrf(page),
          data: { body: commentDocument },
        },
      );
      expect(updatedComment.status(), await updatedComment.text()).toBe(200);
      summary.commentUpdated = true;
      const updatedActivity = await page.request.get(
        `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}/activity?limit=50`,
        { headers: { Origin: origin } },
      );
      expect(updatedActivity.status()).toBe(200);
      const updatedPage = (await updatedActivity.json()) as {
        data: Array<{ body?: unknown; id?: string; kind?: string }>;
      };
      const updatedRow = updatedPage.data.find(
        (row) => row.kind === "comment" && row.id === persistedComment.id,
      );
      expect(updatedRow).toBeTruthy();
      persistedBody = updatedRow?.body as typeof persistedBody;
      await page.reload();
      await expect(activity).toContainText(marker);
    }
    summary.commentData.returnedAsDocument = persistedBody.type === "doc";
    const mermaidCode = extractMermaidCode(persistedBody);
    summary.commentData.containsMermaidCodeBlock =
      mermaidCode.includes(ordinaryDiagram) && mermaidCode.includes(unsafeMath);
    expect(summary.commentData.returnedAsDocument).toBe(true);
    expect(summary.commentData.containsMermaidCodeBlock).toBe(true);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        const key = "user-preferences";
        const raw = localStorage.getItem(key);
        const current = raw ? JSON.parse(raw) : { state: {} };
        current.state ??= {};
        current.state.theme = nextTheme;
        localStorage.setItem(key, JSON.stringify(current));
      }, theme);
      preferencesCaptured = true;
      await page.reload();
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${theme}\\b`),
      );

      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 950 });
        await expect
          .poll(() =>
            description
              .locator(".taskdesk-mermaid-preview[data-state='done']")
              .count(),
          )
          .toBeGreaterThanOrEqual(2);
        const taskPreviews = description.locator(
          ".taskdesk-mermaid-preview[data-state='done']",
        );
        await expect(
          taskPreviews.filter({ hasText: "Persisted diagram" }),
        ).toHaveCount(1);
        await expect(taskPreviews.filter({ hasText: "safe node" })).toHaveCount(
          1,
        );
        const preview = taskPreviews.first();
        await expect(preview.locator("svg")).toBeVisible();
        const commentArea = page.getByTestId("work-item-activity");
        const taskFilename = `codex-20261025-mermaid-runtime-afterfix-task-${theme}-${width}.png`;
        const taskScreenshotPath = path.join(
          artifactRoot,
          "report/screens",
          taskFilename,
        );
        await mkdir(path.dirname(taskScreenshotPath), { recursive: true });
        await page.screenshot({ path: taskScreenshotPath, fullPage: false });
        summary.captures.push(taskFilename);
        await commentArea.scrollIntoViewIfNeeded();
        const allCommentPreviews = commentArea.locator(
          ".taskdesk-mermaid-preview",
        );
        const normalCommentPreview = allCommentPreviews.filter({
          hasText: "Rendered in browser",
        });
        summary.commentData.renderedCodeBlocks = await commentArea
          .locator(".ProseMirror pre")
          .count();
        summary.commentData.renderedPreviews = await allCommentPreviews.count();
        summary.commentData.renderedSvgs = await commentArea
          .locator(".taskdesk-mermaid-preview svg")
          .count();
        summary.commentData.renderedPreviewStates =
          await allCommentPreviews.evaluateAll((previews) =>
            previews.map((preview) => preview.getAttribute("data-state") ?? ""),
          );
        try {
          await expect
            .poll(
              () => normalCommentPreview.first().getAttribute("data-state"),
              { timeout: 4_000 },
            )
            .toBe("done");
          summary.commentData.normalDiagramDone = true;
          summary.ordinaryDiagramRendered = true;
        } catch {
          // Keep collecting responsive screenshots and sanitized diagnostics.
        }
        summary.commentData.renderedPreviewStates =
          await allCommentPreviews.evaluateAll((previews) =>
            previews.map((preview) => preview.getAttribute("data-state") ?? ""),
          );
        try {
          await expect
            .poll(
              () =>
                page.evaluate(() => {
                  const area = document.querySelector(
                    '[data-testid="work-item-activity"]',
                  );
                  if (!area) return "missing";
                  const previews = [
                    ...area.querySelectorAll<HTMLElement>(
                      ".taskdesk-mermaid-preview",
                    ),
                  ];
                  if (
                    previews.some((entry) =>
                      entry.textContent?.includes("safe node"),
                    )
                  ) {
                    return "rendered";
                  }
                  if (
                    previews.some((entry) => entry.dataset.state === "error")
                  ) {
                    return "error";
                  }
                  if (
                    document.querySelector(
                      '[data-type="error"] [data-slot="toast-description"]',
                    )
                  ) {
                    return "error";
                  }
                  return previews.some(
                    (entry) => entry.dataset.state === "loading",
                  )
                    ? "loading"
                    : "missing";
                }),
              { timeout: 4_000 },
            )
            .toMatch(/^(rendered|error)$/u);
        } catch {
          summary.hostileRenderOutcome = "pending_or_missing";
        }
        const hostileMarkupVisible = await page.evaluate(() => {
          const previews = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="work-item-activity"] .taskdesk-mermaid-preview',
            ),
          ];
          return previews.some((entry) =>
            entry.textContent?.includes("safe node"),
          );
        });
        if (hostileMarkupVisible) {
          summary.hostileRenderOutcome = "rendered_sanitized_or_inert";
        } else if (
          await page
            .locator(
              '[data-testid="work-item-activity"] .taskdesk-mermaid-preview[data-state="error"]',
            )
            .count()
        ) {
          summary.hostileRenderOutcome = "failed_closed";
          summary.sanitizedRenderError = "terminal_error_preview";
        } else if (
          await page
            .locator('[data-type="error"] [data-slot="toast-description"]')
            .count()
        ) {
          summary.hostileRenderOutcome = "failed_closed";
          summary.sanitizedRenderError = "renderer_error_toast_present";
        } else if (summary.hostileRenderOutcome !== "pending_or_missing") {
          summary.hostileRenderOutcome = "failed_closed";
          summary.sanitizedRenderError = "no_error_toast_observed";
        }
        const code = page
          .getByTestId("work-item-activity")
          .locator(".ProseMirror pre code");
        summary.commentData.codeLanguageClass =
          (await code.first().getAttribute("class")) ?? "";
        summary.commentData.codeContainsFlowchart =
          (await code.first().textContent())?.includes("flowchart TD") ?? false;
        const taskDom = await description.evaluate((root) => {
          const previews = [
            ...root.querySelectorAll<HTMLElement>(".taskdesk-mermaid-preview"),
          ];
          const all = previews.flatMap((entry) => [
            ...entry.querySelectorAll("*"),
          ]);
          return {
            svgCount: previews.reduce(
              (sum, entry) => sum + entry.querySelectorAll("svg").length,
              0,
            ),
            normalLabelVisible: previews.some((entry) =>
              entry.textContent?.includes("Persisted diagram"),
            ),
            unsafeDiagramLabelVisible: previews.some((entry) =>
              entry.textContent?.includes("safe node"),
            ),
            hrefs: all.filter((element) =>
              /^(?:javascript|data):/iu.test(
                element.getAttribute("href") ??
                  element.getAttribute("xlink:href") ??
                  "",
              ),
            ).length,
            handlers: all
              .flatMap((element) => [...element.attributes])
              .filter((attribute) => /^on/iu.test(attribute.name)).length,
            foreignObjects: all.filter(
              (element) => element.localName.toLowerCase() === "foreignobject",
            ).length,
            probeTextVisible: previews.some((entry) =>
              entry.innerText.includes("math probe"),
            ),
            mathOutputVisible: previews.some((entry) =>
              entry.querySelector("math, .katex"),
            ),
          };
        });
        const commentDom = await commentArea.evaluate((root) => {
          const previews = [
            ...root.querySelectorAll<HTMLElement>(".taskdesk-mermaid-preview"),
          ];
          const all = previews.flatMap((preview) => [
            ...preview.querySelectorAll("*"),
          ]);
          return {
            hrefs: all.filter((element) =>
              /^(?:javascript|data):/iu.test(
                element.getAttribute("href") ??
                  element.getAttribute("xlink:href") ??
                  "",
              ),
            ).length,
            handlers: all
              .flatMap((element) => [...element.attributes])
              .filter((attribute) => /^on/iu.test(attribute.name)).length,
            foreignObjects: all.filter(
              (element) => element.localName.toLowerCase() === "foreignobject",
            ).length,
            unsafeDiagramLabelVisible: previews.some((preview) =>
              preview.textContent?.includes("safe node"),
            ),
            probeTextVisible: previews.some((preview) =>
              preview.innerText.includes("math probe"),
            ),
            mathOutputVisible: previews.some((preview) =>
              preview.querySelector("math, .katex"),
            ),
          };
        });
        summary.ordinaryDiagramRendered ||= taskDom.normalLabelVisible;
        summary.unsafeDiagramRendered ||=
          taskDom.unsafeDiagramLabelVisible ||
          commentDom.unsafeDiagramLabelVisible;
        summary.unsafePayload.javascriptHrefCount +=
          taskDom.hrefs + commentDom.hrefs;
        summary.unsafePayload.eventHandlerAttributeCount +=
          taskDom.handlers + commentDom.handlers;
        summary.unsafePayload.foreignObjectCount +=
          taskDom.foreignObjects + commentDom.foreignObjects;
        summary.unsafePayload.probeTextVisible ||=
          taskDom.probeTextVisible || commentDom.probeTextVisible;
        summary.unsafePayload.mathOutputVisible ||=
          taskDom.mathOutputVisible || commentDom.mathOutputVisible;

        const filename = `codex-20261025-mermaid-runtime-afterfix-comment-${theme}-${width}.png`;
        const screenshotPath = path.join(
          artifactRoot,
          "report/screens",
          filename,
        );
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: false });
        summary.captures.push(filename);
      }
    }
    // GHSA-238p-pmpm-9mq7: KaTeX must not inherit `trust` from a polluted
    // Object.prototype. Render the persisted `\href{javascript:…}` math through
    // the shipped Mermaid bundle in a page whose prototype is polluted before
    // any application code runs, and require that no javascript: link survives.
    const pollutedPage = await context.newPage();
    try {
      await pollutedPage.addInitScript(() => {
        Object.defineProperty(Object.prototype, "trust", {
          value: true,
          configurable: true,
          writable: true,
        });
      });
      await pollutedPage.goto(
        `${origin}/agent/work-items/${encodeURIComponent(fixtureKey)}`,
      );
      const pollutedDescription = pollutedPage.getByRole("region", {
        name: "Description",
        exact: true,
      });
      await expect(pollutedDescription).toBeVisible();
      await expect
        .poll(() =>
          pollutedDescription
            .locator(".taskdesk-mermaid-preview[data-state='done']")
            .count(),
        )
        .toBeGreaterThanOrEqual(2);
      const polluted = await pollutedPage.evaluate(() => {
        const previews = [
          ...document.querySelectorAll<HTMLElement>(
            ".taskdesk-mermaid-preview",
          ),
        ];
        const all = previews.flatMap((entry) => [
          ...entry.querySelectorAll("*"),
        ]);
        return {
          prototypePolluted:
            (Object.prototype as { trust?: unknown }).trust === true,
          unsafeDiagramRendered: previews.some((entry) =>
            entry.textContent?.includes("safe node"),
          ),
          javascriptHrefs: all.filter((element) =>
            /^\s*javascript:/iu.test(
              element.getAttribute("href") ??
                element.getAttribute("xlink:href") ??
                "",
            ),
          ).length,
        };
      });
      expect(polluted.prototypePolluted).toBe(true);
      expect(polluted.unsafeDiagramRendered).toBe(true);
      expect(polluted.javascriptHrefs).toBe(0);
      summary.unsafePayload.javascriptHrefCount += polluted.javascriptHrefs;
    } finally {
      await pollutedPage.close();
    }

    expect(summary.ordinaryDiagramRendered).toBe(true);
    expect(summary.commentData.normalDiagramDone).toBe(true);
    expect(summary.hostileRenderOutcome).not.toBe("pending_or_missing");
    expect(summary.unsafeDiagramRendered).toBe(true);
    expect(summary.unsafePayload.javascriptHrefCount).toBe(0);
    expect(summary.unsafePayload.eventHandlerAttributeCount).toBe(0);
    expect(summary.unsafePayload.foreignObjectCount).toBe(0);
    summary.status = "passed";
  } catch (error) {
    summary.status = "failed";
    summary.errors.push(error instanceof Error ? error.name : "Error");
    thrownError = error;
  } finally {
    if (
      descriptionWriteAttempted &&
      originalDescription !== null &&
      testDescription !== null
    ) {
      const latest = await page.request.get(
        `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}`,
        { headers: { Origin: origin } },
      );
      if (latest.status() === 200) {
        const current = (await latest.json()) as {
          description?: string | null;
          version: number;
        };
        if ((current.description ?? "") === testDescription) {
          const restored = await page.request.patch(
            `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}`,
            {
              headers: {
                ...(await issueCsrf(page)),
                "If-Match": `"${current.version}"`,
              },
              data: { description: originalDescription },
            },
          );
          summary.descriptionRestored = restored.status() === 200;
          if (summary.descriptionRestored) {
            const verified = await page.request.get(
              `${origin}/api/work-items/${encodeURIComponent(fixtureKey)}`,
              { headers: { Origin: origin } },
            );
            const restoredItem = (await verified.json()) as {
              description?: string | null;
            };
            summary.descriptionRestored =
              verified.status() === 200 &&
              (restoredItem.description ?? "") === originalDescription;
          }
        } else if (
          !descriptionChanged &&
          (current.description ?? "") === originalDescription
        ) {
          // A failed request that left the row untouched needs no restore write.
          summary.descriptionRestored = true;
        } else {
          summary.errors.push(
            "description_changed_concurrently; restoration_skipped",
          );
        }
      }
    }
    if (preferencesCaptured) {
      await page.evaluate((raw) => {
        if (raw === null) localStorage.removeItem("user-preferences");
        else localStorage.setItem("user-preferences", raw);
      }, originalPreferences);
    }
    if (descriptionWriteAttempted && !summary.descriptionRestored) {
      summary.status = "restore_failed";
    }
    await mkdir(path.join(artifactRoot, "report/audit"), { recursive: true });
    await writeFile(
      path.join(
        artifactRoot,
        "report/audit/codex-20261025-mermaid-runtime-afterfix.json",
      ),
      `${JSON.stringify(summary, null, 2)}\n`,
      { mode: 0o600 },
    );
    await context.close();
  }
  if (summary.status === "restore_failed") {
    throw new Error("The CCY-5 description could not be restored exactly.");
  }
  if (thrownError) throw thrownError;
});
