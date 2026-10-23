import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getApprovalCandidates,
  getApprovalRequestContext,
} from "@/fetchers/approval/request-approval";
import useRequestApproval from "@/hooks/mutations/approval/use-request-approval";
import { HttpError } from "@/lib/http-error";
import {
  type ApprovalRequestUrlState,
  parseWorkItemApprovalRequestSearch,
} from "@/lib/work-item-approval-request-search";

/** One instance per item prevents a previous item's draft or mutation from moving this URL. */
export default function WorkItemApprovalRequest({
  workItemKey,
}: {
  workItemKey: string;
}) {
  return <ApprovalRequestForm key={workItemKey} workItemKey={workItemKey} />;
}
function ApprovalRequestForm({ workItemKey }: { workItemKey: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const ids = useId();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const parsed = parseWorkItemApprovalRequestSearch(
    location.search,
  ).approvalRequest;
  const state = parsed?.itemKey === workItemKey ? parsed : undefined;
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const update = (next?: ApprovalRequestUrlState) => {
    const current = currentLocation.current;
    const params = new URLSearchParams(current.searchStr);
    if (next) params.set("approvalRequest", JSON.stringify(next));
    else params.delete("approvalRequest");
    const search = params.toString();
    void navigate({
      href: `${current.pathname}${search ? `?${search}` : ""}${current.hash ? `#${current.hash}` : ""}`,
      replace: true,
    });
  };
  const context = useQuery({
    queryKey: ["approvals", "request-context", workItemKey],
    queryFn: () => getApprovalRequestContext(workItemKey),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const options = context.data;
  const canRequest =
    options?.enabled && (options.canRequestCustomer || options.canRequestCab);
  const kind =
    state?.kind ?? (options?.canRequestCustomer ? "customer" : "cab");
  const kindAllowed =
    kind === "cab" ? options?.canRequestCab : options?.canRequestCustomer;
  const transitions =
    options?.transitions.filter((edge) =>
      kind === "cab" ? edge.requiresCab : edge.requiresApproval,
    ) ?? [];
  const transitionId = state?.transitionId ?? "";
  const validTransition = transitions.some((edge) => edge.id === transitionId);
  const [approverId, setApproverId] = useState("");
  const [expiryDays, setExpiryDays] = useState<string>();
  const days = expiryDays ?? String(options?.defaultExpiryDays ?? 7);
  const validExpiry =
    /^\d+$/u.test(days) &&
    Number(days) >= 1 &&
    Number(days) <= (options?.maxExpiryDays ?? 90);
  const mutation = useRequestApproval();
  const [announcement, setAnnouncement] = useState("");
  const candidates = useInfiniteQuery({
    queryKey: [
      "approvals",
      "request-candidates",
      workItemKey,
      kind,
      state?.query ?? "",
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getApprovalCandidates(workItemKey, {
        kind,
        q: state?.query ?? "",
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (page) =>
      page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined,
    enabled: Boolean(state && canRequest && kindAllowed && validTransition),
    staleTime: 0,
  });
  const accessLost =
    candidates.error instanceof HttpError &&
    [403, 404].includes(candidates.error.status);
  const fatalCandidates =
    candidates.isError && (!candidates.isFetchNextPageError || accessLost);
  const people = fatalCandidates
    ? []
    : [
        ...new Map(
          (candidates.data?.pages.flatMap((page) => page.data) ?? []).map(
            (person) => [person.id, person],
          ),
        ).values(),
      ];
  const selected = people.some((person) => person.id === approverId);
  const requestOpen = Boolean(state);
  const contextAccessLost =
    context.error instanceof HttpError &&
    [403, 404].includes(context.error.status);
  const open = () => {
    mutation.reset();
    setApproverId("");
    setExpiryDays(undefined);
    setAnnouncement("");
    update({ itemKey: workItemKey, open: true });
  };
  const change = (next: Partial<ApprovalRequestUrlState>) => {
    setApproverId("");
    mutation.reset();
    update({ itemKey: workItemKey, open: true, ...state, ...next });
  };
  return (
    <>
      {context.isError && !contextAccessLost && !requestOpen && (
        <Alert role="alert">
          <AlertDescription>
            {t("workItems:detail.approvals.request.optionsError")}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void context.refetch()}
            >
              {t("workItems:detail.approvals.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {canRequest && (
        <Button
          variant="outline"
          size="sm"
          onClick={open}
          disabled={mutation.isPending}
        >
          {t("workItems:detail.approvals.request.action")}
        </Button>
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
      <Dialog
        open={requestOpen}
        onOpenChange={(next) => {
          if (!next) update();
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          closeLabel={t("common:actions.cancel")}
        >
          <DialogHeader>
            <DialogTitle>
              {t("workItems:detail.approvals.request.title")}
            </DialogTitle>
            <DialogDescription>
              {t("workItems:detail.approvals.request.description")}
            </DialogDescription>
          </DialogHeader>
          {context.isPending ? (
            <Skeleton className="h-12 w-full" />
          ) : context.isError ? (
            <Alert role="alert">
              <AlertDescription>
                {t("workItems:detail.approvals.request.optionsError")}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void context.refetch()}
                >
                  {t("workItems:detail.approvals.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : !canRequest || !kindAllowed ? (
            <Alert role="alert">
              <AlertDescription>
                {t("workItems:detail.approvals.request.unavailable")}
              </AlertDescription>
            </Alert>
          ) : (
            <form
              className="flex min-h-0 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  !validTransition ||
                  !validExpiry ||
                  !selected ||
                  mutation.isPending
                )
                  return;
                mutation.mutate(
                  {
                    key: workItemKey,
                    body: {
                      transitionId,
                      kind,
                      approverId,
                      expiresAt: new Date(
                        Date.now() + Number(days) * 86400000,
                      ).toISOString(),
                    },
                  },
                  {
                    onSuccess: () => {
                      if (mounted.current) {
                        setAnnouncement(
                          t("workItems:detail.approvals.request.success"),
                        );
                        update();
                      }
                    },
                  },
                );
              }}
            >
              <DialogPanel className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${ids}-kind`}>
                    {t("workItems:detail.approvals.request.kind")}
                  </Label>
                  <Select
                    items={[
                      ...(options?.canRequestCustomer
                        ? [
                            {
                              value: "customer",
                              label: t(
                                "workItems:detail.approvals.kind.customer",
                              ),
                            },
                          ]
                        : []),
                      ...(options?.canRequestCab
                        ? [
                            {
                              value: "cab",
                              label: t("workItems:detail.approvals.kind.cab"),
                            },
                          ]
                        : []),
                    ]}
                    value={kind}
                    disabled={mutation.isPending}
                    onValueChange={(value) =>
                      change({
                        kind: value as "customer" | "cab",
                        transitionId: undefined,
                      })
                    }
                  >
                    <SelectTrigger id={`${ids}-kind`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options?.canRequestCustomer && (
                        <SelectItem value="customer">
                          {t("workItems:detail.approvals.kind.customer")}
                        </SelectItem>
                      )}
                      {options?.canRequestCab && (
                        <SelectItem value="cab">
                          {t("workItems:detail.approvals.kind.cab")}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  {transitions.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("workItems:detail.approvals.request.noTransitions")}
                    </p>
                  )}
                  <Label htmlFor={`${ids}-transition`}>
                    {t("workItems:detail.approvals.request.transition")}
                  </Label>
                  <Select
                    items={transitions.map((edge) => ({
                      value: edge.id,
                      label: `${edge.fromStateName ?? t("workItems:detail.approvals.request.anyState")} → ${edge.toStateName}`,
                    }))}
                    value={transitionId}
                    disabled={mutation.isPending}
                    onValueChange={(value) =>
                      change({ transitionId: value ?? undefined })
                    }
                  >
                    <SelectTrigger id={`${ids}-transition`}>
                      <SelectValue
                        placeholder={t(
                          "workItems:detail.approvals.request.chooseTransition",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {transitions.map((edge) => (
                        <SelectItem key={edge.id} value={edge.id}>
                          {edge.fromStateName ??
                            t(
                              "workItems:detail.approvals.request.anyState",
                            )}{" "}
                          → {edge.toStateName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {validTransition && (
                  <div className="flex flex-col gap-2">
                    <Label>
                      {t("workItems:detail.approvals.request.approver")}
                    </Label>
                    <Command items={people} filter={null}>
                      <CommandInput
                        aria-label={t(
                          "workItems:detail.approvals.request.search",
                        )}
                        placeholder={t(
                          "workItems:detail.approvals.request.search",
                        )}
                        value={state?.query ?? ""}
                        maxLength={200}
                        disabled={mutation.isPending}
                        onChange={(event) =>
                          change({ query: event.target.value })
                        }
                      />
                      <CommandList
                        className="max-h-48 overflow-y-auto"
                        aria-label={t(
                          "workItems:detail.approvals.request.chooseApprover",
                        )}
                      >
                        {(person) => (
                          <CommandItem
                            key={person.id}
                            value={person.displayName ?? person.id}
                            data-selected-approver={approverId === person.id}
                            disabled={mutation.isPending}
                            onClick={() => setApproverId(person.id)}
                          >
                            {person.displayName ??
                              t("workItems:detail.approvals.unknownPerson")}
                            {approverId === person.id && (
                              <Check className="size-4" aria-hidden="true" />
                            )}
                          </CommandItem>
                        )}
                      </CommandList>
                    </Command>
                    {candidates.isPending && (
                      <p>{t("workItems:detail.approvals.loading")}</p>
                    )}
                    {!candidates.isPending &&
                      !candidates.isError &&
                      people.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          {t("workItems:detail.approvals.request.noCandidates")}
                        </p>
                      )}
                    {candidates.isError && (
                      <Alert role="alert">
                        <AlertDescription>
                          {t(
                            "workItems:detail.approvals.request.candidatesError",
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void (candidates.isFetchNextPageError &&
                              !accessLost
                                ? candidates.fetchNextPage()
                                : candidates.refetch())
                            }
                          >
                            {t("workItems:detail.approvals.retry")}
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    {candidates.hasNextPage && !accessLost && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={candidates.isFetchingNextPage}
                        onClick={() => void candidates.fetchNextPage()}
                      >
                        {t("workItems:detail.approvals.request.more")}
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${ids}-expiry`}>
                    {t("workItems:detail.approvals.request.expiryDays")}
                  </Label>
                  <Input
                    id={`${ids}-expiry`}
                    type="number"
                    min={1}
                    max={options?.maxExpiryDays ?? 90}
                    step={1}
                    value={days}
                    disabled={mutation.isPending}
                    onChange={(event) => setExpiryDays(event.target.value)}
                    aria-invalid={!validExpiry}
                    aria-describedby={`${ids}-expiry-hint`}
                  />
                  <p
                    id={`${ids}-expiry-hint`}
                    className="text-xs text-muted-foreground"
                  >
                    {t("workItems:detail.approvals.request.expiryHint", {
                      max: options?.maxExpiryDays ?? 90,
                      days: options?.defaultExpiryDays ?? 7,
                    })}
                  </p>
                  {!validExpiry && (
                    <p role="alert">
                      {t("workItems:detail.approvals.request.invalidExpiry", {
                        max: options?.maxExpiryDays ?? 90,
                      })}
                    </p>
                  )}
                </div>
                {mutation.isError && (
                  <Alert role="alert">
                    <AlertDescription>
                      {t("workItems:detail.approvals.request.error")}
                    </AlertDescription>
                  </Alert>
                )}
              </DialogPanel>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => update()}>
                  {t("common:actions.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !validTransition ||
                    !validExpiry ||
                    !selected ||
                    mutation.isPending
                  }
                >
                  {t(
                    mutation.isPending
                      ? "workItems:detail.approvals.request.submitting"
                      : "workItems:detail.approvals.request.submit",
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
