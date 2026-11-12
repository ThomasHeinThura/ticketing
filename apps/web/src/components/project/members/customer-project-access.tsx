import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  Button,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";

type Customer = { personId: string; name: string | null; hasAccess: boolean };

export function CustomerProjectAccess({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["project-customer-access", projectId];
  const path = `/projects/${encodeURIComponent(projectId)}/customers`;
  const customers = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await apiFetch(getApiUrl(path), {
        credentials: "include",
      });
      if (response.status === 403 || response.status === 404) return null;
      if (!response.ok) throw new Error("Cannot load customer access");
      return response.json() as Promise<Customer[]>;
    },
  });
  const update = useMutation({
    mutationFn: async (customer: Customer) => {
      const response = await apiFetch(
        getApiUrl(`${path}/${encodeURIComponent(customer.personId)}`),
        {
          method: customer.hasAccess ? "DELETE" : "PUT",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error("Cannot change customer access");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  if (customers.data === null) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-md font-medium">
        {t("customerInvitations:create.accessTitle")}
      </h2>
      {customers.isError || update.isError ? (
        <Alert variant="error">
          <AlertDescription>
            {t("customerInvitations:create.accessError")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Table>
        <TableBody>
          {customers.data?.map((customer) => (
            <TableRow key={customer.personId}>
              <TableCell>{customer.name ?? customer.personId}</TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => update.mutate(customer)}
                >
                  {customer.hasAccess
                    ? t("customerInvitations:create.revokeAccess")
                    : t("customerInvitations:create.grantAccess")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
