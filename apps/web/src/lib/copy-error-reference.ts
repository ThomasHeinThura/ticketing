import { toastManager } from "@taskdesk/ui";
import i18n from "i18next";
import { createElement } from "react";

/** A denied or unavailable clipboard leaves a persistent, selectable reference. */
export async function copyErrorReference(reference: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText)
      throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(reference);
  } catch {
    toastManager.add({
      title: i18n.t("common:error.copyReferenceFailed"),
      description: createElement(
        "span",
        { className: "select-text" },
        reference,
      ),
      priority: "low",
      type: "error",
      timeout: 0,
    });
  }
}
