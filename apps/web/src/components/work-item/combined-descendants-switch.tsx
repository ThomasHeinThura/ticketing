import { Label, Switch } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

/** Board toolbar switch: one combined column set across a project and its child projects. */
export default function CombinedDescendantsSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <Switch
        id="combined-descendants"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <Label htmlFor="combined-descendants" className="font-normal">
        {t("workItems:board.combinedDescendants")}
      </Label>
    </span>
  );
}
