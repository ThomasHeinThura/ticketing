import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@taskdesk/ui";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getHierarchyChildren } from "@/fetchers/work-item/get-hierarchy-children";

/** `RH-10` / `WI-18`: only a move into a closed group warns. */
export function isClosingCategory(category: string | undefined): boolean {
  return category === "completed" || category === "cancelled";
}

export type OpenChild = { key: string; title: string; stateName: string };
export type OpenChildren = {
  /** Direct open children from the first page, for listing. */
  listed: OpenChild[];
  /** Open items in the whole subtree, from the server's roll-up. */
  openInSubtree: number;
};

/**
 * Open children of a work item. The roll-up (`progress`) is the authority on whether anything
 * is open; the first page of direct children supplies the list. Never throws on a failed read:
 * the API still decides the transition, so an unreadable hierarchy must not block closing.
 */
export async function fetchOpenChildren(
  key: string,
): Promise<OpenChildren | null> {
  try {
    const page = await getHierarchyChildren(key);
    const openInSubtree = page.progress.total - page.progress.completed;
    if (openInSubtree <= 0) return null;
    return {
      openInSubtree,
      listed: page.data
        .filter(
          (child) =>
            child.stateCategory !== "completed" &&
            child.stateCategory !== "cancelled",
        )
        .map(({ key: childKey, title, stateName }) => ({
          key: childKey,
          title,
          stateName,
        })),
    };
  } catch {
    return null;
  }
}

/** Open children across several selected parents (bulk close); `null` when none are open. */
export async function fetchOpenChildrenForKeys(
  keys: string[],
): Promise<OpenChildren | null> {
  const results = await Promise.all(keys.map((key) => fetchOpenChildren(key)));
  const found = results.filter(
    (entry): entry is OpenChildren => entry !== null,
  );
  if (found.length === 0) return null;
  return {
    openInSubtree: found.reduce((sum, entry) => sum + entry.openInSubtree, 0),
    listed: found.flatMap((entry) => entry.listed),
  };
}

const MAX_LISTED = 8;

/**
 * Kaneo `AlertDialog` naming the open children before a parent is closed. Confirming closes
 * the parent only; children are never closed with it (`RH-10`: it does not cascade).
 */
export function OpenChildrenWarningDialog({
  open,
  openChildren,
  onConfirm,
  onCancel,
  busy = false,
}: {
  open: boolean;
  openChildren: OpenChildren | null;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const listed = openChildren?.listed.slice(0, MAX_LISTED) ?? [];
  const remaining = (openChildren?.openInSubtree ?? 0) - listed.length;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent data-testid="open-children-warning">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("workItems:openChildren.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("workItems:openChildren.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-60 overflow-y-auto text-sm">
          {listed.map((child) => (
            <li key={child.key}>
              {t("workItems:openChildren.item", {
                key: child.key,
                title: child.title,
                state: child.stateName,
              })}
            </li>
          ))}
          {remaining > 0 ? (
            <li className="text-muted-foreground">
              {t("workItems:openChildren.more", { remaining })}
            </li>
          ) : null}
        </ul>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <Button disabled={busy} onClick={onConfirm}>
            {t("workItems:openChildren.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Runs `proceed` straight away unless the move closes an item that still has open children,
 * in which case the dialog asks first. `guard` resolves once the decision is made.
 */
export function useOpenChildrenGuard() {
  const [pending, setPending] = useState<{
    children: OpenChildren;
    proceed: () => void;
    cancel?: () => void;
  } | null>(null);
  const checking = useRef(false);

  const guard = useCallback(
    async (input: {
      /** One parent, or every selected parent for a bulk close. */
      key: string | string[];
      closing: boolean;
      proceed: () => void;
      /** Called when the person cancels (or a check is already running). */
      cancel?: () => void;
    }) => {
      if (!input.closing) {
        input.proceed();
        return;
      }
      if (checking.current) {
        input.cancel?.();
        return;
      }
      checking.current = true;
      try {
        const children = Array.isArray(input.key)
          ? await fetchOpenChildrenForKeys(input.key)
          : await fetchOpenChildren(input.key);
        if (children)
          setPending({
            children,
            proceed: input.proceed,
            cancel: input.cancel,
          });
        else input.proceed();
      } finally {
        checking.current = false;
      }
    },
    [],
  );

  const dialog = (
    <OpenChildrenWarningDialog
      open={pending !== null}
      openChildren={pending?.children ?? null}
      onCancel={() => {
        const next = pending;
        setPending(null);
        next?.cancel?.();
      }}
      onConfirm={() => {
        const next = pending;
        setPending(null);
        next?.proceed();
      }}
    />
  );
  return { guard, dialog };
}
