import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import useCreateApproval from "@/hooks/mutations/approval/use-create-approval";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import useGetWorkItemTransitions from "@/hooks/queries/work-item/use-get-work-item-transitions";

type Kind = "customer" | "cab";

/**
 * Request an approval for a transition that is gated on one (`approvals.md`): pick the
 * gated transition, the kind it needs, and the approver. The server enforces who may
 * request and who may approve; a refusal is shown with its reason.
 */
export default function RequestApproval({
  workItemKey,
  projectId,
}: {
  workItemKey: string;
  projectId: string | undefined;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [transitionId, setTransitionId] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [approverId, setApproverId] = useState("");
  const transitions = useGetWorkItemTransitions({
    key: workItemKey,
    enabled: open,
  });
  const people = useGetAssignablePeople({ projectId, enabled: open });
  const create = useCreateApproval();

  const gated = (transitions.data ?? []).filter((offer) =>
    offer.blockedBy.some(
      (reason) =>
        (reason.kind === "approval" || reason.kind === "cab") &&
        !reason.pendingApprovals?.length,
    ),
  );
  const selected = gated.find((offer) => offer.transitionId === transitionId);
  const kinds: Kind[] = selected
    ? [
        ...(selected.requiresApproval ? (["customer"] as const) : []),
        ...(selected.requiresCab ? (["cab"] as const) : []),
      ]
    : [];
  const effectiveKind: Kind | "" =
    kind && kinds.includes(kind) ? kind : (kinds[0] ?? "");

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("workItems:detail.approvals.request")}
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!transitionId || !effectiveKind || !approverId) return;
        create.mutate(
          {
            key: workItemKey,
            transitionId,
            kind: effectiveKind,
            approverId,
          },
          {
            onSuccess: () => {
              setOpen(false);
              setTransitionId("");
              setKind("");
              setApproverId("");
            },
          },
        );
      }}
    >
      {transitions.isLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("common:empty.loading")}
        </p>
      ) : gated.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("workItems:detail.approvals.nothingToRequest")}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-transition`}>
              {t("workItems:detail.approvals.forTransition")}
            </Label>
            <Select
              value={transitionId}
              onValueChange={(value) => setTransitionId(value ?? "")}
            >
              <SelectTrigger id={`${ids}-transition`}>
                <SelectValue
                  placeholder={t("workItems:detail.approvals.pickTransition")}
                >
                  {selected?.toStateName}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {gated.map((offer) => (
                  <SelectItem
                    key={offer.transitionId}
                    value={offer.transitionId}
                  >
                    {offer.toStateName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kinds.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-kind`}>
                {t("workItems:detail.approvals.kindLabel")}
              </Label>
              <Select
                value={effectiveKind}
                onValueChange={(value) => setKind((value as Kind) ?? "")}
              >
                <SelectTrigger id={`${ids}-kind`}>
                  <SelectValue>
                    {effectiveKind
                      ? t(`workItems:detail.approvals.kind.${effectiveKind}`)
                      : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`workItems:detail.approvals.kind.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-approver`}>
              {t("workItems:detail.approvals.approverLabel")}
            </Label>
            <Select
              value={approverId}
              onValueChange={(value) => setApproverId(value ?? "")}
            >
              <SelectTrigger id={`${ids}-approver`}>
                <SelectValue
                  placeholder={t("workItems:detail.approvals.pickApprover")}
                >
                  {people.data?.find((p) => p.personId === approverId)?.name ??
                    null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(people.data ?? []).map((person) => (
                  <SelectItem key={person.personId} value={person.personId}>
                    {person.name ?? person.personId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      {create.isError ? (
        <p className="text-destructive-foreground text-sm" role="alert">
          {create.error instanceof Error && create.error.message
            ? create.error.message
            : t("workItems:detail.approvals.requestFailed")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={
            create.isPending || !transitionId || !effectiveKind || !approverId
          }
        >
          {t("workItems:detail.approvals.sendRequest")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          {t("common:actions.cancel")}
        </Button>
      </div>
    </form>
  );
}
