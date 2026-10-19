import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  IdentityAdminError,
  type IdentityAdminFailureKind,
  identityAdminFailureKind,
} from "@/fetchers/god-mode/identity-admin-error";
import {
  type IdentityOperationBinding,
  proveIdentityOperation,
} from "@/fetchers/god-mode/identity-step-up";
import {
  getCurrentFactorStatus,
  type StepUpMethod,
} from "@/fetchers/god-mode/instance-users";

export type StepUpFailure = {
  kind: IdentityAdminFailureKind | "factor_required";
  /** The current version a 409 reports; only a number, never configuration. */
  currentVersion: number | null;
};

export type StepUpResult<T> = { ok: true; value: T } | { ok: false };

/**
 * One fresh-verification entry shared by a form: it collects the factor, proves exactly one
 * operation binding, runs the protected write with the resulting single-use token and then drops
 * the secret. The secret lives only in this component state; a failure of any stage clears it.
 */
export function useStepUpAction() {
  const [method, setMethodState] = useState<StepUpMethod>("password");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<StepUpFailure | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const factor = useQuery({
    queryKey: ["god-mode", "step-up-factor"],
    queryFn: getCurrentFactorStatus,
    staleTime: 15_000,
  });
  const defaultMethod: StepUpMethod = factor.data?.enabled
    ? "totp"
    : "password";
  const [methodTouched, setMethodTouched] = useState(false);
  const effectiveMethod = methodTouched ? method : defaultMethod;

  function setMethod(next: StepUpMethod) {
    setMethodTouched(true);
    setMethodState(next);
    setSecret("");
  }

  async function run<T>(
    binding: IdentityOperationBinding,
    execute: (token: string) => Promise<T>,
  ): Promise<StepUpResult<T>> {
    if (busyRef.current) return { ok: false };
    if (!secret) {
      setFailure({ kind: "factor_required", currentVersion: null });
      return { ok: false };
    }
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    const submitted = secret;
    setSecret("");
    try {
      const token = await proveIdentityOperation(binding, {
        method: effectiveMethod,
        secret: submitted,
      });
      const value = await execute(token);
      return { ok: true, value };
    } catch (error) {
      if (mounted.current)
        setFailure({
          kind: identityAdminFailureKind(error),
          currentVersion:
            error instanceof IdentityAdminError ? error.currentVersion : null,
        });
      return { ok: false };
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return {
    method: effectiveMethod,
    setMethod,
    secret,
    setSecret,
    busy,
    failure,
    clearFailure: () => setFailure(null),
    run,
  };
}

export type StepUpAction = ReturnType<typeof useStepUpAction>;
