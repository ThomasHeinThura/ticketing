import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { EstimatePreview } from "@/fetchers/agile";

/**
 * `ES-3`: the preview shown before an estimate system or scale change is applied. It lists, per
 * existing point, where its estimates go or that they are cleared, and the totals; a change in
 * the middle of a cycle is warned about because its burndown will note the discontinuity.
 */
export function EstimatePreviewDialog({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: EstimatePreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("agile");
  const used = preview.mapping.filter((entry) => entry.itemCount > 0);
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("estimates.preview.title")}</DialogTitle>
          <DialogDescription>
            {t("estimates.preview.description", {
              system: t(`systems.${preview.toSystem}`),
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm" data-testid="estimate-preview-totals">
          {t("estimates.preview.totals", {
            mapped: preview.mappedItems,
            cleared: preview.clearedItems,
          })}
        </p>
        {used.length > 0 ? (
          <Table data-testid="estimate-preview-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("estimates.preview.from")}</TableHead>
                <TableHead>{t("estimates.preview.to")}</TableHead>
                <TableHead className="text-end">
                  {t("estimates.preview.items")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {used.map((entry) => (
                <TableRow key={entry.fromPointId}>
                  <TableCell>{entry.fromValue}</TableCell>
                  <TableCell>
                    {entry.toValue ?? t("estimates.preview.cleared")}
                  </TableCell>
                  <TableCell className="text-end">{entry.itemCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("estimates.preview.nothingUsed")}
          </p>
        )}
        {preview.clearedItems > 0 ? (
          <Alert variant="warning">
            <AlertDescription>
              {t("estimates.preview.clearWarning", {
                count: preview.clearedItems,
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {preview.activeCycles.length > 0 ? (
          <Alert variant="warning" data-testid="estimate-preview-cycles">
            <AlertDescription>
              {t("estimates.preview.midCycle", {
                names: preview.activeCycles
                  .map((cycle) => cycle.name)
                  .join(", "),
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {t("estimates.preview.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
