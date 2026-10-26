import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type BrowserContext,
  expect,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";

const agentOrigin = "https://ticketing.localhost";
const portalOrigin = "https://portal.localhost";
const workspaceId = "vjsgsgt7jrlia8sln5j3rzhm";
const projectId = "y8onxgpl4vd25fsgq4dnc2fp";
const projectKey = "CCY";
const itemKey = "CCY-1";
const workspaceName = "Codex Cost Cycle 20261025";
const projectName = "Cost Cycle QA";
const stateRoot = path.join(
  os.homedir(),
  "Library/Application Support/TaskDesk/codex-sit-20261025",
);
const maxPdfBytes = 25 * 1024 * 1024;

type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  state: string;
};
type AppTheme = "light" | "dark";
type CanvasSnapshot = {
  width: number;
  height: number;
  opaqueRatio: number;
  whiteRatio: number;
  inkPixels: number;
  checksum: number;
};
type CanvasDiagnostic = {
  width: number;
  theme: AppTheme;
  before: CanvasSnapshot;
  after: CanvasSnapshot;
  composedScreenshot: {
    attempts: number;
    whiteRatio: number;
    inkPixels: number;
    canvasBounds: { x: number; y: number; width: number; height: number };
  };
};

const userPreferencesKey = "user-preferences";

async function getAppThemePreference(page: Page) {
  return page.evaluate(
    (key) => window.localStorage.getItem(key),
    userPreferencesKey,
  );
}

async function setAppThemePreference(page: Page, theme: AppTheme) {
  await page.evaluate(
    ({ key, nextTheme }) => {
      const raw = window.localStorage.getItem(key);
      const stored = raw
        ? (JSON.parse(raw) as { state?: Record<string, unknown> })
        : { state: {} };
      if (!stored.state || typeof stored.state !== "object")
        throw new Error("Persisted user preferences are not an object.");
      stored.state.theme = nextTheme;
      window.localStorage.setItem(key, JSON.stringify(stored));
    },
    { key: userPreferencesKey, nextTheme: theme },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate(
          (root, expectedTheme) => root.classList.contains(expectedTheme),
          theme,
        ),
    )
    .toBe(true);
  const applied = await page.locator("html").evaluate((root) => ({
    lightClass: root.classList.contains("light"),
    darkClass: root.classList.contains("dark"),
    backgroundToken: getComputedStyle(root)
      .getPropertyValue("--background")
      .trim(),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  }));
  const classApplied =
    theme === "light" ? applied.lightClass : applied.darkClass;
  if (
    !classApplied ||
    !applied.backgroundToken ||
    applied.bodyBackground === "rgba(0, 0, 0, 0)"
  ) {
    throw new Error(`The persisted ${theme} app theme did not apply.`);
  }
  return applied;
}

async function restoreAppThemePreference(page: Page, raw: string | null) {
  await page.evaluate(
    ({ key, original }) => {
      if (original === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, original);
    },
    { key: userPreferencesKey, original: raw },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  return (await getAppThemePreference(page)) === raw;
}

async function ensureAttachmentPanel(page: Page) {
  const panel = page.getByTestId("work-item-attachments");
  const disclosure = page.getByRole("button", {
    name: "Attachments",
    exact: true,
  });
  if ((await disclosure.getAttribute("aria-expanded")) !== "true")
    await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
}

async function waitForRenderedPdf(frame: ReturnType<Page["frame"]>) {
  if (!frame) throw new Error("Sandboxed PDF frame was not found.");
  return frame.evaluate(async () => {
    const canvas = document.getElementById("pdf-page");
    if (!(canvas instanceof HTMLCanvasElement))
      throw new Error("PDF renderer canvas was not found.");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("PDF renderer canvas has no 2D context.");

    const sample = () => {
      if (canvas.width < 1 || canvas.height < 1) return null;
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let opaquePixels = 0;
      let whitePixels = 0;
      let inkPixels = 0;
      let checksum = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 255;
        const green = pixels[index + 1] ?? 255;
        const blue = pixels[index + 2] ?? 255;
        const alpha = pixels[index + 3] ?? 0;
        if (alpha > 200) {
          opaquePixels += 1;
          if (red > 245 && green > 245 && blue > 245) whitePixels += 1;
          if (red < 180 && green < 180 && blue < 180) inkPixels += 1;
        }
        checksum = (checksum * 31 + red * 3 + green * 5 + blue * 7) >>> 0;
      }
      const totalPixels = canvas.width * canvas.height;
      return {
        width: canvas.width,
        height: canvas.height,
        opaqueRatio: opaquePixels / totalPixels,
        whiteRatio: opaquePixels ? whitePixels / opaquePixels : 0,
        inkPixels,
        checksum,
      };
    };

    let previous: ReturnType<typeof sample> = null;
    let stableFrames = 0;
    let frames = 0;
    while (true) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      frames += 1;
      const current = sample();
      if (
        current &&
        current.opaqueRatio >= 0.85 &&
        current.whiteRatio >= 0.9 &&
        current.inkPixels >= 20 &&
        previous?.checksum === current.checksum
      ) {
        stableFrames += 1;
        if (stableFrames >= 2)
          return {
            ...current,
            canvasDataUrl: canvas.toDataURL("image/png"),
          };
      } else {
        stableFrames = 0;
      }
      previous = current;
      if (frames >= 1200)
        throw new Error(
          "PDF page pixels did not become visibly rendered and stable.",
        );
    }
  });
}

async function inspectComposedScreenshot(
  page: Page,
  screenshot: Buffer,
  canvasBounds: { x: number; y: number; width: number; height: number },
) {
  return page.evaluate(
    async ({ imageDataUrl, bounds }) => {
      const image = new Image();
      image.src = imageDataUrl;
      await image.decode();
      const scaleX = image.naturalWidth / window.innerWidth;
      const scaleY = image.naturalHeight / window.innerHeight;
      const left = Math.max(0, Math.floor(bounds.x * scaleX));
      const top = Math.max(0, Math.floor(bounds.y * scaleY));
      const right = Math.min(
        image.naturalWidth,
        Math.ceil((bounds.x + bounds.width) * scaleX),
      );
      const bottom = Math.min(
        image.naturalHeight,
        Math.ceil((bounds.y + bounds.height) * scaleY),
      );
      const sample = document.createElement("canvas");
      sample.width = right - left;
      sample.height = bottom - top;
      const context = sample.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Screenshot pixel inspection failed.");
      context.drawImage(
        image,
        left,
        top,
        sample.width,
        sample.height,
        0,
        0,
        sample.width,
        sample.height,
      );
      const pixels = context.getImageData(
        0,
        0,
        sample.width,
        sample.height,
      ).data;
      let white = 0;
      let ink = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        if (red > 245 && green > 245 && blue > 245) white += 1;
        if (red < 180 && green < 180 && blue < 180) ink += 1;
      }
      const totalPixels = sample.width * sample.height;
      return { whiteRatio: white / totalPixels, inkPixels: ink };
    },
    {
      imageDataUrl: `data:image/png;base64,${screenshot.toString("base64")}`,
      bounds: canvasBounds,
    },
  );
}

