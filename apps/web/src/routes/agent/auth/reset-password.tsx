import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/auth/layout";
import { ResetPassword } from "@/components/auth/password-recovery";
export const Route = createFileRoute("/auth/reset-password")({
  component: Page,
});
function Page() {
  const { t } = useTranslation();
  return (
    <AuthLayout title={t("auth:passwordRecovery.resetTitle")}>
      <ResetPassword portal={false} />
    </AuthLayout>
  );
}
