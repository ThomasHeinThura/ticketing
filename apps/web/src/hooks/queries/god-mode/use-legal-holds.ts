import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getLegalHolds,
  type LegalHoldListQuery,
  type LegalHoldScope,
  liftLegalHold,
  placeLegalHold,
} from "@/fetchers/god-mode/legal-holds";

export function legalHoldsQueryKey(query: LegalHoldListQuery = {}) {
  return [
    "instance",
    "legal-holds",
    {
      status: query.status ?? "all",
      scope: query.scope ?? null,
      scopeId: query.scopeId ?? null,
    },
  ] as const;
}

export function useLegalHolds(query: LegalHoldListQuery = {}) {
  return useQuery({
    queryKey: legalHoldsQueryKey(query),
    queryFn: () => getLegalHolds(query),
    retry: false,
  });
}

export function usePlaceLegalHold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: LegalHoldScope;
      scopeId: string;
      reason: string;
    }) => placeLegalHold(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["instance", "legal-holds"],
        }),
        queryClient.invalidateQueries({ queryKey: ["instance", "health"] }),
      ]);
    },
  });
}

export function useLiftLegalHold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) =>
      liftLegalHold(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["instance", "legal-holds"],
        }),
        queryClient.invalidateQueries({ queryKey: ["instance", "health"] }),
      ]);
    },
  });
}