async function capturePdfPreviewScreen(
  page: Page,
  frame: ReturnType<Page["frame"]>,
  testInfo: TestInfo,
  name: string,
) {
  const canvas = await waitForRenderedPdf(frame);
  const frameBounds = await page.locator("iframe").boundingBox();
  const canvasBounds = await frame?.evaluate(() => {
    const element = document.getElementById("pdf-page");
    if (!(element instanceof HTMLCanvasElement))
      throw new Error("PDF renderer canvas was not found.");
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (!frameBounds || !canvasBounds)
    throw new Error("PDF screenshot geometry was not available.");
  const screenshotBounds = {
    x: frameBounds.x + canvasBounds.x,
    y: frameBounds.y + canvasBounds.y,
    width: canvasBounds.width,
    height: canvasBounds.height,
  };
  const path = testInfo.outputPath(`${name}.png`);
  let screenshot: Buffer | null = null;
  let pixels: { whiteRatio: number; inkPixels: number } | null = null;
  let attempts = 0;
  while (attempts < 8) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    screenshot = await page.screenshot({ path, fullPage: false });
    attempts += 1;
    pixels = await inspectComposedScreenshot(
      page,
      screenshot,
      screenshotBounds,
    );
    if (pixels.inkPixels >= 20 && pixels.whiteRatio >= 0.9) break;
  }
  if (
    !screenshot ||
    !pixels ||
    pixels.inkPixels < 20 ||
    pixels.whiteRatio < 0.9
  )
    throw new Error(
      "PDF preview screenshot did not include rendered page pixels.",
    );
  await testInfo.attach(name, { path, contentType: "image/png" });
  return { path, attempts, canvasInkPixels: canvas.inkPixels, ...pixels };
}

function twoPagePdf() {
  const contents = [
    "BT /F1 18 Tf 48 110 Td (AT9 preview first page) Tj ET",
    "BT /F1 18 Tf 48 110 Td (AT9 preview second page) Tj ET",
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(contents[0] ?? "")} >>\nstream\n${contents[0]}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${Buffer.byteLength(contents[1] ?? "")} >>\nstream\n${contents[1]}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    document += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document, "utf8");
}

function macroFreeDocx() {
  const entries = [
    {
      name: "[Content_Types].xml",
      contents:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      contents:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/document.xml",
      contents:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>TaskDesk DOCX download fallback fixture.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
    },
  ].map((entry) => ({
    name: Buffer.from(entry.name, "utf8"),
    contents: Buffer.from(entry.contents, "utf8"),
  }));
  const crc32 = (contents: Buffer) => {
    let checksum = 0xffffffff;
    for (const byte of contents) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit += 1)
        checksum = (checksum >>> 1) ^ (-(checksum & 1) & 0xedb88320);
    }
    return (checksum ^ 0xffffffff) >>> 0;
  };
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const checksum = crc32(entry.contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.contents.byteLength, 18);
    local.writeUInt32LE(entry.contents.byteLength, 22);
    local.writeUInt16LE(entry.name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, entry.name, entry.contents);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.contents.byteLength, 20);
    central.writeUInt32LE(entry.contents.byteLength, 24);
    central.writeUInt16LE(entry.name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, entry.name);
    localOffset +=
      local.byteLength + entry.name.byteLength + entry.contents.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function readJson<T>(
  response: Awaited<ReturnType<BrowserContext["request"]["get"]>>,
  label: string,
) {
  if (!response.ok())
    throw new Error(`${label} returned HTTP ${response.status()}`);
  return (await response.json()) as T;
}

async function safeGet(context: BrowserContext, url: string, label: string) {
  try {
    return await context.request.get(url);
  } catch {
    throw new Error(`${label} request failed before receiving a response.`);
  }
}

async function verifyOwnedFixture(context: BrowserContext) {
  const workspaces = await readJson<
    Array<{ id: string; name: string; role: string }>
  >(
    await safeGet(
      context,
      `${agentOrigin}/api/workspace`,
      "Lead workspace list read",
    ),
    "Lead workspace list read",
  );
  if (!workspaces.some((workspace) => workspace.id === workspaceId))
    throw new Error(
      `Lead browser session does not have the owned CCY workspace in its workspace list (count: ${workspaces.length}).`,
    );

  const project = await readJson<{
    id: string;
    workspaceId: string;
    slug: string;
    name: string;
  }>(
    await safeGet(
      context,
      `${agentOrigin}/api/project/${projectId}`,
      "Owned project read",
    ),
    "Owned project read",
  );
  if (
    project.id !== projectId ||
    project.workspaceId !== workspaceId ||
    project.slug !== projectKey ||
    project.name !== projectName
  ) {
    throw new Error(
      "Existing lead state does not own the expected CCY project.",
    );
  }

  const item = await readJson<{
    id: string;
    projectId: string;
    key: string;
    title: string;
    stateId: string;
    priority: string | null;
    assigneeId: string | null;
    customerVisibility: string;
    version: number;
  }>(
    await safeGet(
      context,
      `${agentOrigin}/api/work-items/${itemKey}`,
      "Owned work item read",
    ),
    "Owned work item read",
  );
  if (item.projectId !== projectId || item.key !== itemKey) {
    throw new Error(
      "Existing lead state cannot reach the expected CCY work item.",
    );
  }
  const rows = await readJson<AttachmentRow[]>(
    await safeGet(
      context,
      `${agentOrigin}/api/work-items/${itemKey}/attachments`,
      "Attachment list read",
    ),
    "Attachment list read",
  );
  return { item, rows };
}

async function switchWorkspace(page: Page, targetName: string) {
  const activeButton = page.getByRole("button", {
    name: /TaskDesk Service Desk|Codex Cost Cycle 20261025/,
  });
  if (!(await activeButton.isVisible()))
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await activeButton.waitFor({ state: "visible" });
  const activeText = (await activeButton.innerText()).trim();
  if (activeText.includes(targetName)) return activeText;
  await activeButton.click();
  await page.getByRole("menuitem", { name: targetName, exact: true }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(targetName) }),
  ).toBeVisible();
  return activeText;
}

