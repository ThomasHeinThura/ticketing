import { Extension, findChildren } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import DOMPurify from "dompurify";
import debounce from "@/lib/debounce";
import { i18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { isDarkTheme, SHIKI_CODEBLOCK_REFRESH_META } from "./shiki-code-block";

const MERMAID_LANGUAGE = "mermaid";
const MERMAID_REFRESH_META = "mermaid-refresh";
const DEFAULT_ERROR_KEY = "tasks:detail.editor.mermaid.renderFailed";
const RENDER_DEBOUNCE_MS = 250;
const RENDER_TIMEOUT_MS = 15_000;
const RENDER_CACHE_LIMIT = 20;
const mermaidPluginKey = new PluginKey("mermaid-block");

type RenderState =
  | { status: "done"; svg: string }
  | { status: "error"; message: string };

type MermaidBlockOptions = {
  errorKey: string;
};

type Scheduler = {
  want: (
    cacheKey: string,
    code: string,
    dark: boolean,
    explicit: boolean,
  ) => void;
  reset: () => void;
  flush: () => void;
  cancel: () => void;
  destroy: () => void;
};

const MERMAID_OPENERS =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|C4Context|architecture-beta|packet-beta|kanban|radar-beta|treemap-beta)\b/;

const renderCache = new Map<string, RenderState | null>();
type RenderSubscriber = (cacheKey: string, state: RenderState) => void;
const renderSubscribers = new Map<string, Set<RenderSubscriber>>();
const renderUseCounts = new Map<string, number>();
const renderErrorsToasted = new Set<string>();
let mermaidIdCounter = 0;
let initializedTheme: "dark" | "default" | null = null;
let cacheEvictionQueued = false;

function isMermaid(code: string) {
  const opener = code
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"));

  return opener !== undefined && MERMAID_OPENERS.test(opener);
}

// Keys used by any mounted editor are never evicted, so the limit is a floor
// rather than a ceiling. Evicting a live key during its completion refresh would
// make that editor request it again and prevent the decoration from settling.
function evictRenderCache() {
  cacheEvictionQueued = false;
  if (renderCache.size <= RENDER_CACHE_LIMIT) return;

  for (const [key, state] of renderCache) {
    if (renderCache.size <= RENDER_CACHE_LIMIT) return;
    if (state === null || (renderUseCounts.get(key) ?? 0) > 0) continue;
    renderCache.delete(key);
    renderErrorsToasted.delete(key);
  }
}

function queueRenderCacheEviction() {
  if (cacheEvictionQueued) return;
  cacheEvictionQueued = true;
  queueMicrotask(evictRenderCache);
}

function cacheRender(cacheKey: string, state: RenderState) {
  renderCache.set(cacheKey, state);
  evictRenderCache();
}

function subscribe(cacheKey: string, subscriber: RenderSubscriber) {
  const subscribers = renderSubscribers.get(cacheKey) ?? new Set();
  subscribers.add(subscriber);
  renderSubscribers.set(cacheKey, subscribers);
}

function unsubscribe(cacheKey: string, subscriber: RenderSubscriber) {
  const subscribers = renderSubscribers.get(cacheKey);
  if (!subscribers) return;
  subscribers.delete(subscriber);
  if (subscribers.size === 0) renderSubscribers.delete(cacheKey);
}

function notifyRenderSubscribers(cacheKey: string, state: RenderState) {
  for (const subscriber of [...(renderSubscribers.get(cacheKey) ?? [])]) {
    subscriber(cacheKey, state);
  }
}

function changeRenderUseCount(cacheKey: string, change: 1 | -1) {
  const count = (renderUseCounts.get(cacheKey) ?? 0) + change;
  if (count <= 0) renderUseCounts.delete(cacheKey);
  else renderUseCounts.set(cacheKey, count);
}

async function renderMermaid(code: string, dark: boolean) {
  const { default: mermaid } = await import("mermaid");
  const theme = dark ? "dark" : "default";

  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme,
      fontFamily: "inherit",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    initializedTheme = theme;
  }

  mermaidIdCounter += 1;
  const { svg } = await mermaid.render(
    `taskdesk-mermaid-${mermaidIdCounter}`,
    code,
  );

  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

