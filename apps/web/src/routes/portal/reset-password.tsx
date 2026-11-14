import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { ResetPassword } from "@/components/auth/password-recovery";
export const Route = createFileRoute("/reset-password")({ component: Page });
function Page() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle render={(props) => <h1 {...props} />}>
            {t("auth:passwordRecovery.resetTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResetPassword portal />
        </CardContent>
      </Card>
    </main>
  );
}
