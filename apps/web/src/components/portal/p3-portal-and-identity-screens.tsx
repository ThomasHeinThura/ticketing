import { Link } from "@tanstack/react-router";
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
  Switch,
  Textarea,
} from "@taskdesk/ui";
import { type FormEvent, useState } from "react";
import PageTitle from "@/components/page-title";

type OrganisationSummary = {
  id: string;
  name: string;
  slug: string;
  primaryDomain: string;
  defaultVisibility: "organisation" | "private";
  slaTier: string;
  activeContacts: number;
  oidcEnabled: boolean;
  scimEnabled: boolean;
};
const INITIAL_ORGANISATIONS: OrganisationSummary[] = [
  {
    id: "org-acme",
    name: "Acme Corp",
    slug: "acme-corp",
    primaryDomain: "acme.example.com",
    defaultVisibility: "organisation",
    slaTier: "Enterprise Gold",
    activeContacts: 42,
    oidcEnabled: true,
    scimEnabled: true,
  },
  {
    id: "org-globex",
    name: "Globex Industries",
    slug: "globex-industries",
    primaryDomain: "globex.example.com",
    defaultVisibility: "private",
    slaTier: "Standard Commercial",
    activeContacts: 18,
    oidcEnabled: true,
    scimEnabled: false,
  },
];
function PortalHeaderNav() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4">
      {" "}
      <div className="flex items-center gap-3">
        {" "}
        <span className="font-semibold text-base">
          {" "}
          TaskDesk Support Portal{" "}
        </span>{" "}
        <Badge variant="outline">Customer</Badge>{" "}
      </div>{" "}
      <nav
        aria-label="Customer portal navigation"
        className="flex flex-wrap items-center gap-4 text-sm"
      >
        {" "}
        <Link className="font-medium" to={"/portal" as never}>
          {" "}
          Home{" "}
        </Link>{" "}
        <Link className="font-medium" to={"/portal/new" as never}>
          {" "}
          New Request{" "}
        </Link>{" "}
        <Link className="font-medium" to={"/portal/requests" as never}>
          {" "}
          My Requests{" "}
        </Link>{" "}
        <Link className="font-medium" to={"/portal/approvals" as never}>
          {" "}
          Approvals{" "}
        </Link>{" "}
        <Link className="font-medium" to={"/portal/projects" as never}>
          {" "}
          Projects{" "}
        </Link>{" "}
        <Link className="font-medium" to={"/portal/account" as never}>
          {" "}
          Account{" "}
        </Link>{" "}
      </nav>{" "}
    </header>
  );
}
export function AgentInviteAcceptScreen() {
  const [inviteToken, setInviteToken] = useState("inv_agent_2026_9f8a7c");
  const [displayName, setDisplayName] = useState("Alex Morgan");
  const [accepted, setAccepted] = useState(false);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inviteToken.trim()) return;
    setAccepted(true);
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Accept Agent Invitation" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl">
          {" "}
          Accept Workspace Invitation{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Verify your agent invitation token and confirm your operator profile
          to join the service desk workspace.{" "}
        </p>{" "}
      </div>{" "}
      {accepted ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Invitation accepted</p>{" "}
            <p className="text-xs">
              {" "}
              You have joined the TaskDesk Primary Service Desk workspace as{""}{" "}
              {displayName} with role Support Agent.{" "}
            </p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <div className="grid gap-6 md:grid-cols-2">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Invitation Details</CardTitle>{" "}
            <CardDescription>
              {" "}
              Review the workspace and role granted by this invitation.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-4">
            {" "}
            <div className="flex items-center justify-between">
              {" "}
              <span className="text-sm">Workspace</span>{" "}
              <span className="font-medium text-sm">
                {" "}
                TaskDesk Primary Service Desk{" "}
              </span>{" "}
            </div>{" "}
            <Separator />{" "}
            <div className="flex items-center justify-between">
              {" "}
              <span className="text-sm">Assigned Role</span>{" "}
              <Badge variant="info">Support Agent</Badge>{" "}
            </div>{" "}
            <Separator />{" "}
            <div className="flex items-center justify-between">
              {" "}
              <span className="text-sm">Status</span>{" "}
              <Badge variant={accepted ? "success" : "warning"}>
                {" "}
                {accepted ? "Accepted" : "Pending acceptance"}{" "}
              </Badge>{" "}
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Confirm & Join</CardTitle>{" "}
            <CardDescription>
              {" "}
              Confirm your invitation token and display name.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <form className="space-y-4" onSubmit={handleSubmit}>
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="agent-invite-token">Invitation Token</Label>{" "}
                <Input
                  id="agent-invite-token"
                  onChange={(e) => setInviteToken(e.target.value)}
                  value={inviteToken}
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="agent-invite-name">Display Name</Label>{" "}
                <Input
                  id="agent-invite-name"
                  onChange={(e) => setDisplayName(e.target.value)}
                  value={displayName}
                />{" "}
              </div>{" "}
              <Button disabled={accepted} type="submit">
                {" "}
                Accept invitation & join workspace{" "}
              </Button>{" "}
            </form>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
    </main>
  );
}
export function ProfileSecuritySettingsScreen() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(true);
  const [sessions, setSessions] = useState([
    {
      id: "sess-1",
      device: "macOS · Chrome 130 (Current session)",
      ip: "198.51.100.14",
      lastActive: "Just now",
      current: true,
    },
    {
      id: "sess-2",
      device: "iOS · Mobile Safari",
      ip: "198.51.100.49",
      lastActive: "2 hours ago",
      current: false,
    },
    {
      id: "sess-3",
      device: "Linux · Firefox 132",
      ip: "203.0.113.88",
      lastActive: "Yesterday",
      current: false,
    },
  ]);
  const handlePasswordUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) return;
    setPasswordSaved(true);
    setCurrentPassword("");
    setNewPassword("");
  };
  const revokeSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Security Settings" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl">
          {" "}
          Profile Security & Sessions{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Manage your account password, multi-factor authentication, and active
          browser sessions.{" "}
        </p>{" "}
      </div>{" "}
      {passwordSaved ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Password updated</p>{" "}
            <p className="text-xs">
              {" "}
              Your account password has been rotated and saved.{" "}
            </p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <div className="grid gap-6 md:grid-cols-2">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Change Password</CardTitle>{" "}
            <CardDescription>
              {" "}
              Use a strong passphrase of at least 12 characters.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <form className="space-y-4" onSubmit={handlePasswordUpdate}>
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="security-current-password">
                  {" "}
                  Current Password{" "}
                </Label>{" "}
                <Input
                  id="security-current-password"
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  type="password"
                  value={currentPassword}
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="security-new-password">New Password</Label>{" "}
                <Input
                  id="security-new-password"
                  onChange={(e) => setNewPassword(e.target.value)}
                  type="password"
                  value={newPassword}
                />{" "}
              </div>{" "}
              <Button type="submit">Update password</Button>{" "}
            </form>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Multi-Factor Authentication (TOTP)</CardTitle>{" "}
            <CardDescription>
              {" "}
              Protect your operator account with an authenticator app code.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-4">
            {" "}
            <div className="flex items-center justify-between">
              {" "}
              <div className="space-y-1">
                {" "}
                <p className="font-medium text-sm">
                  {" "}
                  Authenticator App Status{" "}
                </p>{" "}
                <p className="text-xs">
                  {" "}
                  Time-based one-time password (RFC 6238){" "}
                </p>{" "}
              </div>{" "}
              <Badge variant={totpEnabled ? "success" : "warning"}>
                {" "}
                {totpEnabled ? "Enrolled" : "Not enrolled"}{" "}
              </Badge>{" "}
            </div>{" "}
            <Separator />{" "}
            <div className="flex items-center justify-between">
              {" "}
              <Label htmlFor="totp-enrolment-toggle">
                {" "}
                Require TOTP verification at sign-in{" "}
              </Label>{" "}
              <Switch
                checked={totpEnabled}
                id="totp-enrolment-toggle"
                onCheckedChange={(checked) => setTotpEnabled(Boolean(checked))}
              />{" "}
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Active Browser Sessions</CardTitle>{" "}
          <CardDescription>
            {" "}
            Review devices currently signed into your account and revoke
            unrecognised sessions.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {" "}
              <thead>
                {" "}
                <tr>
                  {" "}
                  <th>Device & Browser</th> <th>IP Address</th>{" "}
                  <th>Last Active</th> <th>Action</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {sessions.map((session) => (
                  <tr key={session.id}>
                    {" "}
                    <td className="font-medium"> {session.device} </td>{" "}
                    <td className="font-mono text-xs"> {session.ip} </td>{" "}
                    <td className="text-sm"> {session.lastActive} </td>{" "}
                    <td>
                      {" "}
                      {session.current ? (
                        <Badge variant="outline">Current</Badge>
                      ) : (
                        <Button
                          onClick={() => revokeSession(session.id)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {" "}
                          Revoke session{" "}
                        </Button>
                      )}{" "}
                    </td>{" "}
                  </tr>
                ))}{" "}
              </tbody>{" "}
            </table>
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function GodModeOrganisationsListScreen() {
  const [organisations, setOrganisations] = useState<OrganisationSummary[]>(
    INITIAL_ORGANISATIONS,
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [primaryDomain, setPrimaryDomain] = useState("");
  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    const nextOrg: OrganisationSummary = {
      id: `org-${slug.trim().toLowerCase()}`,
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      primaryDomain: primaryDomain.trim() || `${slug.trim().toLowerCase()}.com`,
      defaultVisibility: "organisation",
      slaTier: "Standard Commercial",
      activeContacts: 1,
      oidcEnabled: false,
      scimEnabled: false,
    };
    setOrganisations((prev) => [...prev, nextOrg]);
    setName("");
    setSlug("");
    setPrimaryDomain("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Customer Organisations · God Mode" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl"> Customer Organisations </h1>{" "}
        <p className="text-sm">
          {" "}
          Manage customer tenants, request visibility defaults, SLA overrides,
          and federated identity providers.{" "}
        </p>{" "}
      </div>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Create Customer Organisation</CardTitle>{" "}
          <CardDescription>
            {" "}
            Register a new customer organisation for portal access and domain
            routing.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form className="grid gap-4 md:grid-cols-3" onSubmit={handleCreate}>
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="org-name-input">Organisation Name</Label>{" "}
              <Input
                id="org-name-input"
                onChange={(e) => setName(e.target.value)}
                placeholder="Initech Corp"
                value={name}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="org-slug-input">Organisation Slug</Label>{" "}
              <Input
                id="org-slug-input"
                onChange={(e) => setSlug(e.target.value)}
                placeholder="initech"
                value={slug}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="org-domain-input">Primary Verified Domain</Label>{" "}
              <Input
                id="org-domain-input"
                onChange={(e) => setPrimaryDomain(e.target.value)}
                placeholder="initech.example.com"
                value={primaryDomain}
              />{" "}
            </div>{" "}
            <div>
              {" "}
              <Button type="submit">Create organisation</Button>{" "}
            </div>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Organisations Directory</CardTitle>{" "}
          <CardDescription>
            {" "}
            All active customer organisations provisioned on this instance.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {" "}
              <thead>
                {" "}
                <tr>
                  {" "}
                  <th>Organisation</th> <th>Primary Domain</th>{" "}
                  <th>Visibility Default</th> <th>SLA Policy</th>{" "}
                  <th>Identity</th> <th>Actions</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {organisations.map((org) => (
                  <tr key={org.id}>
                    {" "}
                    <td>
                      {" "}
                      <div className="space-y-1">
                        {" "}
                        <p className="font-medium text-sm"> {org.name} </p>{" "}
                        <p className="font-mono text-xs"> {org.slug} </p>{" "}
                      </div>{" "}
                    </td>{" "}
                    <td className="font-mono text-xs"> {org.primaryDomain} </td>{" "}
                    <td>
                      {" "}
                      <Badge variant="outline">
                        {org.defaultVisibility}
                      </Badge>{" "}
                    </td>{" "}
                    <td className="text-sm"> {org.slaTier} </td>{" "}
                    <td>
                      {" "}
                      <div className="flex flex-wrap gap-2">
                        {" "}
                        <Badge
                          variant={org.oidcEnabled ? "success" : "secondary"}
                        >
                          {" "}
                          {org.oidcEnabled ? "OIDC" : "No OIDC"}{" "}
                        </Badge>{" "}
                        <Badge variant={org.scimEnabled ? "info" : "secondary"}>
                          {" "}
                          {org.scimEnabled ? "SCIM" : "No SCIM"}{" "}
                        </Badge>{" "}
                      </div>{" "}
                    </td>{" "}
                    <td>
                      {" "}
                      <div className="flex flex-wrap items-center gap-2">
                        {" "}
                        <Link
                          className="font-medium text-sm"
                          to={
                            `/agent/god-mode/organisations/${org.id}` as never
                          }
                        >
                          {" "}
                          Manage{" "}
                        </Link>{" "}
                        <Link
                          className="font-medium text-sm"
                          to={
                            `/agent/god-mode/organisations/${org.id}/identity` as never
                          }
                        >
                          {" "}
                          Identity{" "}
                        </Link>{" "}
                      </div>{" "}
                    </td>{" "}
                  </tr>
                ))}{" "}
              </tbody>{" "}
            </table>
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function GodModeOrganisationDetailScreen({ id }: { id: string }) {
  const existing =
    INITIAL_ORGANISATIONS.find((item) => item.id === id) ??
    INITIAL_ORGANISATIONS[0];
  const [defaultVisibility, setDefaultVisibility] = useState<
    "organisation" | "private"
  >(existing.defaultVisibility);
  const [slaTier, setSlaTier] = useState(existing.slaTier);
  const [saved, setSaved] = useState(false);
  const contacts = [
    {
      email: `alice@${existing.primaryDomain}`,
      name: "Alice Vance",
      role: "Organisation Manager",
    },
    {
      email: `bob@${existing.primaryDomain}`,
      name: "Bob Sterling",
      role: "Customer Requester",
    },
  ];
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`${existing.name} · God Mode`} />{" "}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="font-semibold text-2xl">
            {" "}
            {existing.name} ({id}){" "}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            Configure request sharing defaults, SLA policy overrides, and
            customer contacts.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex items-center gap-3">
          {" "}
          <Link
            className="font-medium text-sm"
            to={"/agent/god-mode/organisations" as never}
          >
            {" "}
            Back to organisations{" "}
          </Link>{" "}
          <Link
            className="font-medium text-sm"
            to={`/agent/god-mode/organisations/${id}/identity` as never}
          >
            {" "}
            Configure OIDC & SCIM Identity{" "}
          </Link>{" "}
        </div>{" "}
      </div>{" "}
      {saved ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Organisation settings saved</p>{" "}
            <p className="text-xs">
              {" "}
              Updated default visibility to {defaultVisibility} and SLA policy
              to{""} {slaTier}.{" "}
            </p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <div className="grid gap-6 md:grid-cols-2">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Portal & SLA Defaults</CardTitle>{" "}
            <CardDescription>
              {" "}
              Control how customer requests are shared within this organisation.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-4">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="org-sla-override">SLA Policy Override</Label>{" "}
              <Input
                id="org-sla-override"
                onChange={(e) => {
                  setSlaTier(e.target.value);
                  setSaved(false);
                }}
                value={slaTier}
              />{" "}
            </div>{" "}
            <div className="flex items-center justify-between">
              {" "}
              <Label htmlFor="org-visibility-switch">
                {" "}
                Share new requests across organisation by default{" "}
              </Label>{" "}
              <Switch
                checked={defaultVisibility === "organisation"}
                id="org-visibility-switch"
                onCheckedChange={(checked) => {
                  setDefaultVisibility(checked ? "organisation" : "private");
                  setSaved(false);
                }}
              />{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Badge variant="outline">
                {" "}
                Current default: {defaultVisibility}{" "}
              </Badge>{" "}
            </div>{" "}
            <Button onClick={() => setSaved(true)} type="button">
              {" "}
              Save organisation settings{" "}
            </Button>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Customer Contacts</CardTitle>{" "}
            <CardDescription>
              {" "}
              Designated portal members belonging to {existing.name}.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {" "}
                <thead>
                  {" "}
                  <tr>
                    {" "}
                    <th>Name</th> <th>Email</th> <th>Portal Role</th>{" "}
                  </tr>{" "}
                </thead>{" "}
                <tbody>
                  {" "}
                  {contacts.map((contact) => (
                    <tr key={contact.email}>
                      {" "}
                      <td className="font-medium"> {contact.name} </td>{" "}
                      <td className="font-mono text-xs"> {contact.email} </td>{" "}
                      <td>
                        {" "}
                        <Badge variant="secondary">{contact.role}</Badge>{" "}
                      </td>{" "}
                    </tr>
                  ))}{" "}
                </tbody>{" "}
              </table>
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
    </main>
  );
}
export function GodModeOrganisationIdentityScreen({ id }: { id: string }) {
  const existing =
    INITIAL_ORGANISATIONS.find((item) => item.id === id) ??
    INITIAL_ORGANISATIONS[0];
  const [issuerUrl, setIssuerUrl] = useState(
    `https://idp.${existing.primaryDomain}/oauth2/default`,
  );
  const [clientId, setClientId] = useState(`td_client_${id}`);
  const [jitEnabled, setJitEnabled] = useState(true);
  const [scimEnabled, setScimEnabled] = useState(existing.scimEnabled);
  const [domains, setDomains] = useState<string[]>([existing.primaryDomain]);
  const [newDomain, setNewDomain] = useState("");
  const handleAddDomain = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newDomain.trim()) return;
    setDomains((prev) => [...prev, newDomain.trim().toLowerCase()]);
    setNewDomain("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Identity · ${existing.name}`} />{" "}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="font-semibold text-2xl">
            {" "}
            Organisation Identity & SCIM ({id}){" "}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            Configure OIDC federation, verified email domains, and SCIM 2.0
            directory sync for {existing.name}.{" "}
          </p>{" "}
        </div>{" "}
        <Link
          className="font-medium text-sm"
          to={`/agent/god-mode/organisations/${id}` as never}
        >
          {" "}
          Back to organisation overview{" "}
        </Link>{" "}
      </div>{" "}
      <div className="grid gap-6 md:grid-cols-2">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>OIDC Single Sign-On</CardTitle>{" "}
            <CardDescription>
              {" "}
              Connect the customer identity provider for portal authentication.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-4">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="oidc-issuer-url">OIDC Issuer URL</Label>{" "}
              <Input
                id="oidc-issuer-url"
                onChange={(e) => setIssuerUrl(e.target.value)}
                value={issuerUrl}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="oidc-client-id">OIDC Client ID</Label>{" "}
              <Input
                id="oidc-client-id"
                onChange={(e) => setClientId(e.target.value)}
                value={clientId}
              />{" "}
            </div>{" "}
            <div className="flex items-center justify-between">
              {" "}
              <Label htmlFor="oidc-jit-switch">
                {" "}
                Enable Just-In-Time (JIT) customer provisioning{" "}
              </Label>{" "}
              <Switch
                checked={jitEnabled}
                id="oidc-jit-switch"
                onCheckedChange={(checked) => setJitEnabled(Boolean(checked))}
              />{" "}
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>SCIM 2.0 Directory Provisioning</CardTitle>{" "}
            <CardDescription>
              {" "}
              Automate customer contact lifecycle and group memberships.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-4">
            {" "}
            <div className="flex items-center justify-between">
              {" "}
              <span className="font-medium text-sm"> SCIM Token Status </span>{" "}
              <Badge variant={scimEnabled ? "success" : "secondary"}>
                {" "}
                {scimEnabled ? "Active Bearer Token" : "Disabled"}{" "}
              </Badge>{" "}
            </div>{" "}
            <Separator />{" "}
            <div className="flex items-center justify-between">
              {" "}
              <Label htmlFor="scim-sync-switch">
                {" "}
                Enable SCIM 2.0 directory synchronisation{" "}
              </Label>{" "}
              <Switch
                checked={scimEnabled}
                id="scim-sync-switch"
                onCheckedChange={(checked) => setScimEnabled(Boolean(checked))}
              />{" "}
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Verified Email Domains</CardTitle>{" "}
          <CardDescription>
            {" "}
            Domains mapped to this customer organisation for automatic routing.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={handleAddDomain}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="new-verified-domain">Add Verified Domain</Label>{" "}
              <Input
                id="new-verified-domain"
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="subsidiary.example.com"
                value={newDomain}
              />{" "}
            </div>{" "}
            <Button type="submit">Add domain</Button>{" "}
          </form>{" "}
          <div className="flex flex-wrap gap-2">
            {" "}
            {domains.map((domain) => (
              <Badge key={domain} variant="info">
                {" "}
                {domain}{" "}
              </Badge>
            ))}{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function PortalInviteAcceptScreen() {
  const [token, setToken] = useState("portal_inv_acme_8821");
  const [accepted, setAccepted] = useState(false);
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Accept Portal Invitation" /> <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl">
          {" "}
          Join Acme Corp Customer Portal{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Accept your customer organisation invitation to submit and track
          support requests.{" "}
        </p>{" "}
      </div>{" "}
      {accepted ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">
              Welcome to the Acme Corp Customer Portal
            </p>{" "}
            <p className="text-xs">
              {" "}
              Your customer account is active. You can now submit requests and
              view shared organisation tickets.{" "}
            </p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Customer Invitation Verification</CardTitle>{" "}
          <CardDescription>
            {" "}
            Confirm your invitation code to activate portal access.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="portal-invite-code">Invitation Code</Label>{" "}
            <Input
              id="portal-invite-code"
              onChange={(e) => setToken(e.target.value)}
              value={token}
            />{" "}
          </div>{" "}
          <Button
            disabled={accepted}
            onClick={() => setAccepted(true)}
            type="button"
          >
            {" "}
            Accept portal invitation{" "}
          </Button>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function PortalDashboardHomeScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const categories = [
    {
      key: "it-access",
      title: "IT Access Request",
      description: "Request SSO app permissions, VPN, or group membership.",
    },
    {
      key: "incident",
      title: "Report an Incident",
      description: "Report a service outage or degraded production system.",
    },
    {
      key: "hardware",
      title: "Hardware & Peripherals",
      description: "Request a replacement laptop, monitor, or security key.",
    },
  ];
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Customer Portal Home" /> <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl"> How can we help you today? </h1>{" "}
        <p className="text-sm">
          {" "}
          Search help topics, raise a new support request, or check the status
          of your existing submissions.{" "}
        </p>{" "}
      </div>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Search Help & Requests</CardTitle>{" "}
          <CardDescription>
            {" "}
            Find request types or search your submitted references.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-2">
          {" "}
          <Label htmlFor="portal-home-search">Search portal</Label>{" "}
          <Input
            id="portal-home-search"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for VPN access, billing, or request reference..."
            value={searchQuery}
          />{" "}
        </CardContent>{" "}
      </Card>{" "}
      <div className="grid gap-4 md:grid-cols-3">
        {" "}
        {categories
          .filter(
            (cat) =>
              !searchQuery.trim() ||
              cat.title.toLowerCase().includes(searchQuery.toLowerCase()),
          )
          .map((cat) => (
            <Card key={cat.key}>
              {" "}
              <CardHeader>
                {" "}
                <CardTitle>{cat.title}</CardTitle>{" "}
                <CardDescription>{cat.description}</CardDescription>{" "}
              </CardHeader>{" "}
              <CardContent>
                {" "}
                <Link
                  className="font-medium text-sm"
                  to={`/portal/new/${cat.key}` as never}
                >
                  {" "}
                  Open {cat.title} form{" "}
                </Link>{" "}
              </CardContent>{" "}
            </Card>
          ))}{" "}
      </div>{" "}
      <div className="grid gap-4 md:grid-cols-2">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Recent Requests Summary</CardTitle>{" "}
            <CardDescription>
              {" "}
              Your active submissions with the service desk.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-2">
            {" "}
            <div className="flex items-center justify-between">
              {" "}
              <Link
                className="font-medium text-sm"
                to={"/portal/requests/REQ-1042" as never}
              >
                {" "}
                REQ-1042 · SSO group access for staging cluster{" "}
              </Link>{" "}
              <Badge variant="info">In Progress</Badge>{" "}
            </div>{" "}
            <Separator />{" "}
            <div className="flex items-center justify-between">
              {" "}
              <Link
                className="font-medium text-sm"
                to={"/portal/requests/SUB-209" as never}
              >
                {" "}
                SUB-209 · New security key shipment{" "}
              </Link>{" "}
              <Badge variant="warning">Under Review</Badge>{" "}
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Pending Customer Actions</CardTitle>{" "}
            <CardDescription>
              {" "}
              Approvals and satisfaction surveys awaiting your input.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-2">
            {" "}
            <div className="flex items-center justify-between">
              {" "}
              <span className="text-sm"> 1 pending change approval </span>{" "}
              <Link
                className="font-medium text-sm"
                to={"/portal/approvals" as never}
              >
                {" "}
                Review approvals{" "}
              </Link>{" "}
            </div>{" "}
            <Separator />{" "}
            <div className="flex items-center justify-between">
              {" "}
              <span className="text-sm"> Rate resolved request REQ-1038 </span>{" "}
              <Link
                className="font-medium text-sm"
                to={"/portal/requests/REQ-1038/rate" as never}
              >
                {" "}
                Complete survey{" "}
              </Link>{" "}
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
    </main>
  );
}
export function PortalRequestsListScreen() {
  const [scope, setScope] = useState<"mine" | "org">("mine");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">(
    "all",
  );
  const [searchText, setSearchText] = useState("");
  const requests = [
    {
      ref: "REQ-1042",
      summary: "SSO group access for staging cluster",
      status: "open" as const,
      statusLabel: "Accepted · In Progress",
      scope: "mine" as const,
      updatedAt: "15 mins ago",
    },
    {
      ref: "SUB-209",
      summary: "New hardware security key request",
      status: "open" as const,
      statusLabel: "Under review by service desk",
      scope: "mine" as const,
      updatedAt: "1 hour ago",
    },
    {
      ref: "REQ-1038",
      summary: "Quarterly invoice reconciliation inquiry",
      status: "resolved" as const,
      statusLabel: "Resolved",
      scope: "org" as const,
      updatedAt: "2 days ago",
    },
  ];
  const filtered = requests.filter((req) => {
    if (scope === "mine" && req.scope !== "mine") return false;
    if (statusFilter !== "all" && req.status !== statusFilter) return false;
    if (
      searchText.trim() &&
      !req.summary.toLowerCase().includes(searchText.toLowerCase()) &&
      !req.ref.toLowerCase().includes(searchText.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="My Requests · Customer Portal" /> <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl"> Customer Support Requests </h1>{" "}
        <p className="text-sm">
          {" "}
          Track your personal submissions and requests shared across Acme Corp.{" "}
        </p>{" "}
      </div>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Filter Requests</CardTitle>{" "}
          <CardDescription>
            {" "}
            Filter by requester scope, lifecycle status, or reference keyword.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="flex flex-wrap items-center gap-3">
            {" "}
            <Button
              onClick={() => setScope("mine")}
              size="sm"
              type="button"
              variant={scope === "mine" ? "default" : "outline"}
            >
              {" "}
              My Requests{" "}
            </Button>{" "}
            <Button
              onClick={() => setScope("org")}
              size="sm"
              type="button"
              variant={scope === "org" ? "default" : "outline"}
            >
              {" "}
              All Acme Corp Requests{" "}
            </Button>{" "}
            <Separator orientation="vertical" />{" "}
            <Button
              onClick={() => setStatusFilter("all")}
              size="sm"
              type="button"
              variant={statusFilter === "all" ? "secondary" : "outline"}
            >
              {" "}
              All Statuses{" "}
            </Button>{" "}
            <Button
              onClick={() => setStatusFilter("open")}
              size="sm"
              type="button"
              variant={statusFilter === "open" ? "secondary" : "outline"}
            >
              {" "}
              Open{" "}
            </Button>{" "}
            <Button
              onClick={() => setStatusFilter("resolved")}
              size="sm"
              type="button"
              variant={statusFilter === "resolved" ? "secondary" : "outline"}
            >
              {" "}
              Resolved{" "}
            </Button>{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="portal-requests-filter-q">
              {" "}
              Search by reference or summary{" "}
            </Label>{" "}
            <Input
              id="portal-requests-filter-q"
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="e.g. REQ-1042 or SSO"
              value={searchText}
            />{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Matching Requests ({filtered.length})</CardTitle>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {" "}
              <thead>
                {" "}
                <tr>
                  {" "}
                  <th>Reference</th> <th>Summary</th> <th>Status</th>{" "}
                  <th>Updated</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {filtered.map((item) => (
                  <tr key={item.ref}>
                    {" "}
                    <td className="font-mono text-xs">
                      {" "}
                      <Link
                        className="font-medium"
                        to={`/portal/requests/${item.ref}` as never}
                      >
                        {" "}
                        {item.ref}{" "}
                      </Link>{" "}
                    </td>{" "}
                    <td className="text-sm"> {item.summary} </td>{" "}
                    <td>
                      {" "}
                      <Badge
                        variant={
                          item.status === "resolved" ? "success" : "info"
                        }
                      >
                        {" "}
                        {item.statusLabel}{" "}
                      </Badge>{" "}
                    </td>{" "}
                    <td className="text-xs"> {item.updatedAt} </td>{" "}
                  </tr>
                ))}{" "}
              </tbody>{" "}
            </table>
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function PortalRequestDetailScreen({ refParam }: { refParam: string }) {
  const isPreAcceptance = refParam.toUpperCase().startsWith("SUB-");
  const [replies, setReplies] = useState([
    {
      id: "rep-1",
      author: "Alice Vance (Customer)",
      timestamp: "Today at 09:15",
      body: "Hello Support, we need staging SSO access enabled for our deployment team.",
    },
    {
      id: "rep-2",
      author: "Service Desk Support",
      timestamp: "Today at 09:42",
      body: "Thank you for reaching out. We have verified your organisation domain and are provisioning the group.",
    },
  ]);
  const [replyText, setReplyText] = useState("");
  const handlePostReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!replyText.trim()) return;
    setReplies((prev) => [
      ...prev,
      {
        id: `rep-${prev.length + 1}`,
        author: "Alice Vance (Customer)",
        timestamp: "Just now",
        body: replyText.trim(),
      },
    ]);
    setReplyText("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Request ${refParam} · Customer Portal`} />{" "}
      <PortalHeaderNav />{" "}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <div className="flex items-center gap-2">
            {" "}
            <Badge variant="outline">{refParam}</Badge>{" "}
            <Badge variant={isPreAcceptance ? "warning" : "info"}>
              {" "}
              {isPreAcceptance
                ? "Under review by service desk"
                : "Accepted into work item"}{" "}
            </Badge>{" "}
          </div>{" "}
          <h1 className="font-semibold text-2xl">
            {" "}
            {refParam} · SSO group access for staging cluster{" "}
          </h1>{" "}
        </div>{" "}
        <Link
          className="font-medium text-sm"
          to={`/portal/requests/${refParam}/rate` as never}
        >
          {" "}
          Rate satisfaction for {refParam}{" "}
        </Link>{" "}
      </div>{" "}
      <section
        aria-label="Pre-acceptance submission status"
        className="rounded-md border p-4"
        data-testid="portal-submission-section"
      >
        {" "}
        <div className="flex flex-wrap items-center justify-between gap-4">
          {" "}
          <div className="space-y-1">
            {" "}
            <h2 className="font-semibold text-base">
              {" "}
              Submission Triage Status{" "}
            </h2>{" "}
            <p className="text-sm">
              {" "}
              {isPreAcceptance
                ? "Under review by service desk — your submission is queued for intake review before work item creation."
                : "Accepted into work item — your submission has been accepted and linked to an active service desk ticket."}{" "}
            </p>{" "}
          </div>{" "}
          <Badge variant={isPreAcceptance ? "warning" : "success"}>
            {" "}
            {isPreAcceptance
              ? "Under review by service desk"
              : "Accepted into work item"}{" "}
          </Badge>{" "}
        </div>{" "}
      </section>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Public Conversation Timeline</CardTitle>{" "}
          <CardDescription>
            {" "}
            Customer-visible updates and replies on this request.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          {replies.map((reply) => (
            <div className="space-y-1 rounded-md border p-4" key={reply.id}>
              {" "}
              <div className="flex items-center justify-between">
                {" "}
                <span className="font-medium text-sm"> {reply.author} </span>{" "}
                <span className="text-xs"> {reply.timestamp} </span>{" "}
              </div>{" "}
              <p className="text-sm">{reply.body}</p>{" "}
            </div>
          ))}{" "}
          <Separator />{" "}
          <form className="space-y-4" onSubmit={handlePostReply}>
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="portal-public-reply">Add a public reply</Label>{" "}
              <Textarea
                id="portal-public-reply"
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a message to the support team..."
                value={replyText}
              />{" "}
            </div>{" "}
            <Button type="submit">Post reply</Button>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function PortalNewCatalogueScreen() {
  const requestTypes = [
    {
      key: "it-access",
      name: "IT Access Request",
      sla: "4h target response",
      summary: "Request SSO roles, VPN credentials, or repository permissions.",
    },
    {
      key: "incident",
      name: "Report an Incident",
      sla: "1h target response",
      summary: "Report an urgent production outage or security concern.",
    },
    {
      key: "hardware",
      name: "Hardware & Peripherals",
      sla: "24h target response",
      summary: "Order laptops, docking stations, or YubiKey security tokens.",
    },
    {
      key: "billing",
      name: "Billing Inquiry",
      sla: "8h target response",
      summary:
        "Questions about invoices, subscription seats, or purchase orders.",
    },
  ];
  const [filterText, setFilterText] = useState("");
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Request Catalogue · Customer Portal" />{" "}
      <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl"> Submit a New Request </h1>{" "}
        <p className="text-sm">
          {" "}
          Choose a request category below to open the guided submission form.{" "}
        </p>{" "}
      </div>{" "}
      <div className="space-y-2">
        {" "}
        <Label htmlFor="catalogue-search-input">Filter request types</Label>{" "}
        <Input
          id="catalogue-search-input"
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter catalogue..."
          value={filterText}
        />{" "}
      </div>{" "}
      <div className="grid gap-4 md:grid-cols-2">
        {" "}
        {requestTypes
          .filter(
            (item) =>
              !filterText.trim() ||
              item.name.toLowerCase().includes(filterText.toLowerCase()),
          )
          .map((item) => (
            <Card key={item.key}>
              {" "}
              <CardHeader>
                {" "}
                <div className="flex items-center justify-between">
                  {" "}
                  <CardTitle>{item.name}</CardTitle>{" "}
                  <Badge variant="outline">{item.sla}</Badge>{" "}
                </div>{" "}
                <CardDescription>{item.summary}</CardDescription>{" "}
              </CardHeader>{" "}
              <CardContent>
                {" "}
                <Link
                  className="font-medium text-sm"
                  to={`/portal/new/${item.key}` as never}
                >
                  {" "}
                  Select {item.name}{" "}
                </Link>{" "}
              </CardContent>{" "}
            </Card>
          ))}{" "}
      </div>{" "}
    </main>
  );
}
export function PortalNewRequestFormScreen({ typeKey }: { typeKey: string }) {
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [visibility, setVisibility] = useState<"private" | "organisation">(
    "organisation",
  );
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!summary.trim()) return;
    setSubmittedRef("SUB-210");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`New Request (${typeKey}) · Customer Portal`} />{" "}
      <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <Badge variant="outline">Request Type: {typeKey}</Badge>{" "}
        <h1 className="font-semibold text-2xl"> Raise Request: {typeKey} </h1>{" "}
        <p className="text-sm">
          {" "}
          Provide the details below. Your submission will be reviewed by the
          service desk.{" "}
        </p>{" "}
      </div>{" "}
      {submittedRef ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">
              Submission received ({submittedRef})
            </p>{" "}
            <p className="text-xs">
              {" "}
              Your submission is now under review by the service desk.{""}{" "}
              <Link
                className="font-medium"
                to={`/portal/requests/${submittedRef}` as never}
              >
                {" "}
                View request {submittedRef}{" "}
              </Link>{" "}
            </p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Request Details</CardTitle>{" "}
          <CardDescription>
            {" "}
            All fields marked below are visible to your support team.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form className="space-y-4" onSubmit={handleSubmit}>
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="new-req-summary">Summary</Label>{" "}
              <Input
                id="new-req-summary"
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Brief summary of what you need"
                value={summary}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="new-req-details">Detailed Description</Label>{" "}
              <Textarea
                id="new-req-details"
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Include steps, affected systems, or business urgency..."
                value={details}
              />{" "}
            </div>{" "}
            <div className="flex items-center justify-between">
              {" "}
              <Label htmlFor="new-req-visibility">
                {" "}
                Share with my organisation (Acme Corp){" "}
              </Label>{" "}
              <Switch
                checked={visibility === "organisation"}
                id="new-req-visibility"
                onCheckedChange={(checked) =>
                  setVisibility(checked ? "organisation" : "private")
                }
              />{" "}
            </div>{" "}
            <Button type="submit">Submit request</Button>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function PortalApprovalsScreen() {
  const [note, setNote] = useState("");
  const [items, setItems] = useState([
    {
      id: "APR-401",
      ref: "REQ-1042",
      title: "Approve production SSO group elevation for 5 engineers",
      requestedBy: "Bob Sterling",
      status: "pending" as "pending" | "approved" | "rejected",
    },
  ]);
  const decide = (id: string, status: "approved" | "rejected") => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Customer Approvals · Customer Portal" />{" "}
      <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl"> Pending Customer Approvals </h1>{" "}
        <p className="text-sm">
          {" "}
          Review and authorise requests requiring organisation manager sign-off.{" "}
        </p>{" "}
      </div>{" "}
      <div className="space-y-4">
        {" "}
        {items.map((item) => (
          <Card key={item.id}>
            {" "}
            <CardHeader>
              {" "}
              <div className="flex items-center justify-between">
                {" "}
                <CardTitle>
                  {" "}
                  {item.id} · {item.title}{" "}
                </CardTitle>{" "}
                <Badge
                  variant={
                    item.status === "approved"
                      ? "success"
                      : item.status === "rejected"
                        ? "error"
                        : "warning"
                  }
                >
                  {" "}
                  {item.status}{" "}
                </Badge>{" "}
              </div>{" "}
              <CardDescription>
                {" "}
                Linked request: {item.ref} · Requested by {
                  item.requestedBy
                }{" "}
              </CardDescription>{" "}
            </CardHeader>{" "}
            <CardContent className="space-y-4">
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor={`approval-note-${item.id}`}>
                  {" "}
                  Decision Note (Optional){" "}
                </Label>{" "}
                <Input
                  id={`approval-note-${item.id}`}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add context for your approval or rejection..."
                  value={note}
                />{" "}
              </div>{" "}
              <div className="flex items-center gap-3">
                {" "}
                <Button
                  disabled={item.status !== "pending"}
                  onClick={() => decide(item.id, "approved")}
                  type="button"
                >
                  {" "}
                  Approve{" "}
                </Button>{" "}
                <Button
                  disabled={item.status !== "pending"}
                  onClick={() => decide(item.id, "rejected")}
                  type="button"
                  variant="outline"
                >
                  {" "}
                  Reject{" "}
                </Button>{" "}
              </div>{" "}
            </CardContent>{" "}
          </Card>
        ))}{" "}
      </div>{" "}
    </main>
  );
}
export function PortalProjectsListScreen() {
  const [filter, setFilter] = useState("");
  const projects = [
    {
      key: "ACME-ONBOARD",
      name: "Acme Enterprise Onboarding",
      status: "Active",
      openRequests: 4,
    },
    {
      key: "ACME-CLOUD",
      name: "Cloud Migration Support",
      status: "Active",
      openRequests: 2,
    },
  ];
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Shared Projects · Customer Portal" />{" "}
      <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl"> Shared Customer Projects </h1>{" "}
        <p className="text-sm">
          {" "}
          Browse delivery projects and shared service queues for your
          organisation.{" "}
        </p>{" "}
      </div>{" "}
      <div className="space-y-2">
        {" "}
        <Label htmlFor="portal-project-filter">Search shared projects</Label>{" "}
        <Input
          id="portal-project-filter"
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by project key or name..."
          value={filter}
        />{" "}
      </div>{" "}
      <div className="grid gap-4 md:grid-cols-2">
        {" "}
        {projects
          .filter(
            (proj) =>
              !filter.trim() ||
              proj.name.toLowerCase().includes(filter.toLowerCase()) ||
              proj.key.toLowerCase().includes(filter.toLowerCase()),
          )
          .map((proj) => (
            <Card key={proj.key}>
              {" "}
              <CardHeader>
                {" "}
                <div className="flex items-center justify-between">
                  {" "}
                  <CardTitle>{proj.name}</CardTitle>{" "}
                  <Badge variant="info">{proj.status}</Badge>{" "}
                </div>{" "}
                <CardDescription>
                  {" "}
                  Project Key: {proj.key} · {proj.openRequests} open customer
                  requests{" "}
                </CardDescription>{" "}
              </CardHeader>{" "}
              <CardContent>
                {" "}
                <Link
                  className="font-medium text-sm"
                  to={`/portal/projects/${proj.key}` as never}
                >
                  {" "}
                  View project {proj.key}{" "}
                </Link>{" "}
              </CardContent>{" "}
            </Card>
          ))}{" "}
      </div>{" "}
    </main>
  );
}
export function PortalProjectDetailScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const [milestoneFilter, setMilestoneFilter] = useState("");
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Project ${projectKey} · Customer Portal`} />{" "}
      <PortalHeaderNav />{" "}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <Badge variant="outline">{projectKey}</Badge>{" "}
          <h1 className="font-semibold text-2xl">
            {" "}
            Project Overview: {projectKey}{" "}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            Customer-visible project milestones and shared support requests.{" "}
          </p>{" "}
        </div>{" "}
        <Link className="font-medium text-sm" to={"/portal/projects" as never}>
          {" "}
          Back to projects{" "}
        </Link>{" "}
      </div>{" "}
      <div className="space-y-2">
        {" "}
        <Label htmlFor="project-milestone-search">Filter project items</Label>{" "}
        <Input
          id="project-milestone-search"
          onChange={(e) => setMilestoneFilter(e.target.value)}
          placeholder="Search project requests..."
          value={milestoneFilter}
        />{" "}
      </div>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Shared Project Requests</CardTitle>{" "}
          <CardDescription>
            {" "}
            Requests associated with {projectKey} visible to your organisation.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-3">
          {" "}
          <div className="flex items-center justify-between">
            {" "}
            <Link
              className="font-medium text-sm"
              to={"/portal/requests/REQ-1042" as never}
            >
              {" "}
              REQ-1042 · SSO group access for staging cluster{" "}
            </Link>{" "}
            <Badge variant="info">In Progress</Badge>{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="flex items-center justify-between">
            {" "}
            <Link
              className="font-medium text-sm"
              to={"/portal/requests/REQ-1038" as never}
            >
              {" "}
              REQ-1038 · Quarterly invoice reconciliation inquiry{" "}
            </Link>{" "}
            <Badge variant="success">Resolved</Badge>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function PortalSatisfactionSurveyScreen({
  refParam,
}: {
  refParam: string;
}) {
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Rate Request ${refParam} · Customer Portal`} />{" "}
      <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl">
          {" "}
          Customer Satisfaction Survey ({refParam}){" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Let us know how well we resolved request {refParam}.{" "}
        </p>{" "}
      </div>{" "}
      {submitted ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Thank you for your feedback</p>{" "}
            <p className="text-xs">
              {" "}
              Your {rating}/5 rating for {refParam} has been recorded.{" "}
            </p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Rate Your Support Experience</CardTitle>{" "}
          <CardDescription>
            {" "}
            Select a score from 1 (Very dissatisfied) to 5 (Very satisfied).{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form className="space-y-4" onSubmit={handleSubmit}>
            {" "}
            <div className="flex flex-wrap items-center gap-2">
              {" "}
              {[1, 2, 3, 4, 5].map((score) => (
                <Button
                  key={score}
                  onClick={() => setRating(score)}
                  type="button"
                  variant={rating === score ? "default" : "outline"}
                >
                  {" "}
                  {score} / 5{" "}
                </Button>
              ))}{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="csat-feedback-comment">
                {" "}
                Additional Feedback (Optional){" "}
              </Label>{" "}
              <Textarea
                id="csat-feedback-comment"
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tell us what went well or how we can improve..."
                value={comment}
              />{" "}
            </div>{" "}
            <Button disabled={submitted} type="submit">
              {" "}
              Submit rating{" "}
            </Button>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function PortalAccountScreen() {
  const [fullName, setFullName] = useState("Alice Vance");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [orgDigest, setOrgDigest] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Account Settings · Customer Portal" />{" "}
      <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl"> Customer Portal Account </h1>{" "}
        <p className="text-sm">
          {" "}
          Manage your customer profile, organisation membership, and email
          preferences.{" "}
        </p>{" "}
      </div>{" "}
      {saved ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Preferences updated</p>{" "}
            <p className="text-xs">
              {" "}
              Your portal account settings have been saved.{" "}
            </p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Profile & Notifications</CardTitle>{" "}
          <CardDescription>
            {" "}
            Member of Acme Corp (acme.example.com){" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="portal-account-name">Full Name</Label>{" "}
            <Input
              id="portal-account-name"
              onChange={(e) => {
                setFullName(e.target.value);
                setSaved(false);
              }}
              value={fullName}
            />{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="flex items-center justify-between">
            {" "}
            <Label htmlFor="portal-notify-replies">
              {" "}
              Email me when support replies to my requests{" "}
            </Label>{" "}
            <Switch
              checked={emailNotifications}
              id="portal-notify-replies"
              onCheckedChange={(checked) => {
                setEmailNotifications(Boolean(checked));
                setSaved(false);
              }}
            />{" "}
          </div>{" "}
          <div className="flex items-center justify-between">
            {" "}
            <Label htmlFor="portal-notify-digest">
              {" "}
              Receive weekly Acme Corp shared requests summary{" "}
            </Label>{" "}
            <Switch
              checked={orgDigest}
              id="portal-notify-digest"
              onCheckedChange={(checked) => {
                setOrgDigest(Boolean(checked));
                setSaved(false);
              }}
            />{" "}
          </div>{" "}
          <Button onClick={() => setSaved(true)} type="button">
            {" "}
            Save account preferences{" "}
          </Button>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function PortalNotFoundScreen() {
  const [attemptedLookup, setAttemptedLookup] = useState("");
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Page Not Found · Customer Portal" /> <PortalHeaderNav />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl">
          {" "}
          Page not found in Customer Portal{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          The page or request reference you requested could not be found or is
          not visible to your customer account.{" "}
        </p>{" "}
      </div>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Return to Customer Portal</CardTitle>{" "}
          <CardDescription>
            {" "}
            Check a request reference or return to the portal home screen.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="not-found-ref-lookup">
              {" "}
              Quick Request Reference Lookup{" "}
            </Label>{" "}
            <Input
              id="not-found-ref-lookup"
              onChange={(e) => setAttemptedLookup(e.target.value)}
              placeholder="e.g. REQ-1042"
              value={attemptedLookup}
            />{" "}
          </div>{" "}
          <div className="flex items-center gap-3">
            {" "}
            <Link className="font-medium text-sm" to={"/portal" as never}>
              {" "}
              Back to Customer Portal Home{" "}
            </Link>{" "}
            <Link
              className="font-medium text-sm"
              to={"/portal/requests" as never}
            >
              {" "}
              View My Requests{" "}
            </Link>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
