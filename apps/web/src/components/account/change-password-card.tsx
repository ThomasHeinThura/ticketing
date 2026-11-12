import { Card, CardContent, Checkbox, Input, SaveButton } from "@taskdesk/ui";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { localPasswordSchema } from "@/lib/password-schema";
import { toast } from "@/lib/toast";

export type PasswordChange = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
};

type Field = "currentPassword" | "newPassword" | "confirmPassword";

export function ChangePasswordCard({
  hasLocalPassword,
  changePassword,
}: {
  hasLocalPassword: boolean;
  changePassword: (value: PasswordChange) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [error, setError] = useState<{ field: Field; message: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  if (!hasLocalPassword) return null;
  function fail(field: Field, message: string) {
    setError({ field, message });
    ({
      currentPassword: currentRef,
      newPassword: newRef,
      confirmPassword: confirmRef,
    })[field].current?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSaved(false);
    if (!currentPassword)
      return fail("currentPassword", t("auth:changePassword.required"));
    const result = localPasswordSchema(
      t("auth:signUpForm.passwordTooShort"),
      t("auth:changePassword.tooLong"),
    ).safeParse(newPassword);
    if (!result.success)
      return fail(
        "newPassword",
        result.error.issues[0]?.message ?? t("auth:changePassword.failed"),
      );
    if (newPassword !== confirmPassword)
      return fail("confirmPassword", t("auth:changePassword.mismatch"));
    setError(null);
    setPending(true);
    try {
      await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
      toast.success(t("auth:changePassword.success"));
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_PASSWORD") {
        fail("currentPassword", t("auth:changePassword.wrongCurrent"));
      } else {
        setError({
          field: "currentPassword",
          message: t("auth:changePassword.failed"),
        });
        currentRef.current?.focus();
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-lg font-medium">
          {t("auth:changePassword.title")}
        </h2>
        <form className="space-y-4" onSubmit={submit} noValidate>
          {(
            [
              [
                "currentPassword",
                currentPassword,
                setCurrentPassword,
                currentRef,
                "current-password",
              ],
              [
                "newPassword",
                newPassword,
                setNewPassword,
                newRef,
                "new-password",
              ],
              [
                "confirmPassword",
                confirmPassword,
                setConfirmPassword,
                confirmRef,
                "new-password",
              ],
            ] as const
          ).map(([field, value, setValue, ref, autoComplete]) => (
            <div key={field} className="space-y-2">
              <label
                htmlFor={`change-${field}`}
                className="block text-sm font-medium"
              >
                {t(`auth:changePassword.${field}`)}
              </label>
              <Input
                id={`change-${field}`}
                ref={ref}
                type="password"
                autoComplete={autoComplete}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-invalid={error?.field === field}
                aria-describedby={
                  error?.field === field ? `change-${field}-error` : undefined
                }
              />
              {error?.field === field ? (
                <p
                  id={`change-${field}-error`}
                  role="alert"
                  className="text-sm"
                >
                  {error.message}
                </p>
              ) : null}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Checkbox
              id="change-revoke"
              checked={revokeOtherSessions}
              onCheckedChange={setRevokeOtherSessions}
            />
            <label htmlFor="change-revoke">
              {t("auth:changePassword.revoke")}
            </label>
          </div>
          <SaveButton
            type="submit"
            pending={pending}
            success={saved}
            savedLabel={t("common:actions.saved")}
          >
            {t("auth:changePassword.submit")}
          </SaveButton>
        </form>
      </CardContent>
    </Card>
  );
}
