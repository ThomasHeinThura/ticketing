import { Alert, AlertDescription, Button, Input } from "@taskdesk/ui";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useResetPassword from "@/hooks/mutations/use-reset-password";
import useSendPasswordReset from "@/hooks/mutations/use-send-password-reset";

type Props = { portal: boolean };

export function ForgotPassword({ portal }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const request = useSendPasswordReset();
  const signIn = portal ? "/sign-in" : "/auth/sign-in";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await request.mutateAsync({
        email,
        redirectTo: `${window.location.origin}${portal ? "/reset-password" : "/auth/reset-password"}`,
      });
    } catch {
      // A single confirmation avoids disclosing account or mail configuration.
    }
    setSent(true);
  }
  return (
    <div>
      {sent ? (
        <Alert>
          <AlertDescription>
            {t("auth:passwordRecovery.confirmation")}
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label
            htmlFor="recovery-email"
            className="block space-y-2 text-sm font-medium"
          >
            {t("auth:forms.email")}
            <Input
              id="recovery-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={request.isPending} className="w-full">
            {t("auth:passwordRecovery.send")}
          </Button>
        </form>
      )}
      <Button variant="link" className="w-full" render={<a href={signIn} />}>
        {t("auth:passwordRecovery.back")}
      </Button>
    </div>
  );
}

export function ResetPassword({ portal }: Props) {
  const { t } = useTranslation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const validToken = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<"short" | "mismatch" | "invalid" | null>(
    null,
  );
  const [done, setDone] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  const reset = useResetPassword();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("short");
      first.current?.focus();
      return;
    }
    if (password !== confirm) {
      setError("mismatch");
      second.current?.focus();
      return;
    }
    try {
      await reset.mutateAsync({ token, newPassword: password });
      setDone(true);
    } catch {
      setError("invalid");
    }
  }
  const signIn = portal ? "/sign-in" : "/auth/sign-in";
  return (
    <div>
      {done ? (
        <Alert>
          <AlertDescription>
            {t("auth:passwordRecovery.success")}
          </AlertDescription>
        </Alert>
      ) : !validToken || error === "invalid" ? (
        <Alert variant="error">
          <AlertDescription>
            {t("auth:passwordRecovery.invalid")}
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label
            htmlFor="new-password"
            className="block space-y-2 text-sm font-medium"
          >
            {t("auth:passwordRecovery.newPassword")}
            <Input
              ref={first}
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              aria-invalid={error === "short"}
              aria-describedby={error === "short" ? "reset-error" : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label
            htmlFor="confirm-password"
            className="block space-y-2 text-sm font-medium"
          >
            {t("auth:passwordRecovery.confirmPassword")}
            <Input
              ref={second}
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              aria-invalid={error === "mismatch"}
              aria-describedby={
                error === "mismatch" ? "reset-error" : undefined
              }
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && (
            <p id="reset-error" role="alert">
              {t(
                error === "short"
                  ? "auth:signUpForm.passwordTooShort"
                  : "auth:passwordRecovery.mismatch",
              )}
            </p>
          )}
          <Button type="submit" disabled={reset.isPending} className="w-full">
            {t("auth:passwordRecovery.reset")}
          </Button>
        </form>
      )}
      <Button variant="link" className="w-full" render={<a href={signIn} />}>
        {t("auth:passwordRecovery.back")}
      </Button>
    </div>
  );
}
