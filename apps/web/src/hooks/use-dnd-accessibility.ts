import type {
  Announcements,
  ScreenReaderInstructions,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * Localised dnd-kit announcements and keyboard instructions, shared by every TaskDesk
 * `DndContext` (work item board and list, grouped board, calendar). dnd-kit's built-in strings
 * are English only and name items by their raw id; this resolves a readable label per id and
 * keeps Kaneo's own `onDragOver` rule (hovering the card you picked up reads as the pick-up).
 */
export function useDndAccessibility(
  describe: (id: UniqueIdentifier) => string | undefined,
) {
  const { t } = useTranslation();
  return useMemo(() => {
    const label = (id: UniqueIdentifier) => describe(id) ?? String(id);
    const announcements: Announcements = {
      onDragStart({ active }) {
        return t("common:a11y.dnd.pickedUp", { item: label(active.id) });
      },
      onDragOver({ active, over }) {
        if (!over || over.id === active.id)
          return t("common:a11y.dnd.pickedUp", { item: label(active.id) });
        return t("common:a11y.dnd.over", {
          item: label(active.id),
          target: label(over.id),
        });
      },
      onDragEnd({ active, over }) {
        if (!over || over.id === active.id)
          return t("common:a11y.dnd.dropped", { item: label(active.id) });
        return t("common:a11y.dnd.droppedOver", {
          item: label(active.id),
          target: label(over.id),
        });
      },
      onDragCancel({ active }) {
        return t("common:a11y.dnd.cancelled", { item: label(active.id) });
      },
    };
    const screenReaderInstructions: ScreenReaderInstructions = {
      draggable: t("common:a11y.dnd.instructions"),
    };
    return { announcements, screenReaderInstructions };
  }, [describe, t]);
}
