import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from "@taskdesk/ui";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { acceptCustomerInvitation } from "@/fetchers/customer-invitation";
import { portalAuthClient } from "@/lib/portal-auth-client";
import { routes } from "@/lib/routes";

/** The credential rides in the URL fragment (`#t=`), so it never reaches a server log. */
export function readInviteCredential(hash: string): string | null {
  const match = /^#?t=([A-Za-z0-9_-]{16,256})$/.exec(hash);
  return match?.[1] ?? null;
}

type SessionState = "loading" | "signed-in" | "signed-out";

/**
 * Create the account on the portal host and accept in the same request (CP-12): the server checks
 * the credential against the typed address, creates the customer person and membership, and only
 * then returns a session. Resolves "created", "exists" (an account for the address is already
 * there, sign in instead) or "refused" (the one generic notice).
 */
async function createInvitedAccount(input: {
  invitationId: string;
  credential: string;
  name: string;
  email: string;
  password: string;
}): Promise<"created" | "exists" | "refused"> {
  try {
    const result = await portalAuthClient.$fetch("/sign-up/email", {
      method: "POST",
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
        invitationId: input.invitationId,
        invitationCredential: input.credential,
      },
    });
    if (!result.error) return "created";
    return result.error.status === 422 ? "exists" : "refused";
  } catch {
    return "refused";
  }
}

/**
 * `/invite/{id}` on the portal host root (CP-24). The visitor signs in with a method of the
 * customer portal and then accepts; acceptance needs the credential from the email link and a
 * session whose verified address equals the invitation address. Every failure shows the one
 * generic notice below, which never says which check failed.
 */
export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const { t } = useTranslation("customerInvitations");
  // Read once, then take the fragment out of the address bar and history.
  const [credential] = useState(() =>
    typeof window === "undefined"
      ? null
      : readInviteCredential(window.location.hash),
  );
  const [session, setSession] = useState<SessionState>("loading");
  useEffect(() => {
    if (window.location.hash)
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    let live = true;
    portalAuthClient
      .getSession()
      .then((result) => {
        if (live)
          setSession(
            !result.error && result.data?.session ? "signed-in" : "signed-out",
          );
      })
      .catch(() => {
        if (live) setSession("signed-out");
      });
    return () => {
      live = false;
    };
  }, []);

  const accept = useMutation({
    mutationFn: () =>
      acceptCustomerInvitation(invitationId, credential as string),
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signUp = useMutation({
    mutationFn: () =>
      createInvitedAccount({
        invitationId,
        credential: credential as string,
        name,
        email,
        password,
      }),
  });
  const accountExists = signUp.data === "exists";
  const refused = accept.isError || signUp.data === "refused" || signUp.isError;
  const done = accept.isSuccess || signUp.data === "created";

  function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signUp.isPending) signUp.mutate();
  }

  const invalid = (
    <Alert variant="error">
      <AlertTitle>{t("accept.invalidTitle")}</AlertTitle>
      <AlertDescription>{t("accept.invalidDescription")}</AlertDescription>
    </Alert>
  );

  let body: React.ReactNode;
  if (!credential || refused) body = invalid;
  else if (done)
    body = (
      <Alert variant="success">
        <AlertTitle>{t("accept.acceptedTitle")}</AlertTitle>
        <AlertDescription>{t("accept.acceptedDescription")}</AlertDescription>
      </Alert>
    );
  else if (session === "loading")
    body = (
      <div role="status" aria-label={t("loading")}>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  else if (accountExists)
    body = (
      <Alert variant="error">
        <AlertTitle>{t("accept.accountExistsTitle")}</AlertTitle>
        <AlertDescription>
          {t("accept.accountExistsDescription")}
        </AlertDescription>
      </Alert>
    );
  else if (session === "signed-out")
    body = (
      <form className="space-y-4" onSubmit={submitSignUp}>
        <p className="text-sm">{t("accept.signUpHint")}</p>
        <label
          className="block space-y-2 text-sm font-medium"
          htmlFor="invite-name"
        >
          {t("accept.nameLabel")}
          <Input
            id="invite-name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label
          className="block space-y-2 text-sm font-medium"
          htmlFor="invite-email"
        >
          {t("accept.emailLabel")}
          <Input
            id="invite-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label
          className="block space-y-2 text-sm font-medium"
          htmlFor="invite-password"
        >
          {t("accept.passwordLabel")}
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <Button className="w-full" type="submit" disabled={signUp.isPending}>
          {signUp.isPending
            ? t("accept.creatingAccount")
            : t("accept.createAccount")}
        </Button>
      </form>
    );
  else body = <p className="text-sm">{t("accept.ready")}</p>;

  const showSignIn =
    credential &&
    !refused &&
    !done &&
    (session === "signed-out" || accountExists);

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("accept.title")}</CardTitle>
          <CardDescription>{t("accept.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{body}</CardContent>
        <CardFooter className="gap-2">
          {showSignIn ? (
            <Button
              variant={accountExists ? "default" : "link"}
              render={
                <Link
                  to="/sign-in"
                  search={{ stage: "email", factor: "totp" }}
                />
              }
            >
              {accountExists ? t("accept.signIn") : t("accept.haveAccount")}
            </Button>
          ) : null}
          {credential && !refused && !done && session === "signed-in" ? (
            <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
              {t("accept.action")}
            </Button>
          ) : null}
          {done ? (
            <Button render={<Link to={routes.portalHome.path} />}>
              {t("accept.continue")}
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </main>
  );
}
