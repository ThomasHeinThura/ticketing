import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

// The work route's toolbar actions load in their own chunks and appear only once permission is
// known. Until then these hold their exact footprint (same Kaneo button, size and label), kept
// invisible and inert, so the toolbar does not grow, or wrap onto a second row and push the
// loaded board or list down, when the real actions arrive (G13).

/** The switch's footprint while its chunk or capabilities load: invisible and inert. */
export function WorkItemSelectionTogglePlaceholder() {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      size="sm"
      className="invisible"
      aria-hidden="true"
      tabIndex={-1}
      disabled
    >
      {t("workItems:bulk.selectMode")}
    </Button>
  );
}

/** The create action's footprint while its chunk or permission loads: invisible and inert. */
export function WorkItemCreateTriggerPlaceholder() {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      className="invisible"
      aria-hidden="true"
      tabIndex={-1}
      disabled
    >
      {t("workItems:create.trigger")}
    </Button>
  );
}