async function renderMermaidWithTimeout(code: string, dark: boolean) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      renderMermaid(code, dark),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Mermaid rendering timed out.")),
          RENDER_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function createScheduler(errorKey: string, onSettled: () => void): Scheduler {
  const wanted = new Map<
    string,
    { code: string; dark: boolean; explicit: boolean }
  >();
  let active = true;
  const trackedKeys = new Set<string>();

  const onRenderSettled: RenderSubscriber = (cacheKey, state) => {
    if (!active) return;
    if (
      state.status === "error" &&
      wanted.get(cacheKey)?.explicit &&
      !renderErrorsToasted.has(cacheKey)
    ) {
      renderErrorsToasted.add(cacheKey);
      toast.error(i18n.t(errorKey), { description: state.message });
    }
    onSettled();
  };

  const reset = () => {
    for (const key of trackedKeys) {
      unsubscribe(key, onRenderSettled);
      changeRenderUseCount(key, -1);
    }
    trackedKeys.clear();
    wanted.clear();
    // Decorations are rebuilt synchronously after reset. Deferring eviction until
    // that rebuild has re-registered its live keys avoids evicting an active
    // document's own entries at the >20-key cache boundary.
    queueRenderCacheEviction();
  };

  const flush = debounce(async () => {
    if (!active) return;

    const batch = [...wanted].filter(([key]) => !renderCache.has(key));
    for (const [key, { code, dark }] of batch) {
      // A second editor may have started this key between its own debounce and
      // this callback. Claim only absent keys so one render serves every editor.
      if (renderCache.has(key)) continue;
      renderErrorsToasted.delete(key);
      renderCache.set(key, null);
      void renderMermaidWithTimeout(code, dark)
        .then((svg) => {
          const state: RenderState = { status: "done", svg };
          cacheRender(key, state);
          notifyRenderSubscribers(key, state);
        })
        .catch((error: unknown) => {
          const state: RenderState = {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          };
          cacheRender(key, state);
          notifyRenderSubscribers(key, state);
        });
    }
  }, RENDER_DEBOUNCE_MS);

  return {
    want: (cacheKey, code, dark, explicit) => {
      if (!wanted.has(cacheKey)) {
        trackedKeys.add(cacheKey);
        changeRenderUseCount(cacheKey, 1);
        subscribe(cacheKey, onRenderSettled);
      }
      wanted.set(cacheKey, {
        code,
        dark,
        explicit: explicit || wanted.get(cacheKey)?.explicit === true,
      });
    },
    reset,
    flush: () => {
      if (wanted.size > 0) flush();
    },
    cancel: () => flush.cancel(),
    destroy: () => {
      active = false;
      flush.cancel();
      reset();
    },
  };
}

function createPreviewElement(state: RenderState | null, errorKey: string) {
  const container = document.createElement("div");
  container.className = "taskdesk-mermaid-preview";
  container.contentEditable = "false";

  if (!state) {
    container.dataset.state = "loading";
    return container;
  }

  if (state.status === "error") {
    container.dataset.state = "error";
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    container.textContent = i18n.t(errorKey);
    return container;
  }

  container.dataset.state = "done";
  container.innerHTML = state.svg;
  return container;
}

function getDecorations(
  doc: ProseMirrorNode,
  scheduler: Scheduler,
  errorKey: string,
) {
  const dark = isDarkTheme();
  const decorations: Decoration[] = [];

  scheduler.reset();

  findChildren(doc, (node) => node.type.name === "codeBlock").forEach(
    (block) => {
      const language = (
        (block.node.attrs.language as string | undefined) || ""
      ).toLowerCase();
      const code = block.node.textContent.trim();
      if (!code) return;

      const explicit = language === MERMAID_LANGUAGE;
      if (language && !explicit) return;
      if (!explicit && !isMermaid(code)) return;

      const cacheKey = `${dark ? "dark" : "light"}:${code}`;
      const state = renderCache.get(cacheKey) ?? null;

      scheduler.want(cacheKey, code, dark, explicit);

      decorations.push(
        Decoration.widget(
          block.pos + block.node.nodeSize,
          () => createPreviewElement(state, errorKey),
          { key: `${cacheKey}:${state?.status ?? "loading"}`, side: 1 },
        ),
      );
    },
  );

  scheduler.flush();

  return DecorationSet.create(doc, decorations);
}

export const MermaidBlock = Extension.create<MermaidBlockOptions>({
  name: "mermaidBlock",

  addOptions() {
    return { errorKey: DEFAULT_ERROR_KEY };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    const scheduler = createScheduler(this.options.errorKey, () => {
      const { view } = editor;
      if (!view || view.isDestroyed) return;
      view.dispatch(view.state.tr.setMeta(MERMAID_REFRESH_META, true));
    });

    editor.once("destroy", () => scheduler.destroy());

    return [
      new Plugin({
        key: mermaidPluginKey,
        state: {
          init: (_config: unknown, state: EditorState) =>
            getDecorations(state.doc, scheduler, this.options.errorKey),
          apply: (transaction: Transaction, decorationSet: DecorationSet) => {
            if (
              transaction.docChanged ||
              transaction.getMeta(MERMAID_REFRESH_META) ||
              transaction.getMeta(SHIKI_CODEBLOCK_REFRESH_META)
            ) {
              return getDecorations(
                transaction.doc,
                scheduler,
                this.options.errorKey,
              );
            }

            return decorationSet.map(transaction.mapping, transaction.doc);
          },
        },
        view: () => ({ destroy: () => scheduler.cancel() }),
        props: {
          decorations(state: EditorState) {
            return mermaidPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
