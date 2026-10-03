import type { Page } from "@playwright/test";

export type LastItemPaintRecorderOptions =
  | { kind: "list"; metric: "listPaint"; expectedCount: 500 }
  | { kind: "board"; metric: "boardPaint"; expectedCount: 200 };

type RecorderMetrics = Window & {
  __g11Metrics?: Record<string, number>;
  __g11PaintDebug?: {
    hasDocumentElement: boolean;
    hasMetricsAtInstall: boolean;
    callbackCount: number;
    lastItemCount: number;
    targetFound: boolean;
    readyAttempts: number;
    revalidatedAttempts: number;
    scrollCount: number;
  };
};

/** Browser-side implementation shared by the benchmark and Chromium regressions. */
export function installLastItemPaintRecorderInDocument(
  options: LastItemPaintRecorderOptions,
) {
  const { kind, metric, expectedCount } = options;
  const debug = {
    hasDocumentElement: Boolean(document.documentElement),
    hasMetricsAtInstall: Boolean((window as RecorderMetrics).__g11Metrics),
    callbackCount: 0,
    lastItemCount: 0,
    targetFound: false,
    readyAttempts: 0,
    revalidatedAttempts: 0,
    scrollCount: 0,
    lastPaintFrameCount: 0,
  };
  (window as RecorderMetrics).__g11PaintDebug = debug;

  const installObserver = () => {
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", installObserver, {
        once: true,
      });
      return;
    }

    debug.hasDocumentElement = true;
    let body: HTMLTableSectionElement | null = null;
    const cards = new Set<Element>();
    const scrollAttempted = new WeakSet<Element>();
    let generation = 0;
    let pending = false;
    let activeAttempt = 0;

    const expectedCardIds = new Set(
      Array.from(
        { length: expectedCount },
        (_, index) => `legacy-task-${index + 1}`,
      ),
    );

    const addCardsFrom = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches('[data-task-id^="legacy-task-"]')) cards.add(node);
      for (const card of node.querySelectorAll(
        '[data-task-id^="legacy-task-"]',
      ))
        cards.add(card);
    };

    const removeCardsFrom = (node: Node) => {
      for (const card of cards) {
        if (node === card || (node instanceof Element && node.contains(card)))
          cards.delete(card);
      }
    };

    const reconcileConnectedCards = () => {
      for (const card of cards) if (!card.isConnected) cards.delete(card);
    };

    const readListTarget = () => {
      if (body && !body.isConnected) body = null;
      if (!body) {
        body = document.querySelector<HTMLTableSectionElement>(
          '[data-testid="work-item-list-populated"] tbody',
        );
      }
      if (!body?.isConnected)
        return { count: 0, target: null as Element | null };
      const rows = body.rows;
      const target = rows.item(expectedCount - 1);
      return { count: rows.length, target };
    };

    const readBoardTarget = () => {
      reconcileConnectedCards();
      const ids = new Map<string, number>();
      let allExpectedIdsPresent = cards.size === expectedCount;
      for (const card of cards) {
        const id = card.getAttribute("data-task-id");
        if (!id || !expectedCardIds.has(id)) {
          allExpectedIdsPresent = false;
          continue;
        }
        ids.set(id, (ids.get(id) ?? 0) + 1);
      }
      for (const id of expectedCardIds) {
        if (ids.get(id) !== 1) allExpectedIdsPresent = false;
      }
      return {
        count: cards.size,
        target: allExpectedIdsPresent
          ? ([...cards].find(
              (card) =>
                card.getAttribute("data-task-id") ===
                `legacy-task-${expectedCount}`,
            ) ?? null)
          : null,
      };
    };

    const readCurrent = () =>
      kind === "list" ? readListTarget() : readBoardTarget();

    const visibleBox = (target: Element) => {
      if (!target.isConnected || target.getClientRects().length === 0)
        return null;

      const visibilityTarget = target as Element & {
        checkVisibility?: (options?: {
          checkOpacity?: boolean;
          checkVisibilityCSS?: boolean;
        }) => boolean;
      };
      if (
        visibilityTarget.checkVisibility &&
        !visibilityTarget.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        })
      )
        return null;

      // Older engines do not expose the options used by Chromium's visibility check.
      if (!visibilityTarget.checkVisibility) {
        for (
          let ancestor: Element | null = target;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const ancestorStyle = getComputedStyle(ancestor);
          if (
            ancestorStyle.display === "none" ||
            ancestorStyle.visibility === "hidden" ||
            ancestorStyle.visibility === "collapse" ||
            Number(ancestorStyle.opacity) === 0
          )
            return null;
        }
      }

      const style = getComputedStyle(target);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        Number(style.opacity) === 0
      )
        return null;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return rect;
    };

    const intersectsViewport = (rect: DOMRect) =>
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight;

    const fitsViewport = (rect: DOMRect) =>
      rect.width <= window.innerWidth &&
      rect.height <= window.innerHeight &&
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= window.innerWidth &&
      rect.bottom <= window.innerHeight;

    const isInViewport = (rect: DOMRect) =>
      rect.width > window.innerWidth || rect.height > window.innerHeight
        ? intersectsViewport(rect)
        : fitsViewport(rect);

    const tryReady = () => {
      debug.callbackCount += 1;
      const current = readCurrent();
      debug.lastItemCount = current.count;
      debug.targetFound = Boolean(current.target);
      if (pending || current.count !== expectedCount || !current.target) return;

      const initialRect = visibleBox(current.target);
      if (!initialRect) return;

      if (!isInViewport(initialRect) && !scrollAttempted.has(current.target)) {
        scrollAttempted.add(current.target);
        debug.scrollCount += 1;
        current.target.scrollIntoView({ block: "nearest" });
      }

      const postScrollRect = visibleBox(current.target);
      if (!postScrollRect || !isInViewport(postScrollRect)) return;

      pending = true;
      debug.readyAttempts += 1;
      const attemptGeneration = generation;
      const attemptId = ++activeAttempt;
      const attemptTarget = current.target;
      requestAnimationFrame(() => {
        let paintFrames = 1;
        requestAnimationFrame(() => {
          paintFrames += 1;
          debug.lastPaintFrameCount = paintFrames;
          if (attemptId !== activeAttempt) return;
          const latest = readCurrent();
          const latestRect = latest.target ? visibleBox(latest.target) : null;
          if (
            generation !== attemptGeneration ||
            latest.count !== expectedCount ||
            latest.target !== attemptTarget ||
            !latestRect ||
            !isInViewport(latestRect)
          ) {
            pending = false;
            activeAttempt += 1;
            debug.revalidatedAttempts += 1;
            tryReady();
            return;
          }

          const metrics = (window as RecorderMetrics).__g11Metrics;
          if (!metrics) {
            pending = false;
            activeAttempt += 1;
            debug.revalidatedAttempts += 1;
            tryReady();
            return;
          }
          metrics[metric] = performance.now();
          observer.disconnect();
        });
      });
    };

    const observer = new MutationObserver((records) => {
      generation += 1;
      activeAttempt += 1;
      if (pending) debug.revalidatedAttempts += 1;
      if (kind === "board") {
        for (const record of records) {
          for (const node of record.removedNodes) removeCardsFrom(node);
          for (const node of record.addedNodes) addCardsFrom(node);
        }
      } else if (body && !body.isConnected) {
        body = null;
      }
      pending = false;
      tryReady();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // One scoped initial reconciliation covers nodes present before observer setup.
    if (kind === "board") {
      for (const card of document.querySelectorAll(
        '[data-task-id^="legacy-task-"]',
      ))
        cards.add(card);
    }
    tryReady();
  };

  installObserver();
}

export function installLastItemPaintRecorder(
  page: Page,
  options: LastItemPaintRecorderOptions,
) {
  return page.addInitScript(installLastItemPaintRecorderInDocument, options);
}
