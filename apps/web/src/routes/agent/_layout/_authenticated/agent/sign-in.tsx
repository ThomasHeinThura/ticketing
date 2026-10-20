import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
} from "@taskdesk/ui";
import { type FormEvent, useState } from "react";
import PageTitle from "@/components/page-title";
import { authClient } from "@/lib/auth-client";
export type AgentSignInSearch = { redirect?: string; provider?: string };
export function parseAgentSignInSearch(raw: unknown): AgentSignInSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(typeof value.redirect === "string" &&
    value.redirect.startsWith("/") &&
    !value.redirect.includes("//")
      ? { redirect: value.redirect }
      : {}),
    ...(typeof value.provider === "string" && value.provider.trim()
      ? { provider: value.provider.trim().slice(0, 100) }
      : {}),
  };
}
export const Route = createFileRoute("/_layout/_authenticated/agent/sign-in")({
  validateSearch: parseAgentSignInSearch,
  component: AgentSignInRoute,
});
const CONFIGURED_PROVIDERS = [
  {
    id: "oidc-corporate",
    name: "Corporate Single Sign-On (OIDC)",
    protocol: "OIDC",
    domainHint: "taskdesk.local",
  },
  {
    id: "saml-enterprise",
    name: "Enterprise Identity Federation (SAML 2.0)",
    protocol: "SAML",
    domainHint: "enterprise.example",
  },
] as const;
function AgentSignInRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>(
    search.provider ?? CONFIGURED_PROVIDERS[0].id,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handlePasswordSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    if (!email.trim() || !password) {
      setErrorMessage("Enter both your work email and password to sign in.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (result.error) {
        setErrorMessage(
          result.error.message ||
            "Invalid credentials. Check your email and password.",
        );
        return;
      }
      const target = search.redirect ?? "/agent";
      await navigate({ to: target as never });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to complete sign-in.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId);
    const provider = CONFIGURED_PROVIDERS.find(
      (item) => item.id === providerId,
    );
    setStatusMessage(
      provider
        ? `Selected ${provider.name} (${provider.protocol}). Continue with SSO or sign in with password below.`
        : null,
    );
  };
  return (
    <main className="flex min-h-screen w-full items-center justify-center p-6">
      {" "}
      <PageTitle title="Sign in · Agent" />{" "}
      <div className="flex w-full max-w-lg flex-col gap-6">
        {" "}
        <header className="space-y-1 text-center">
          {" "}
          <h1 className="text-2xl font-semibold">Sign in to TaskDesk Agent</h1>{" "}
          <p className="text-sm">
            {" "}
            Authenticate with your organisation identity provider or staff
            credentials.{" "}
          </p>{" "}
        </header>{" "}
        {errorMessage ? (
          <Card>
            <CardContent className="py-3 space-y-1">
              {" "}
              <p className="font-semibold text-sm">Sign-in failed</p>{" "}
              <p className="text-xs">{errorMessage}</p>{" "}
            </CardContent>
          </Card>
        ) : null}{" "}
        {statusMessage ? (
          <Card>
            <CardContent className="py-3 space-y-1">
              {" "}
              <p className="font-semibold text-sm">
                Identity provider selected
              </p>{" "}
              <p className="text-xs">{statusMessage}</p>{" "}
            </CardContent>
          </Card>
        ) : null}{" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle className="text-lg">
              Sign-in — provider chooser
            </CardTitle>{" "}
            <CardDescription>
              {" "}
              Choose your configured single sign-on provider or continue with
              email and password.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-4">
            {" "}
            <section
              aria-label="Sign-in — provider chooser"
              data-testid="agent-signin-provider-chooser"
              className="grid gap-3"
            >
              {" "}
              {CONFIGURED_PROVIDERS.map((provider) => {
                const isSelected = selectedProvider === provider.id;
                return (
                  <div
                    key={provider.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    {" "}
                    <div className="space-y-1">
                      {" "}
                      <div className="flex items-center gap-2">
                        {" "}
                        <span className="text-sm font-medium">
                          {provider.name}
                        </span>{" "}
                        <Badge variant={isSelected ? "secondary" : "outline"}>
                          {" "}
                          {provider.protocol}{" "}
                        </Badge>{" "}
                      </div>{" "}
                      <p className="text-xs">
                        {" "}
                        Domain: {provider.domainHint}{" "}
                      </p>{" "}
                    </div>{" "}
                    <Button
                      type="button"
                      size="sm"
                      variant={isSelected ? "secondary" : "outline"}
                      aria-pressed={isSelected}
                      onClick={() => handleProviderSelect(provider.id)}
                    >
                      {" "}
                      {isSelected ? "Selected" : "Choose provider"}{" "}
                    </Button>{" "}
                  </div>
                );
              })}{" "}
            </section>{" "}
            <Separator />{" "}
            <form
              onSubmit={(event) => void handlePasswordSignIn(event)}
              className="space-y-4"
            >
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="agent-signin-email">Work email</Label>{" "}
                <Input
                  id="agent-signin-email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@taskdesk.local"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="agent-signin-password">Password</Label>{" "}
                <Input
                  id="agent-signin-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />{" "}
              </div>{" "}
              <div className="flex items-center justify-end gap-2">
                {" "}
                <Button type="submit" disabled={isSubmitting}>
                  {" "}
                  {isSubmitting ? "Signing in..." : "Sign in"}{" "}
                </Button>{" "}
              </div>{" "}
            </form>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
    </main>
  );
}
