import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/auth/layout";
import { ForgotPassword } from "@/components/auth/password-recovery";
export const Route = createFileRoute("/auth/forgot-password")({
  component: Page,
});
function Page() {
  const { t } = useTranslation();
  return (
    <AuthLayout title={t("auth:passwordRecovery.requestTitle")}>
      <ForgotPassword portal={false} />
    </AuthLayout>
  );
}