async function openOwnedWorkItem(
  page: Page,
  rememberStartingWorkspace: (name: string) => void,
) {
  await page.goto(`${agentOrigin}/agent`, {
    waitUntil: "domcontentloaded",
  });
  const startingWorkspace = await switchWorkspace(page, workspaceName);
  rememberStartingWorkspace(startingWorkspace);
  await page.goto(
    `${agentOrigin}/agent/projects/${projectKey}/work?layout=list&sort=position&dir=asc`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  const link = page.locator(`a[href="/agent/work-items/${itemKey}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  const dialog = page.getByRole("dialog", { name: `Work item ${itemKey}` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("link", { name: "Open full page" }).click();
  await page.getByRole("button", { name: "Attachments", exact: true }).click();
  await expect(page.getByTestId("work-item-attachments")).toBeVisible();
}

async function captureResponsiveStates(
  page: Page,
  testInfo: TestInfo,
  filename: string,
  captures: string[],
  themeChecks: Array<{
    width: number;
    theme: AppTheme;
    htmlThemeClass: string;
    backgroundToken: string;
    bodyBackground: string;
  }>,
  canvasDiagnostics: CanvasDiagnostic[],
) {
  const cases = [
    { width: 375, theme: "light" as const },
    { width: 390, theme: "light" as const },
    { width: 768, theme: "light" as const },
    { width: 1440, theme: "light" as const },
    { width: 375, theme: "dark" as const },
    { width: 390, theme: "dark" as const },
    { width: 768, theme: "dark" as const },
    { width: 1440, theme: "dark" as const },
  ];
  const colorsByTheme = new Map<AppTheme, string>();
  const captureId = Date.now().toString(36);
  for (const { width, theme } of cases) {
    await page.setViewportSize({ width, height: 900 });
    const applied = await setAppThemePreference(page, theme);
    themeChecks.push({
      width,
      theme,
      htmlThemeClass: theme,
      backgroundToken: applied.backgroundToken,
      bodyBackground: applied.bodyBackground,
    });
    const previousColor = colorsByTheme.get(theme);
    if (previousColor && previousColor !== applied.bodyBackground)
      throw new Error(`The ${theme} app background changed between viewports.`);
    colorsByTheme.set(theme, applied.bodyBackground);
    if (
      colorsByTheme.has("light") &&
      colorsByTheme.has("dark") &&
      colorsByTheme.get("light") === colorsByTheme.get("dark")
    )
      throw new Error("Light and dark app body colors are identical.");
    await ensureAttachmentPanel(page);
    await page.getByRole("button", { name: `Preview ${filename}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Page 1 of 2", { exact: true }),
    ).toBeVisible();
    const renderedFrame = page.frame({
      url: `${agentOrigin}/pdf-preview.html`,
    });
    const renderedPage = await waitForRenderedPdf(renderedFrame);
    if (renderedPage.inkPixels < 20)
      throw new Error("PDF canvas did not contain rendered page content.");
    const canvasPng = renderedPage.canvasDataUrl.split(",")[1];
    if (!canvasPng) throw new Error("PDF canvas PNG could not be captured.");
    const canvasPath = testInfo.outputPath(
      `pdf-canvas-${captureId}-${theme}-${width}.png`,
    );
    await renderedFrame?.locator("#pdf-page").screenshot({ path: canvasPath });
    await testInfo.attach(`pdf-canvas-${theme}-${width}`, {
      path: canvasPath,
      contentType: "image/png",
    });
    for (const name of [
      "Previous page",
      "Next page",
      "Zoom out",
      "Zoom in",
      "Close preview",
    ])
      await expect(dialog.getByRole("button", { name })).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: `Download ${filename}` }),
    ).toBeVisible();
    const headerLayout = await dialog
      .getByText(filename, { exact: true })
      .evaluate((filenameElement) => {
        const header = filenameElement.parentElement;
        const toolbar = header?.children[1];
        if (!header || !(toolbar instanceof HTMLElement))
          throw new Error("PDF preview header layout was not found.");
        const titleRect = filenameElement.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        const titleStyle = getComputedStyle(filenameElement);
        return {
          filename: filenameElement.textContent,
          titleWidth: titleRect.width,
          titleScrollWidth: filenameElement.scrollWidth,
          titleClientWidth: filenameElement.clientWidth,
          titleTextOverflow: titleStyle.textOverflow,
          titleWhiteSpace: titleStyle.whiteSpace,
          headerWidth: headerRect.width,
          titleBottom: titleRect.bottom,
          toolbarTop: toolbarRect.top,
          toolbarRight: toolbarRect.right,
          headerRight: headerRect.right,
        };
      });
    if (
      headerLayout.filename !== filename ||
      ((width === 375 || width === 390) &&
        (headerLayout.titleWidth < headerLayout.headerWidth - 20 ||
          headerLayout.toolbarTop < headerLayout.titleBottom ||
          headerLayout.titleScrollWidth > headerLayout.titleClientWidth + 1 ||
          headerLayout.titleTextOverflow === "ellipsis" ||
          headerLayout.titleWhiteSpace === "nowrap")) ||
      headerLayout.toolbarRight > headerLayout.headerRight + 1
    ) {
      throw new Error(
        "PDF preview title or controls are clipped at this width.",
      );
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    const path = testInfo.outputPath(
      `pdf-preview-${captureId}-${theme}-${width}.png`,
    );
    const frameBounds = await page.locator("iframe").boundingBox();
    if (!frameBounds) throw new Error("PDF frame bounds were not available.");
    const canvasBounds = await renderedFrame?.evaluate(() => {
      const canvas = document.getElementById("pdf-page");
      if (!(canvas instanceof HTMLCanvasElement))
        throw new Error("PDF renderer canvas was not found.");
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
    if (!canvasBounds) throw new Error("PDF canvas bounds were not available.");
    const composedCanvasBounds = {
      x: frameBounds.x + canvasBounds.x,
      y: frameBounds.y + canvasBounds.y,
      width: canvasBounds.width,
      height: canvasBounds.height,
    };
    let screenshot: Buffer | null = null;
    let composedScreenshot: {
      whiteRatio: number;
      inkPixels: number;
    } | null = null;
    let attempts = 0;
    while (attempts < 8) {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      screenshot = await page.screenshot({ path, fullPage: false });
      attempts += 1;
      composedScreenshot = await inspectComposedScreenshot(
        page,
        screenshot,
        composedCanvasBounds,
      );
      if (
        composedScreenshot.inkPixels >= 20 &&
        composedScreenshot.whiteRatio >= 0.9
      )
        break;
    }
    if (
      !screenshot ||
      !composedScreenshot ||
      composedScreenshot.inkPixels < 20 ||
      composedScreenshot.whiteRatio < 0.9
    )
      throw new Error(
        "Composed screenshot omitted the visibly rendered PDF canvas.",
      );
    const afterScreenshot = await waitForRenderedPdf(renderedFrame);
    canvasDiagnostics.push({
      width,
      theme,
      before: {
        width: renderedPage.width,
        height: renderedPage.height,
        opaqueRatio: renderedPage.opaqueRatio,
        whiteRatio: renderedPage.whiteRatio,
        inkPixels: renderedPage.inkPixels,
        checksum: renderedPage.checksum,
      },
      after: {
        width: afterScreenshot.width,
        height: afterScreenshot.height,
        opaqueRatio: afterScreenshot.opaqueRatio,
        whiteRatio: afterScreenshot.whiteRatio,
        inkPixels: afterScreenshot.inkPixels,
        checksum: afterScreenshot.checksum,
      },
      composedScreenshot: {
        attempts,
        whiteRatio: composedScreenshot.whiteRatio,
        inkPixels: composedScreenshot.inkPixels,
        canvasBounds: composedCanvasBounds,
      },
    });
    if (afterScreenshot.checksum !== renderedPage.checksum)
      throw new Error("PDF canvas pixels changed during screenshot capture.");
    if (width === 390 && theme === "dark") {
      const animationDisabledPath = testInfo.outputPath(
        `pdf-preview-${captureId}-dark-390-animations-disabled.png`,
      );
      await page.screenshot({
        path: animationDisabledPath,
        fullPage: false,
        animations: "disabled",
      });
      await testInfo.attach(
        `pdf-preview-${captureId}-dark-390-animations-disabled`,
        {
          path: animationDisabledPath,
          contentType: "image/png",
        },
      );
    }
    await testInfo.attach(`pdf-preview-${theme}-${width}`, {
      path,
      contentType: "image/png",
    });
    captures.push(`${theme}-${width}`);
    await dialog.getByRole("button", { name: "Close preview" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
}

test("real PDF preview stays sandboxed and preserves attachment reach", async ({
  browser,
}, testInfo) => {
  const leadState = path.join(stateRoot, "lead-state.json");
  const leadContext = await browser.newContext({
    storageState: leadState,
    acceptDownloads: true,
    ignoreHTTPSErrors: false,
    locale: "en-US",
    colorScheme: "light",
    viewport: { width: 1440, height: 900 },
  });
  const summary = {
    stage: "starting",
    strictTls: true,
    fixture: { workspace: workspaceName, project: projectKey, item: itemKey },
    workspace: { starting: null as string | null, restored: false },
    mutation: "reuse one existing PDF attachment on the owned fixture item",
    preview: {
      renderedPages: 0,
      zoomChanged: false,
      canvasCentered: false,
      downloadFallback: false,
    },
    downloadDiagnostics: {
      apiRequestSeen: false,
      apiResponseStatus: null as number | null,
      redirectLocationPresent: false,
      storageResponseStatus: null as number | null,
      attachmentDisposition: false,
      downloadEvent: false,
      downloadFilenameMatched: false,
    },
    sandbox: {
      attribute: false,
      opaqueOrigin: false,
      cookieReadable: null as boolean | null,
      storageReadable: null as boolean | null,
      parentDomReadable: null as boolean | null,
      apiFetchBlocked: null as boolean | null,
      rendererAssetCredentialsAbsent: false,
      rendererAssetsUsedNullOrigin: false,
      rendererApiRequests: 0,
    },
    authorization: {
      leadPreviewStatus: 0,
      viewerPreviewStatus: null as number | null,
      customerOwnSubmissionPdf: "not_checked",
      customerForeignPreviewStatus: null as number | null,
      staffTriagePdfPreviewStatus: null as number | null,
    },
    persisted: {
      oneOwnedPdfFixture: false,
      uploadPerformedThisRun: false,
      workItemFieldsUnchanged: false,
      reloadShowsPdf: false,
    },
    officeFallback: {
      attachmentReady: false,
      pdfPreviewActionAbsent: false,
      downloadEvent: false,
      downloadFilenameMatched: false,
      downloadedBytesMatched: false,
      screenshots: [] as string[],
    },
    customerAndTriageCaptures: [] as string[],
    appThemePreferenceRestored: false,
    closeAbort: {
      interceptedRequestStarted: false,
      dialogClosed: false,
      noLateFailure: false,
    },
    responsiveCaptures: [] as string[],
    canvasDiagnostics: [] as CanvasDiagnostic[],
    themeChecks: [] as Array<{
      width: number;
      theme: AppTheme;
      htmlThemeClass: string;
      backgroundToken: string;
      bodyBackground: string;
    }>,
    kaneoParity:
      "Existing @taskdesk/ui Dialog and Button components frame the canvas-only PDF.js child; the existing file card and download action remain.",
    sanitizedErrors: [] as string[],
  };

  const seenRendererAssets: Array<{
    extension: string;
    origin: string | null;
    cookie: boolean;
    authorization: boolean;
  }> = [];
  const rendererAssetHeaderReads: Promise<void>[] = [];
  const seenViewerApiRequests: string[] = [];
  const page = await leadContext.newPage();
  let startingWorkspace: string | null = null;
  let originalPreferencesRaw: string | null = null;
  let originalPreferencesCaptured = false;
  let viewerFrame: ReturnType<Page["frame"]> | null = null;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/assets/pdf-preview/")) {
      if (
        url.pathname.startsWith("/api/") &&
        viewerFrame &&
        request.frame() === viewerFrame
      )
        seenViewerApiRequests.push(url.pathname);
      return;
    }
    if (request.frame().url() !== `${agentOrigin}/pdf-preview.html`) return;
    rendererAssetHeaderReads.push(
      request.allHeaders().then((headers) => {
        seenRendererAssets.push({
          extension: path.extname(url.pathname),
          origin: headers.origin ?? null,
          cookie: Boolean(headers.cookie),
          authorization: Boolean(headers.authorization),
        });
      }),
    );
  });
  page.on("pageerror", (error) => summary.sanitizedErrors.push(error.name));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (/^\/api\/attachments\/[^/]+$/u.test(url.pathname)) {
      summary.downloadDiagnostics.apiResponseStatus = response.status();
      void response.allHeaders().then((headers) => {
        summary.downloadDiagnostics.redirectLocationPresent = Boolean(
          headers.location,
        );
      });
    } else if (url.pathname === "/api/storage/filesystem-download") {
      summary.downloadDiagnostics.storageResponseStatus = response.status();
      void response.allHeaders().then((headers) => {
        summary.downloadDiagnostics.attachmentDisposition =
          headers["content-disposition"]?.startsWith("attachment") ?? false;
      });
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/attachments\/[^/]+$/u.test(url.pathname))
      summary.downloadDiagnostics.apiRequestSeen = true;
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      summary.sanitizedErrors.push(
        message.text().includes("Content Security Policy")
          ? "csp"
          : "console_error",
      );
  });

  try {
    const sessionResponse = await safeGet(
      leadContext,
      `${agentOrigin}/api/auth/get-session`,
      "Lead browser session preflight",
    );
    if (!sessionResponse.ok())
      throw new Error("Lead browser session preflight failed.");
    const before = await verifyOwnedFixture(leadContext);
    summary.stage = "fixture_verified";
    const pdf = twoPagePdf();
    if (pdf.byteLength > maxPdfBytes)
      throw new Error("The generated PDF exceeds the preview bound.");
    const ownedPdfRows = before.rows.filter((row) =>
      row.filename.startsWith("Codex AT9 PDF preview "),
    );
    if (ownedPdfRows.length > 1)
      throw new Error(
        "More than one owned PDF fixture exists; stopping safely.",
      );
    const existingPdf = ownedPdfRows[0];
    if (!existingPdf)
      throw new Error(
        "The existing owned PDF fixture is missing; no upload attempted.",
      );
    if (
      existingPdf &&
      (existingPdf.mimeType !== "application/pdf" ||
        existingPdf.size !== pdf.byteLength ||
        existingPdf.state !== "ready")
    )
      throw new Error(
        "The existing owned PDF fixture does not match expected metadata.",
      );
    const filename = existingPdf.filename;

    await openOwnedWorkItem(page, (name) => {
      startingWorkspace = name;
      summary.workspace.starting = name;
    });
    originalPreferencesRaw = await getAppThemePreference(page);
    originalPreferencesCaptured = true;
    summary.stage = "work_item_opened";
    await expect(page.getByRole("link", { name: filename })).toBeVisible({
      timeout: 30_000,
    });

    const afterUpload = await verifyOwnedFixture(leadContext);
    const fixtureRows = afterUpload.rows.filter(
      (row) => row.filename === filename,
    );
    if (
      fixtureRows.length !== 1 ||
      fixtureRows[0]?.mimeType !== "application/pdf" ||
      fixtureRows[0]?.size !== pdf.byteLength ||
      fixtureRows[0]?.state !== "ready" ||
      fixtureRows[0]?.id !== existingPdf.id
    ) {
      throw new Error(
        "The owned fixture does not contain exactly one matching ready PDF.",
      );
    }
    summary.persisted.oneOwnedPdfFixture = true;
    summary.persisted.workItemFieldsUnchanged =
      before.item.title === afterUpload.item.title &&
      before.item.stateId === afterUpload.item.stateId &&
      before.item.priority === afterUpload.item.priority &&
      before.item.assigneeId === afterUpload.item.assigneeId &&
      before.item.customerVisibility === afterUpload.item.customerVisibility &&
      before.item.version === afterUpload.item.version;
    if (!summary.persisted.workItemFieldsUnchanged)
      throw new Error("The upload changed unrelated work item metadata.");

    const pdfRow = fixtureRows[0];
    if (!pdfRow) throw new Error("The owned PDF row is missing.");
    const directPreview = await safeGet(
      leadContext,
      `${agentOrigin}/api/attachments/${encodeURIComponent(pdfRow.id)}/preview`,
      "Lead PDF preview",
    );
    summary.authorization.leadPreviewStatus = directPreview.status();
    if (directPreview.status() !== 200)
      throw new Error("The lead could not read the owned PDF preview route.");
    await directPreview.dispose();

    const viewerContext = await browser.newContext({
      storageState: path.join(stateRoot, "viewer-state.json"),
      ignoreHTTPSErrors: false,
    });
    try {
      const viewerResponse = await safeGet(
        viewerContext,
        `${agentOrigin}/api/attachments/${encodeURIComponent(pdfRow.id)}/preview`,
        "Viewer PDF preview denial",
      );
      summary.authorization.viewerPreviewStatus = viewerResponse.status();
      await viewerResponse.dispose();
      if (![403, 404].includes(summary.authorization.viewerPreviewStatus))
        throw new Error("The existing viewer state was not denied PDF access.");
    } finally {
      await viewerContext.close();
    }

    const customerContext = await browser.newContext({
      storageState: path.join(stateRoot, "customer-state.json"),
      ignoreHTTPSErrors: false,
    });
    try {
      const submissionsResponse = await safeGet(
        customerContext,
        `${portalOrigin}/api/portal/submissions?limit=100`,
        "Customer submission list read",
      );
      if (!submissionsResponse.ok())
        throw new Error("Customer submission list read failed.");
      const submissions = (await submissionsResponse.json()) as {
        submissions?: Array<{ ref: string; isRequester: boolean }>;
      };
      const ownSubmission = submissions.submissions?.find(
        (row) => row.isRequester,
      );
      if (!ownSubmission) {
        summary.authorization.customerOwnSubmissionPdf =
          "no_owned_submission_fixture";
      } else {
        const ownAttachmentsResponse = await safeGet(
          customerContext,
          `${portalOrigin}/api/portal/submissions/${encodeURIComponent(ownSubmission.ref)}/attachments`,
          "Customer-owned attachment list read",
        );
        if (!ownAttachmentsResponse.ok())
          throw new Error("Own submission attachment read failed.");
        const ownAttachments =
          (await ownAttachmentsResponse.json()) as AttachmentRow[];
        const ownPdf = ownAttachments.find(
          (row) => row.mimeType.toLowerCase() === "application/pdf",
        );
        if (ownPdf) {
          const ownPreview = await safeGet(
            customerContext,
            `${portalOrigin}/api/portal/submissions/${encodeURIComponent(ownSubmission.ref)}/attachments/${encodeURIComponent(ownPdf.id)}/preview`,
            "Customer-owned PDF preview",
          );
          summary.authorization.customerOwnSubmissionPdf =
            ownPreview.status() === 200 ? "passed" : "denied";
          await ownPreview.dispose();
          if (summary.authorization.customerOwnSubmissionPdf !== "passed")
            throw new Error("Customer-owned PDF preview did not succeed.");
        } else {
          summary.authorization.customerOwnSubmissionPdf =
            "no_owned_pdf_fixture";
        }
        const foreignPreview = await safeGet(
          customerContext,
          `${portalOrigin}/api/portal/submissions/${encodeURIComponent(ownSubmission.ref)}/attachments/${encodeURIComponent(pdfRow.id)}/preview`,
          "Customer foreign-attachment denial",
        );
        summary.authorization.customerForeignPreviewStatus =
          foreignPreview.status();
        await foreignPreview.dispose();
        if (foreignPreview.status() !== 404)
          throw new Error(
            "Customer portal did not hide the unrelated staff PDF.",
          );
      }
    } finally {
      await customerContext.close();
    }

    summary.stage = "portal_pdf_fixture";
    const portalContext = await browser.newContext({
      storageState: path.join(stateRoot, "customer-state.json"),
      acceptDownloads: true,
      ignoreHTTPSErrors: false,
      locale: "en-US",
      colorScheme: "light",
      viewport: { width: 1280, height: 900 },
    });
    let portalSubmissionRef: string | null = null;
    let portalPdfRow: AttachmentRow | null = null;
    const portalPdfFilename = "Codex AT9 portal PDF preview.pdf";
    const portalMarker = "AT9 PDF browser preview fixture 20261025";
    const portalPage = await portalContext.newPage();
    try {
      const catalogue = await readJson<{
        requestTypes: Array<{ key: string; name: string }>;
      }>(
        await safeGet(
          portalContext,
          `${portalOrigin}/api/portal/catalogue`,
          "Customer request catalogue read",
        ),
        "Customer request catalogue read",
      );
      const pdfRequestType = catalogue.requestTypes.find(
        (row) => row.name === "AT9 PDF Preview Fixture",
      );
      if (!pdfRequestType)
        throw new Error("AT9 PDF request type is not visible to the customer.");

      const portalSubmissions = await readJson<{
        submissions?: Array<{
          ref: string;
          requestTypeName: string;
          isRequester: boolean;
        }>;
      }>(
        await safeGet(
          portalContext,
          `${portalOrigin}/api/portal/submissions?limit=100`,
          "Customer request list for fixture reuse",
        ),
        "Customer request list for fixture reuse",
      );
      const typeSubmissions = (portalSubmissions.submissions ?? []).filter(
        (row) => row.isRequester && row.requestTypeName === pdfRequestType.name,
      );
      for (const row of typeSubmissions) {
        const detail = await readJson<{
          submission?: { formData?: Record<string, unknown> };
        }>(
          await safeGet(
            portalContext,
            `${portalOrigin}/api/portal/submissions/${encodeURIComponent(row.ref)}`,
            "Customer request marker read",
          ),
          "Customer request marker read",
        );
        if (detail.submission?.formData?.title === portalMarker) {
          portalSubmissionRef = row.ref;
          break;
        }
      }

      const form = await readJson<{
        formSchema: {
          fields: Array<{ key: string; label: string; type: string }>;
        };
      }>(
        await safeGet(
          portalContext,
          `${portalOrigin}/api/portal/catalogue/${encodeURIComponent(pdfRequestType.key)}`,
          "Customer request form read",
        ),
        "Customer request form read",
      );
      const fileField = form.formSchema.fields.find(
        (field) => field.type === "file",
      );
      if (!fileField)
        throw new Error("AT9 PDF request form has no customer upload field.");

      if (!portalSubmissionRef) {
        await portalPage.goto(`${portalOrigin}/catalogue`, {
          waitUntil: "domcontentloaded",
        });
        await expect(
          portalPage.getByRole("heading", { name: "Request catalogue" }),
        ).toBeVisible();
        await portalPage
          .getByRole("button", { name: pdfRequestType.name, exact: false })
          .click();
        await expect(
          portalPage.getByRole("heading", { name: pdfRequestType.name }),
        ).toBeVisible();
        await portalPage
          .getByRole("textbox", { name: "Summary" })
          .fill(portalMarker);
        await portalPage
          .getByRole("button", { name: "Submit request" })
          .click();
        await expect(portalPage).toHaveURL(/\/submissions\/SUB-[1-9]\d*/u);
        portalSubmissionRef =
          new URL(portalPage.url()).pathname.split("/").at(-1) ?? null;
        if (!portalSubmissionRef)
          throw new Error("New customer request reference was not available.");
      } else {
        await portalPage.goto(
          `${portalOrigin}/submissions/${encodeURIComponent(portalSubmissionRef)}`,
          { waitUntil: "domcontentloaded" },
        );
      }

      const existingPortalAttachments = await readJson<AttachmentRow[]>(
        await safeGet(
          portalContext,
          `${portalOrigin}/api/portal/submissions/${encodeURIComponent(portalSubmissionRef)}/attachments`,
          "Customer fixture attachment read",
        ),
        "Customer fixture attachment read",
      );
      const existingPortalPdfs = existingPortalAttachments.filter(
        (row) => row.mimeType.toLowerCase() === "application/pdf",
      );
      if (existingPortalPdfs.length > 1)
        throw new Error("The customer PDF fixture has multiple PDF files.");
      portalPdfRow = existingPortalPdfs[0] ?? null;
      if (!portalPdfRow) {
        const pdf = twoPagePdf();
        await portalPage.getByLabel(fileField.label).setInputFiles({
          name: portalPdfFilename,
          mimeType: "application/pdf",
          buffer: pdf,
        });
        await expect(
          portalPage.getByRole("button", {
            name: `Preview ${portalPdfFilename}`,
          }),
        ).toBeVisible({ timeout: 30_000 });
        const readyAttachments = await readJson<AttachmentRow[]>(
          await safeGet(
            portalContext,
            `${portalOrigin}/api/portal/submissions/${encodeURIComponent(portalSubmissionRef)}/attachments`,
            "Customer PDF upload completion read",
          ),
          "Customer PDF upload completion read",
        );
        const matching = readyAttachments.filter(
          (row) => row.filename === portalPdfFilename,
        );
        if (
          matching.length !== 1 ||
          matching[0]?.mimeType !== "application/pdf" ||
          matching[0]?.size !== pdf.byteLength ||
          matching[0]?.state !== "ready"
        )
          throw new Error(
            "The customer PDF upload did not finish exactly once.",
          );
        portalPdfRow = matching[0] ?? null;
      }
      if (
        !portalPdfRow ||
        portalPdfRow.filename !== portalPdfFilename ||
        portalPdfRow.mimeType !== "application/pdf" ||
        portalPdfRow.state !== "ready"
      )
        throw new Error("The customer-owned PDF fixture is not ready.");
      if (!portalPage.url().endsWith(`/submissions/${portalSubmissionRef}`))
        await portalPage.goto(
          `${portalOrigin}/submissions/${encodeURIComponent(portalSubmissionRef)}`,
          { waitUntil: "domcontentloaded" },
        );
      const customerPreviewButton = portalPage.getByRole("button", {
        name: `Preview ${portalPdfFilename}`,
      });
      await expect(customerPreviewButton).toBeVisible({ timeout: 30_000 });
      await customerPreviewButton.click();
      const customerPreviewDialog = portalPage.getByRole("dialog");
      await expect(
        customerPreviewDialog.getByText("Page 1 of 2", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      const customerPdfFrame = portalPage.frame({
        url: `${portalOrigin}/pdf-preview.html`,
      });
      const customerCanvas = await waitForRenderedPdf(customerPdfFrame);
      if (customerCanvas.inkPixels < 20)
        throw new Error("Customer PDF preview canvas is not visibly rendered.");
      await capturePdfPreviewScreen(
        portalPage,
        customerPdfFrame,
        testInfo,
        "portal-pdf-preview-desktop",
      );
      summary.customerAndTriageCaptures.push("portal-desktop");
      await portalPage.setViewportSize({ width: 375, height: 812 });
      await capturePdfPreviewScreen(
        portalPage,
        customerPdfFrame,
        testInfo,
        "portal-pdf-preview-375",
      );
      summary.customerAndTriageCaptures.push("portal-375");
      await portalPage.setViewportSize({ width: 1280, height: 900 });
      summary.authorization.customerOwnSubmissionPdf = "passed";
      const foreignCustomerPreview = await safeGet(
        portalContext,
        `${portalOrigin}/api/portal/submissions/${encodeURIComponent(portalSubmissionRef)}/attachments/${encodeURIComponent(pdfRow.id)}/preview`,
        "Customer foreign staff-PDF denial",
      );
      summary.authorization.customerForeignPreviewStatus =
        foreignCustomerPreview.status();
      await foreignCustomerPreview.dispose();
      if (summary.authorization.customerForeignPreviewStatus !== 404)
        throw new Error(
          "Customer portal did not hide the unrelated staff PDF.",
        );
    } finally {
      await portalContext.close();
    }

    if (!portalSubmissionRef || !portalPdfRow)
      throw new Error("Customer portal PDF fixture was not established.");
    summary.stage = "staff_triage_pdf_preview";
    const staffContext = await browser.newContext({
      storageState: path.join(stateRoot, "admin-state.json"),
      ignoreHTTPSErrors: false,
      locale: "en-US",
      colorScheme: "light",
      viewport: { width: 1440, height: 900 },
    });
    const staffPage = await staffContext.newPage();
    const staffPreviewResponses: number[] = [];
    staffPage.on("response", (response) => {
      const url = new URL(response.url());
      if (
        url.pathname ===
        `/api/submissions/${encodeURIComponent(portalSubmissionRef ?? "")}/attachments/${encodeURIComponent(portalPdfRow?.id ?? "")}/preview`
      )
        staffPreviewResponses.push(response.status());
    });
    try {
      const workspaces = await readJson<
        Array<{ id: string; name: string; role: string }>
      >(
        await safeGet(
          staffContext,
          `${agentOrigin}/api/workspace`,
          "Triage workspace list read",
        ),
        "Triage workspace list read",
      );
      let triageWorkspaceName: string | null = null;
      for (const workspace of workspaces) {
        const types = await readJson<{
          requestTypes?: Array<{ key: string; name: string }>;
        }>(
          await safeGet(
            staffContext,
            `${agentOrigin}/api/request-types?workspaceId=${encodeURIComponent(workspace.id)}`,
            "Staff request type read",
          ),
          "Staff request type read",
        );
        if (
          types.requestTypes?.some(
            (type) => type.name === "AT9 PDF Preview Fixture",
          )
        ) {
          triageWorkspaceName = workspace.name;
          break;
        }
      }
      if (!triageWorkspaceName)
        throw new Error("Staff triage workspace for AT9 was not found.");
      await staffPage.goto(`${agentOrigin}/agent`, {
        waitUntil: "domcontentloaded",
      });
      await switchWorkspace(staffPage, triageWorkspaceName);
      await staffPage.goto(
        `${agentOrigin}/agent/triage?state=new&ref=${encodeURIComponent(portalSubmissionRef)}`,
        { waitUntil: "domcontentloaded" },
      );
      const triageDetail = staffPage.getByRole("region", {
        name: `Submission ${portalSubmissionRef}`,
      });
      await expect(triageDetail).toBeVisible({ timeout: 30_000 });
      const staffPreviewButton = staffPage.getByRole("button", {
        name: `Preview ${portalPdfFilename}`,
      });
      await expect(staffPreviewButton).toBeVisible({ timeout: 30_000 });
      await staffPreviewButton.click();
      const staffPreviewDialog = staffPage.getByRole("dialog");
      await expect(
        staffPreviewDialog.getByText("Page 1 of 2", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      const staffPdfFrame = staffPage.frame({
        url: `${agentOrigin}/pdf-preview.html`,
      });
      const staffCanvas = await waitForRenderedPdf(staffPdfFrame);
      if (staffCanvas.inkPixels < 20)
        throw new Error(
          "Staff triage PDF preview canvas is not visibly rendered.",
        );
      await capturePdfPreviewScreen(
        staffPage,
        staffPdfFrame,
        testInfo,
        "staff-triage-pdf-preview-desktop",
      );
      summary.customerAndTriageCaptures.push("staff-triage-desktop");
      await staffPage.setViewportSize({ width: 375, height: 812 });
      await capturePdfPreviewScreen(
        staffPage,
        staffPdfFrame,
        testInfo,
        "staff-triage-pdf-preview-375",
      );
      summary.customerAndTriageCaptures.push("staff-triage-375");
      summary.authorization.staffTriagePdfPreviewStatus =
        staffPreviewResponses.at(-1) ?? 0;
      if (summary.authorization.staffTriagePdfPreviewStatus !== 200)
        throw new Error("Staff triage PDF preview did not return HTTP 200.");
    } finally {
      await staffContext.close();
    }

    summary.stage = "docx_download_fallback";
    const docxFilename = "Codex AT9 macrofree DOCX download fallback.docx";
    const docxBytes = macroFreeDocx();
    const docxMime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const docxItemBefore = await readJson<{
      id: string;
      projectId: string;
      key: string;
      title: string;
      stateId: string;
      priority: string | null;
      assigneeId: string | null;
      customerVisibility: string;
      version: number;
    }>(
      await safeGet(
        leadContext,
        `${agentOrigin}/api/work-items/CCY-4`,
        "Owned CCY-4 fixture read",
      ),
      "Owned CCY-4 fixture read",
    );
    if (
      docxItemBefore.projectId !== projectId ||
      docxItemBefore.key !== "CCY-4"
    )
      throw new Error("The lead session does not own the expected CCY-4 item.");
    const docxRowsBefore = await readJson<AttachmentRow[]>(
      await safeGet(
        leadContext,
        `${agentOrigin}/api/work-items/CCY-4/attachments`,
        "CCY-4 attachment list read",
      ),
      "CCY-4 attachment list read",
    );
    const existingDocxRows = docxRowsBefore.filter(
      (row) => row.filename === docxFilename,
    );
    if (existingDocxRows.length > 1)
      throw new Error("More than one owned DOCX fixture exists on CCY-4.");
    if (
      existingDocxRows[0] &&
      (existingDocxRows[0].mimeType !== docxMime ||
        existingDocxRows[0].size !== docxBytes.byteLength ||
        existingDocxRows[0].state !== "ready")
    )
      throw new Error("The existing CCY-4 DOCX fixture does not match.");

    await page.goto(
      `${agentOrigin}/agent/projects/${projectKey}/work?layout=list&sort=position&dir=asc`,
      { waitUntil: "domcontentloaded" },
    );
    const docxItemLink = page
      .locator('a[href="/agent/work-items/CCY-4"]')
      .first();
    await expect(docxItemLink).toBeVisible();
    await docxItemLink.click();
    const docxItemDialog = page.getByRole("dialog", {
      name: "Work item CCY-4",
    });
    await expect(docxItemDialog).toBeVisible();
    await docxItemDialog.getByRole("link", { name: "Open full page" }).click();
    await ensureAttachmentPanel(page);

    let docxRow = existingDocxRows[0] ?? null;
    if (!docxRow) {
      const fileChooser = page.waitForEvent("filechooser");
      await page
        .getByRole("button", { name: "Add file", exact: true })
        .first()
        .click();
      await (await fileChooser).setFiles({
        name: docxFilename,
        mimeType: docxMime,
        buffer: docxBytes,
      });
      await expect(
        page.getByRole("link", { name: docxFilename, exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      const uploadedDocxRows = await readJson<AttachmentRow[]>(
        await safeGet(
          leadContext,
          `${agentOrigin}/api/work-items/CCY-4/attachments`,
          "Uploaded CCY-4 DOCX read",
        ),
        "Uploaded CCY-4 DOCX read",
      );
      const matchingDocx = uploadedDocxRows.filter(
        (row) => row.filename === docxFilename,
      );
      if (
        matchingDocx.length !== 1 ||
        matchingDocx[0]?.mimeType !== docxMime ||
        matchingDocx[0]?.size !== docxBytes.byteLength ||
        matchingDocx[0]?.state !== "ready"
      )
        throw new Error("The CCY-4 DOCX upload did not finish exactly once.");
      docxRow = matchingDocx[0] ?? null;
    }
    if (!docxRow) throw new Error("The CCY-4 DOCX attachment row is missing.");
    summary.officeFallback.attachmentReady = true;
    await expect(
      page.getByRole("button", { name: `Preview ${docxFilename}` }),
    ).toHaveCount(0);
    summary.officeFallback.pdfPreviewActionAbsent = true;
    const docxDownloadPromise = page.waitForEvent("download", {
      timeout: 10_000,
    });
    await page.getByRole("link", { name: docxFilename, exact: true }).click();
    const docxDownload = await docxDownloadPromise;
    summary.officeFallback.downloadEvent = true;
    summary.officeFallback.downloadFilenameMatched =
      docxDownload.suggestedFilename() === docxFilename;
    const docxDownloadPath = await docxDownload.path();
    if (!docxDownloadPath)
      throw new Error("The DOCX fallback download has no local file.");
    const downloadedDocx = await readFile(docxDownloadPath);
    summary.officeFallback.downloadedBytesMatched =
      downloadedDocx.equals(docxBytes);
    if (
      !summary.officeFallback.downloadFilenameMatched ||
      !summary.officeFallback.downloadedBytesMatched
    )
      throw new Error("The DOCX fallback download did not match its fixture.");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      page.getByRole("link", { name: docxFilename, exact: true }),
    ).toBeVisible();
    const docxDesktopPath = testInfo.outputPath("docx-fallback-desktop.png");
    await page.screenshot({ path: docxDesktopPath, fullPage: false });
    await testInfo.attach("docx-fallback-desktop", {
      path: docxDesktopPath,
      contentType: "image/png",
    });
    summary.officeFallback.screenshots.push("docx-fallback-desktop");
    await page.setViewportSize({ width: 375, height: 812 });
    const docxMobileLink = page.getByRole("link", {
      name: docxFilename,
      exact: true,
    });
    await expect(docxMobileLink).toBeVisible();
    await docxMobileLink.scrollIntoViewIfNeeded();
    const docxMobilePath = testInfo.outputPath("docx-fallback-375.png");
    await page.screenshot({ path: docxMobilePath, fullPage: false });
    await testInfo.attach("docx-fallback-375", {
      path: docxMobilePath,
      contentType: "image/png",
    });
    summary.officeFallback.screenshots.push("docx-fallback-375");
    const docxItemAfter = await readJson<typeof docxItemBefore>(
      await safeGet(
        leadContext,
        `${agentOrigin}/api/work-items/CCY-4`,
        "CCY-4 work item unchanged read",
      ),
      "CCY-4 work item unchanged read",
    );
    if (
      docxItemBefore.title !== docxItemAfter.title ||
      docxItemBefore.stateId !== docxItemAfter.stateId ||
      docxItemBefore.priority !== docxItemAfter.priority ||
      docxItemBefore.assigneeId !== docxItemAfter.assigneeId ||
      docxItemBefore.customerVisibility !== docxItemAfter.customerVisibility ||
      docxItemBefore.version !== docxItemAfter.version
    )
      throw new Error("The DOCX upload changed unrelated CCY-4 metadata.");

    await page.goto(
      `${agentOrigin}/agent/projects/${projectKey}/work?layout=list&sort=position&dir=asc`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    await page
      .locator(`a[href="/agent/work-items/${itemKey}"]`)
      .first()
      .click();
    const reloadedDialog = page.getByRole("dialog", {
      name: `Work item ${itemKey}`,
    });
    await expect(reloadedDialog).toBeVisible();
    await reloadedDialog.getByRole("link", { name: "Open full page" }).click();
    await page
      .getByRole("button", { name: "Attachments", exact: true })
      .click();
    await expect(page.getByTestId("work-item-attachments")).toBeVisible();
    await expect(page.getByRole("link", { name: filename })).toBeVisible();
    summary.persisted.reloadShowsPdf = true;

    const previewButton = page.getByRole("button", {
      name: `Preview ${filename}`,
    });
    summary.stage = "opening_preview";
    await previewButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Page 1 of 2", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const frameLocator = dialog.locator("iframe");
    await expect(frameLocator).toHaveAttribute("sandbox", "allow-scripts");
    await expect(frameLocator).toHaveAttribute("src", "/pdf-preview.html");
    await expect(frameLocator).toHaveAttribute("referrerpolicy", "origin");
    summary.sandbox.attribute = true;
    viewerFrame =
      page.frame({ url: `${agentOrigin}/pdf-preview.html` }) ?? null;
    if (!viewerFrame) throw new Error("Sandboxed viewer frame did not load.");
    const firstRenderedPage = await waitForRenderedPdf(viewerFrame);
    if (firstRenderedPage.inkPixels < 20)
      throw new Error("PDF canvas did not contain rendered page content.");

    const sandboxProbe = await viewerFrame.evaluate(async () => {
      let cookieReadable = false;
      let storageReadable = false;
      let parentDomReadable = false;
      try {
        cookieReadable = document.cookie.length > 0;
      } catch {}
      try {
        localStorage.length;
        storageReadable = true;
      } catch {}
      try {
        void window.parent.document.title;
        parentDomReadable = true;
      } catch {}
      let apiFetchBlocked = false;
      try {
        await fetch("/api/public/health/live", { cache: "no-store" });
      } catch {
        apiFetchBlocked = true;
      }
      return {
        origin: window.origin,
        cookieReadable,
        storageReadable,
        parentDomReadable,
        apiFetchBlocked,
      };
    });
    summary.sandbox.opaqueOrigin = sandboxProbe.origin === "null";
    summary.sandbox.cookieReadable = sandboxProbe.cookieReadable;
    summary.sandbox.storageReadable = sandboxProbe.storageReadable;
    summary.sandbox.parentDomReadable = sandboxProbe.parentDomReadable;
    summary.sandbox.apiFetchBlocked = sandboxProbe.apiFetchBlocked;
    summary.sandbox.rendererApiRequests = seenViewerApiRequests.length;
    if (
      !summary.sandbox.opaqueOrigin ||
      sandboxProbe.cookieReadable ||
      sandboxProbe.storageReadable ||
      sandboxProbe.parentDomReadable ||
      !sandboxProbe.apiFetchBlocked ||
      seenViewerApiRequests.length !== 0
    ) {
      throw new Error("Sandbox isolation checks failed.");
    }
    const canvasGeometry = await viewerFrame.evaluate(() => {
      const canvas = document.getElementById("pdf-page");
      if (!(canvas instanceof HTMLCanvasElement))
        throw new Error("PDF renderer canvas was not found.");
      const rect = canvas.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        canvasCenter: rect.left + rect.width / 2,
      };
    });
    summary.preview.canvasCentered =
      Math.abs(
        canvasGeometry.canvasCenter - canvasGeometry.viewportWidth / 2,
      ) <= 2;
    if (!summary.preview.canvasCentered)
      throw new Error("The PDF page was not centered in its sandbox viewport.");

    await captureResponsiveStates(
      page,
      testInfo,
      filename,
      summary.responsiveCaptures,
      summary.themeChecks,
      summary.canvasDiagnostics,
    );
    summary.appThemePreferenceRestored = await restoreAppThemePreference(
      page,
      originalPreferencesRaw,
    );
    if (!summary.appThemePreferenceRestored)
      throw new Error("The original persisted app theme was not restored.");
    await ensureAttachmentPanel(page);
    await previewButton.click();
    const reopened = page.getByRole("dialog");
    await expect(
      reopened.getByText("Page 1 of 2", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const activeFrame = page.frame({ url: `${agentOrigin}/pdf-preview.html` });
    if (!activeFrame)
      throw new Error("PDF frame was not available after reopening.");
    await waitForRenderedPdf(activeFrame);
    const initialCanvasWidth = await activeFrame
      .locator("canvas")
      .evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement))
          throw new Error("PDF renderer canvas was not found.");
        return element.width;
      });
    await reopened.getByRole("button", { name: "Next page" }).click();
    await expect(
      reopened.getByText("Page 2 of 2", { exact: true }),
    ).toBeVisible();
    summary.preview.renderedPages = 2;
    await reopened.getByRole("button", { name: "Zoom in" }).click();
    await expect
      .poll(() =>
        activeFrame.locator("canvas").evaluate((element) => {
          if (!(element instanceof HTMLCanvasElement))
            throw new Error("PDF renderer canvas was not found.");
          return element.width;
        }),
      )
      .toBeGreaterThan(initialCanvasWidth);
    summary.preview.zoomChanged = true;

    summary.stage = "download_click";
    const downloadPromise = page
      .waitForEvent("download", { timeout: 5_000 })
      .catch(() => null);
    await reopened
      .getByRole("link", { name: `Download ${filename}` })
      .click({ noWaitAfter: true });
    summary.stage = "download_click_returned";
    const download = await downloadPromise;
    summary.stage = "download_event_wait_finished";
    summary.downloadDiagnostics.downloadEvent = Boolean(download);
    summary.downloadDiagnostics.downloadFilenameMatched =
      download?.suggestedFilename() === filename;
    summary.preview.downloadFallback =
      summary.downloadDiagnostics.downloadEvent &&
      summary.downloadDiagnostics.downloadFilenameMatched &&
      summary.downloadDiagnostics.apiRequestSeen &&
      summary.downloadDiagnostics.storageResponseStatus === 200 &&
      summary.downloadDiagnostics.attachmentDisposition;
    await reopened.getByRole("button", { name: "Close preview" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    let releaseResponse = () => {};
    let signalInterceptStarted: (() => void) | null = null;
    const interceptStarted = new Promise<void>((resolve) => {
      signalInterceptStarted = resolve;
    });
    const heldResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let delayNext = true;
    await page.route("**/api/attachments/*/preview", async (route) => {
      if (!delayNext) return route.continue();
      delayNext = false;
      const response = await route.fetch();
      signalInterceptStarted?.();
      await heldResponse;
      try {
        await route.fulfill({ response });
      } catch {
        // The parent request is expected to be aborted when its dialog closes.
      }
    });
    await previewButton.click();
    await interceptStarted;
    summary.closeAbort.interceptedRequestStarted = true;
    const abortDialog = page.getByRole("dialog");
    await abortDialog.getByRole("button", { name: "Close preview" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    summary.closeAbort.dialogClosed = true;
    releaseResponse();
    await page.unroute("**/api/attachments/*/preview");
    await expect(page.getByRole("alert")).toHaveCount(0);
    summary.closeAbort.noLateFailure = true;

    await Promise.all(rendererAssetHeaderReads);
    summary.sandbox.rendererAssetCredentialsAbsent =
      seenRendererAssets.length > 0 &&
      seenRendererAssets.every(
        (asset) => !asset.cookie && !asset.authorization,
      );
    summary.sandbox.rendererAssetsUsedNullOrigin =
      seenRendererAssets.length > 0 &&
      seenRendererAssets.every((asset) => asset.origin === "null") &&
      seenRendererAssets.some((asset) => asset.extension === ".js") &&
      seenRendererAssets.some((asset) => asset.extension === ".mjs");
    if (!summary.sandbox.rendererAssetCredentialsAbsent)
      throw new Error(
        `PDF renderer asset credential flags: ${JSON.stringify(
          seenRendererAssets.map(
            ({ extension, origin, cookie, authorization }) => ({
              extension,
              origin,
              cookie,
              authorization,
            }),
          ),
        )}`,
      );
    if (!summary.sandbox.rendererAssetsUsedNullOrigin)
      throw new Error(
        "PDF renderer assets did not use the opaque-origin CORS path.",
      );
    if (!summary.preview.downloadFallback)
      throw new Error(
        "The download control did not produce an attachment download.",
      );
    if (summary.sanitizedErrors.some((error) => error !== "csp"))
      throw new Error("Unexpected sanitized browser error occurred.");
  } finally {
    if (originalPreferencesCaptured && !summary.appThemePreferenceRestored) {
      try {
        summary.appThemePreferenceRestored = await restoreAppThemePreference(
          page,
          originalPreferencesRaw,
        );
      } catch {
        summary.sanitizedErrors.push("theme_restore_failed");
      }
    }
    if (startingWorkspace && startingWorkspace !== workspaceName) {
      try {
        await page.goto(`${agentOrigin}/agent`, {
          waitUntil: "domcontentloaded",
        });
        await switchWorkspace(page, startingWorkspace);
        summary.workspace.restored = true;
      } catch {
        summary.sanitizedErrors.push("workspace_restore_failed");
      }
    } else {
      summary.workspace.restored = true;
    }
    try {
      await testInfo.attach("pdf-preview-summary.json", {
        body: JSON.stringify(summary, null, 2),
        contentType: "application/json",
      });
    } finally {
      await leadContext.close().catch(() => undefined);
    }
  }
});
