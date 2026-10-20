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

type NotificationEventPref = {
  id: string;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
  dailyDigest: boolean;
};
export function ProfileNotificationsSettingsScreen() {
  const [preferences, setPreferences] = useState<NotificationEventPref[]>([
    {
      id: "assignments",
      label: "Assignments",
      description: "When a work item is assigned to you or your primary team.",
      inApp: true,
      email: true,
      dailyDigest: false,
    },
    {
      id: "mentions",
      label: "Mentions",
      description:
        "When someone mentions your handle in comments or internal notes.",
      inApp: true,
      email: true,
      dailyDigest: false,
    },
    {
      id: "sla_warnings",
      label: "SLA Warnings",
      description:
        "When response or resolution targets approach breach thresholds.",
      inApp: true,
      email: true,
      dailyDigest: true,
    },
    {
      id: "approval_requests",
      label: "Approval Requests",
      description: "When a work item requires your approval decision.",
      inApp: true,
      email: true,
      dailyDigest: true,
    },
    {
      id: "customer_replies",
      label: "Customer Replies",
      description: "When a requester posts a reply on an active ticket.",
      inApp: true,
      email: false,
      dailyDigest: true,
    },
  ]);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [quietHoursWindow, setQuietHoursWindow] = useState("22:00 - 07:00");
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const toggleChannel = (
    id: string,
    channel: "inApp" | "email" | "dailyDigest",
    nextValue: boolean,
  ) => {
    setPreferences((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [channel]: nextValue } : item,
      ),
    );
    setSavedNotice(null);
  };
  const handleSave = () => {
    setSavedNotice("Notification preferences saved.");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Notification Preferences" />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">Notification Preferences</h1>{" "}
          <p className="text-sm">
            {" "}
            Configure how and when TaskDesk notifies you across channels.{" "}
          </p>{" "}
        </div>{" "}
        <Button onClick={handleSave} type="button">
          {" "}
          Save preferences{" "}
        </Button>{" "}
      </header>{" "}
      {savedNotice ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Preferences updated</p>{" "}
            <p className="text-xs">{savedNotice}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Per-Event Delivery Channels</CardTitle>{" "}
          <CardDescription>
            {" "}
            Toggle In-app, Email, and Daily Digest notifications for each event
            category.{" "}
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
                  <th>Event</th> <th>In-app</th> <th>Email</th>{" "}
                  <th>Daily Digest</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {preferences.map((pref) => (
                  <tr key={pref.id}>
                    {" "}
                    <td>
                      {" "}
                      <div className="space-y-1">
                        {" "}
                        <p className="text-sm font-medium">{pref.label}</p>{" "}
                        <p className="text-xs">{pref.description}</p>{" "}
                      </div>{" "}
                    </td>{" "}
                    <td>
                      {" "}
                      <Switch
                        aria-label={`${pref.label} In-app notification`}
                        checked={pref.inApp}
                        onCheckedChange={(checked) =>
                          toggleChannel(pref.id, "inApp", checked)
                        }
                      />{" "}
                    </td>{" "}
                    <td>
                      {" "}
                      <Switch
                        aria-label={`${pref.label} Email notification`}
                        checked={pref.email}
                        onCheckedChange={(checked) =>
                          toggleChannel(pref.id, "email", checked)
                        }
                      />{" "}
                    </td>{" "}
                    <td>
                      {" "}
                      <Switch
                        aria-label={`${pref.label} Daily Digest notification`}
                        checked={pref.dailyDigest}
                        onCheckedChange={(checked) =>
                          toggleChannel(pref.id, "dailyDigest", checked)
                        }
                      />{" "}
                    </td>{" "}
                  </tr>
                ))}{" "}
              </tbody>{" "}
            </table>
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Quiet Hours</CardTitle>{" "}
          <CardDescription>
            {" "}
            Pause non-urgent email and push notifications outside your working
            hours.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {" "}
            <div className="space-y-1">
              {" "}
              <Label htmlFor="quiet-hours-toggle">Enable Quiet Hours</Label>{" "}
              <p className="text-xs">
                {" "}
                Urgent SLA breach alerts can still bypass quiet hours when on
                call.{" "}
              </p>{" "}
            </div>{" "}
            <Switch
              aria-label="Enable Quiet Hours"
              checked={quietHoursEnabled}
              id="quiet-hours-toggle"
              onCheckedChange={setQuietHoursEnabled}
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="quiet-hours-window">
              Quiet Hours Schedule (Local Time)
            </Label>{" "}
            <Input
              disabled={!quietHoursEnabled}
              id="quiet-hours-window"
              onChange={(event) => setQuietHoursWindow(event.target.value)}
              value={quietHoursWindow}
            />{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type PersonalApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  expiresInDays: number;
  createdAt: string;
};
export function ProfileApiKeysSettingsScreen() {
  const [tokens, setTokens] = useState<PersonalApiKeyRecord[]>([
    {
      id: "key-1",
      name: "CLI Triage Script",
      prefix: "tdk_live_84a9",
      scopes: "work_item:read, work_item:transition",
      expiresInDays: 90,
      createdAt: "2026-10-01",
    },
    {
      id: "key-2",
      name: "Local MCP Inspector",
      prefix: "tdk_live_29c1",
      scopes: "work_item:read, kb:read",
      expiresInDays: 30,
      createdAt: "2026-10-12",
    },
  ]);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [scopes, setScopes] = useState("work_item:read, work_item:transition");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const handleCreateToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim() || "Personal Token";
    const parsedDays = Number.parseInt(expiresInDays, 10) || 90;
    const suffix = String(tokens.length + 101);
    const nextToken: PersonalApiKeyRecord = {
      id: `key-${Date.now()}`,
      name: trimmedName,
      prefix: `tdk_live_${suffix}`,
      scopes: scopes.trim() || "work_item:read",
      expiresInDays: parsedDays,
      createdAt: "2026-10-20",
    };
    setTokens((prev) => [nextToken, ...prev]);
    setRevealedToken(`tdk_live_${suffix}_secret_token_9f8e7d6c5b4a`);
    setName("");
  };
  const handleRevoke = (id: string) => {
    setTokens((prev) => prev.filter((token) => token.id !== id));
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Personal API Keys" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Personal API Keys</h1>{" "}
        <p className="text-sm">
          {" "}
          Issue and revoke scoped personal access tokens for CLI tools and API
          integrations.{" "}
        </p>{" "}
      </header>{" "}
      {revealedToken ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">One-time token reveal</p>{" "}
            <p className="text-xs">
              {" "}
              Copy your new personal API key now. It will not be shown again:
              {""} <code className="font-mono text-xs">
                {revealedToken}
              </code>{" "}
            </p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Create Personal Token</CardTitle>{" "}
          <CardDescription>
            {" "}
            Tokens inherit at most your own role capabilities and expire
            automatically.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form
            className="grid gap-4 md:grid-cols-3"
            onSubmit={handleCreateToken}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="api-key-name">Token Name</Label>{" "}
              <Input
                id="api-key-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Incident Export Job"
                value={name}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="api-key-expires">Expires In (Days)</Label>{" "}
              <Input
                id="api-key-expires"
                onChange={(event) => setExpiresInDays(event.target.value)}
                type="number"
                value={expiresInDays}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="api-key-scopes">Scopes</Label>{" "}
              <Input
                id="api-key-scopes"
                onChange={(event) => setScopes(event.target.value)}
                placeholder="work_item:read, work_item:transition"
                value={scopes}
              />{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button type="submit">Create token</Button>{" "}
            </div>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Active Personal Tokens</CardTitle>{" "}
          <CardDescription>
            {" "}
            Revoking a token immediately invalidates all requests using that
            credential.{" "}
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
                  <th>Name</th> <th>Prefix</th> <th>Scopes</th> <th>Expires</th>{" "}
                  <th>Created</th> <th>Actions</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {tokens.map((token) => (
                  <tr key={token.id}>
                    {" "}
                    <td className="font-medium">{token.name}</td>{" "}
                    <td className="font-mono text-xs">{token.prefix}</td>{" "}
                    <td className="text-xs">{token.scopes}</td>{" "}
                    <td>{token.expiresInDays} days</td>{" "}
                    <td>{token.createdAt}</td>{" "}
                    <td>
                      {" "}
                      <Button
                        onClick={() => handleRevoke(token.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {" "}
                        Revoke{" "}
                      </Button>{" "}
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
type TerminologyItem = {
  key: string;
  label: string;
  singular: string;
  plural: string;
};
const DEFAULT_TERMINOLOGY: TerminologyItem[] = [
  {
    key: "work_item",
    label: "Work Item",
    singular: "Work Item",
    plural: "Work Items",
  },
  { key: "project", label: "Project", singular: "Project", plural: "Projects" },
  { key: "cycle", label: "Cycle", singular: "Cycle", plural: "Cycles" },
  { key: "module", label: "Module", singular: "Module", plural: "Modules" },
  { key: "request", label: "Request", singular: "Request", plural: "Requests" },
];
export function WorkspaceTerminologySettingsScreen() {
  const [terms, setTerms] = useState<TerminologyItem[]>(DEFAULT_TERMINOLOGY);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const updateTerm = (
    key: string,
    field: "singular" | "plural",
    value: string,
  ) => {
    setTerms((prev) =>
      prev.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    );
    setStatusMessage(null);
  };
  const handleReset = () => {
    setTerms(DEFAULT_TERMINOLOGY);
    setStatusMessage("Terminology reset to platform defaults.");
  };
  const handleSave = () => {
    setStatusMessage("Workspace terminology overrides saved.");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace Terminology" />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">Workspace Terminology</h1>{" "}
          <p className="text-sm">
            {" "}
            Customize domain labels across the agent workspace and customer
            portal.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex items-center gap-2">
          {" "}
          <Button onClick={handleReset} type="button" variant="outline">
            {" "}
            Reset to Defaults{" "}
          </Button>{" "}
          <Button onClick={handleSave} type="button">
            {" "}
            Save{" "}
          </Button>{" "}
        </div>{" "}
      </header>{" "}
      {statusMessage ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Terminology status</p>{" "}
            <p className="text-xs">{statusMessage}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Concept Labels</CardTitle>{" "}
          <CardDescription>
            {" "}
            Override singular and plural nouns for core TaskDesk concepts.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          {terms.map((term) => (
            <div
              className="grid gap-4 border rounded-md p-4 md:grid-cols-3"
              key={term.key}
            >
              {" "}
              <div className="space-y-1">
                {" "}
                <p className="text-sm font-semibold">{term.label}</p>{" "}
                <p className="font-mono text-xs">{term.key}</p>{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor={`term-${term.key}-singular`}>
                  {term.label} Singular
                </Label>{" "}
                <Input
                  id={`term-${term.key}-singular`}
                  onChange={(event) =>
                    updateTerm(term.key, "singular", event.target.value)
                  }
                  value={term.singular}
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor={`term-${term.key}-plural`}>
                  {term.label} Plural
                </Label>{" "}
                <Input
                  id={`term-${term.key}-plural`}
                  onChange={(event) =>
                    updateTerm(term.key, "plural", event.target.value)
                  }
                  value={term.plural}
                />{" "}
              </div>{" "}
            </div>
          ))}{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type TeamAssignmentMode = "round_robin" | "load_balanced" | "manual";
type WorkspaceTeamRecord = {
  id: string;
  name: string;
  handle: string;
  assignmentMode: TeamAssignmentMode;
  memberCount: number;
};
export function WorkspaceTeamsListScreen() {
  const [teams, setTeams] = useState<WorkspaceTeamRecord[]>([
    {
      id: "tier-1-support",
      name: "Tier-1 Support",
      handle: "@tier1-support",
      assignmentMode: "round_robin",
      memberCount: 8,
    },
    {
      id: "platform-reliability",
      name: "Platform Reliability",
      handle: "@platform-sre",
      assignmentMode: "load_balanced",
      memberCount: 5,
    },
    {
      id: "security-operations",
      name: "Security Operations",
      handle: "@secops",
      assignmentMode: "manual",
      memberCount: 4,
    },
  ]);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [assignmentMode, setAssignmentMode] =
    useState<TeamAssignmentMode>("round_robin");
  const handleCreateTeam = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim() || "New Service Team";
    const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const nextTeam: WorkspaceTeamRecord = {
      id: slug || `team-${Date.now()}`,
      name: trimmedName,
      handle: handle.trim() || `@${slug}`,
      assignmentMode,
      memberCount: 1,
    };
    setTeams((prev) => [...prev, nextTeam]);
    setName("");
    setHandle("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace Teams" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace Teams</h1>{" "}
        <p className="text-sm">
          {" "}
          Organize responders into routing groups with automatic assignment
          strategies.{" "}
        </p>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Create Team</CardTitle>{" "}
          <CardDescription>
            {" "}
            Register a new team handle and choose its default intake assignment
            mode.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form
            className="grid gap-4 md:grid-cols-3"
            onSubmit={handleCreateTeam}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="team-name">Team Name</Label>{" "}
              <Input
                id="team-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Customer Escalations"
                value={name}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="team-handle">Handle</Label>{" "}
              <Input
                id="team-handle"
                onChange={(event) => setHandle(event.target.value)}
                placeholder="@escalations"
                value={handle}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="team-assignment-mode">Assignment Mode</Label>{" "}
              <Input
                id="team-assignment-mode"
                onChange={(event) =>
                  setAssignmentMode(
                    (event.target.value as TeamAssignmentMode) || "round_robin",
                  )
                }
                value={assignmentMode}
              />{" "}
              <div className="flex flex-wrap gap-2">
                {" "}
                {(["round_robin", "load_balanced", "manual"] as const).map(
                  (mode) => (
                    <Button
                      key={mode}
                      onClick={() => setAssignmentMode(mode)}
                      size="sm"
                      type="button"
                      variant={assignmentMode === mode ? "default" : "outline"}
                    >
                      {" "}
                      {mode}{" "}
                    </Button>
                  ),
                )}{" "}
              </div>{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button type="submit">Create team</Button>{" "}
            </div>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Teams Directory</CardTitle>{" "}
          <CardDescription>
            Select a team to manage members and on-call routing.
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
                  <th>Team</th> <th>Handle</th> <th>Assignment Mode</th>{" "}
                  <th>Members</th> <th>Details</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {teams.map((team) => (
                  <tr key={team.id}>
                    {" "}
                    <td className="font-medium">{team.name}</td>{" "}
                    <td className="font-mono text-xs">{team.handle}</td>{" "}
                    <td>
                      {" "}
                      <Badge variant="secondary">
                        {team.assignmentMode}
                      </Badge>{" "}
                    </td>{" "}
                    <td>{team.memberCount}</td>{" "}
                    <td>
                      {" "}
                      <Link
                        className="text-sm font-medium"
                        to={`/agent/settings/teams/${team.id}` as never}
                      >
                        {" "}
                        Manage team{" "}
                      </Link>{" "}
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
export function WorkspaceTeamDetailScreen({ id }: { id: string }) {
  const [teamLead, setTeamLead] = useState("Elena Rostova");
  const [assignmentStrategy, setAssignmentStrategy] =
    useState<TeamAssignmentMode>("round_robin");
  const [onCallEnabled, setOnCallEnabled] = useState(true);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("Responder");
  const [members, setMembers] = useState([
    { id: "m-1", name: "Elena Rostova", role: "Team Lead", active: true },
    { id: "m-2", name: "Marcus Vance", role: "Senior Responder", active: true },
    { id: "m-3", name: "Priya Nair", role: "Responder", active: true },
  ]);
  const handleAddMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newMemberName.trim();
    if (!trimmed) return;
    setMembers((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}`,
        name: trimmed,
        role: newMemberRole.trim() || "Responder",
        active: true,
      },
    ]);
    setNewMemberName("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Team ${id}`} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">Team Detail: {id}</h1>{" "}
          <p className="text-sm">
            {" "}
            Configure team lead, assignment strategy, on-call rotation, and
            membership.{" "}
          </p>{" "}
        </div>{" "}
        <Link
          className="text-sm font-medium"
          to={"/agent/settings/teams" as never}
        >
          {" "}
          Back to Teams{" "}
        </Link>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Routing & Leadership</CardTitle>{" "}
          <CardDescription>
            {" "}
            Control how incoming queue items distribute across active team
            responders.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="grid gap-4 md:grid-cols-2">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="team-lead-input">Team Lead</Label>{" "}
              <Input
                id="team-lead-input"
                onChange={(event) => setTeamLead(event.target.value)}
                value={teamLead}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="team-strategy-input">Assignment Strategy</Label>{" "}
              <Input
                id="team-strategy-input"
                onChange={(event) =>
                  setAssignmentStrategy(
                    (event.target.value as TeamAssignmentMode) || "round_robin",
                  )
                }
                value={assignmentStrategy}
              />{" "}
            </div>{" "}
          </div>{" "}
          <div className="flex flex-wrap items-center justify-between gap-4 border rounded-md p-4">
            {" "}
            <div className="space-y-1">
              {" "}
              <Label htmlFor="team-oncall-switch">
                On-Call Schedule Integration
              </Label>{" "}
              <p className="text-xs">
                {" "}
                Route urgent P1 incidents only to responders currently on shift.{" "}
              </p>{" "}
            </div>{" "}
            <Switch
              aria-label="On-Call Schedule Integration"
              checked={onCallEnabled}
              id="team-oncall-switch"
              onCheckedChange={setOnCallEnabled}
            />{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Team Members</CardTitle>{" "}
          <CardDescription>
            Add or remove agents assigned to {id}.
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <form
            className="grid gap-4 md:grid-cols-3"
            onSubmit={handleAddMember}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="add-member-name">Member Name</Label>{" "}
              <Input
                id="add-member-name"
                onChange={(event) => setNewMemberName(event.target.value)}
                placeholder="Jordan Lee"
                value={newMemberName}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="add-member-role">Team Role</Label>{" "}
              <Input
                id="add-member-role"
                onChange={(event) => setNewMemberRole(event.target.value)}
                value={newMemberRole}
              />{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button type="submit">Add member</Button>{" "}
            </div>{" "}
          </form>{" "}
          <Separator />{" "}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {" "}
              <thead>
                {" "}
                <tr>
                  {" "}
                  <th>Name</th> <th>Role</th> <th>Status</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {members.map((member) => (
                  <tr key={member.id}>
                    {" "}
                    <td className="font-medium">{member.name}</td>{" "}
                    <td>{member.role}</td>{" "}
                    <td>
                      {" "}
                      <Badge variant="secondary">
                        {member.active ? "Active" : "Away"}
                      </Badge>{" "}
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
type WorkspaceRoleRecord = {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
};
export function WorkspaceRolesListScreen() {
  const [roles, setRoles] = useState<WorkspaceRoleRecord[]>([
    {
      id: "workspace-admin",
      name: "Workspace Admin",
      description:
        "Full administrative access across workspace settings, roles, and projects.",
      builtIn: true,
    },
    {
      id: "service-desk-agent",
      name: "Service Desk Agent",
      description:
        "Triage queues, transition work items, manage SLA timers, and reply to customers.",
      builtIn: true,
    },
    {
      id: "project-lead",
      name: "Project Lead",
      description:
        "Configure project workflows, automations, cycles, and approvals.",
      builtIn: true,
    },
    {
      id: "viewer",
      name: "Viewer",
      description:
        "Read-only access to permitted projects and knowledge base articles.",
      builtIn: true,
    },
    {
      id: "incident-commander",
      name: "Incident Commander",
      description:
        "Custom role for cross-project major incident coordination and SLA overrides.",
      builtIn: false,
    },
  ]);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const handleCreateRole = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = roleName.trim() || "Custom Responder";
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    setRoles((prev) => [
      ...prev,
      {
        id: slug || `role-${Date.now()}`,
        name: trimmed,
        description: roleDescription.trim() || "Custom workspace role.",
        builtIn: false,
      },
    ]);
    setRoleName("");
    setRoleDescription("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace Roles" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace Roles</h1>{" "}
        <p className="text-sm">
          {" "}
          Manage built-in and custom RBAC roles mapped to fine-grained
          capabilities.{" "}
        </p>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Create Custom Role</CardTitle>{" "}
          <CardDescription>
            {" "}
            Define a new role and configure its capability matrix in the role
            editor.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={handleCreateRole}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="custom-role-name">Role Name</Label>{" "}
              <Input
                id="custom-role-name"
                onChange={(event) => setRoleName(event.target.value)}
                placeholder="Change Approver"
                value={roleName}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="custom-role-description">Description</Label>{" "}
              <Input
                id="custom-role-description"
                onChange={(event) => setRoleDescription(event.target.value)}
                placeholder="Can review and decide change approval gates."
                value={roleDescription}
              />{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button type="submit">Create custom role</Button>{" "}
            </div>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Roles Directory</CardTitle>{" "}
          <CardDescription>
            Built-in and custom roles in this workspace.
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
                  <th>Role</th> <th>Type</th> <th>Description</th>{" "}
                  <th>Capabilities</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {roles.map((role) => (
                  <tr key={role.id}>
                    {" "}
                    <td className="font-medium">{role.name}</td>{" "}
                    <td>
                      {" "}
                      <Badge variant={role.builtIn ? "secondary" : "outline"}>
                        {" "}
                        {role.builtIn ? "Built-in" : "Custom"}{" "}
                      </Badge>{" "}
                    </td>{" "}
                    <td className="text-sm"> {role.description} </td>{" "}
                    <td>
                      {" "}
                      <Link
                        className="text-sm font-medium"
                        to={`/agent/settings/roles/${role.id}` as never}
                      >
                        {" "}
                        Edit capabilities{" "}
                      </Link>{" "}
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
const ROLE_CAPABILITIES = [
  {
    key: "work_item:read",
    label: "Read work items",
    description:
      "View work items, comments, and timeline history within permitted projects.",
  },
  {
    key: "work_item:transition",
    label: "Transition work items",
    description:
      "Move work items across workflow statuses and update assignees.",
  },
  {
    key: "intake:triage",
    label: "Triage intake queue",
    description:
      "Accept, deduplicate, and route incoming service desk requests.",
  },
  {
    key: "sla:manage",
    label: "Manage SLA policies",
    description:
      "Configure SLA calendars, pause conditions, and breach escalations.",
  },
  {
    key: "approval:decide",
    label: "Decide approvals",
    description:
      "Approve or reject change requests and gated workflow transitions.",
  },
  {
    key: "workspace:settings:update",
    label: "Update workspace settings",
    description:
      "Modify workspace terminology, custom fields, webhooks, and governance rules.",
  },
] as const;
export function WorkspaceRoleEditorScreen({ id }: { id: string }) {
  const [enabledCapabilities, setEnabledCapabilities] = useState<
    Record<string, boolean>
  >({
    "work_item:read": true,
    "work_item:transition": true,
    "intake:triage": true,
    "sla:manage": false,
    "approval:decide": true,
    "workspace:settings:update": false,
  });
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const toggleCapability = (key: string, checked: boolean) => {
    setEnabledCapabilities((prev) => ({ ...prev, [key]: checked }));
    setSavedBanner(null);
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Role Editor: ${id}`} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">
            Role Capability Matrix: {id}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            Grant or revoke explicit RBAC capabilities for this role.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex items-center gap-2">
          {" "}
          <Link
            className="text-sm font-medium"
            to={"/agent/settings/roles" as never}
          >
            {" "}
            Back to Roles{" "}
          </Link>{" "}
          <Button
            onClick={() => setSavedBanner(`Role ${id} capabilities updated.`)}
            type="button"
          >
            {" "}
            Save role{" "}
          </Button>{" "}
        </div>{" "}
      </header>{" "}
      {savedBanner ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Role saved</p>{" "}
            <p className="text-xs">{savedBanner}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Capabilities</CardTitle>{" "}
          <CardDescription>
            {" "}
            Every route and mutation verifies these capability keys at runtime.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          {ROLE_CAPABILITIES.map((cap) => (
            <div
              className="flex flex-wrap items-center justify-between gap-4 border rounded-md p-4"
              key={cap.key}
            >
              {" "}
              <div className="space-y-1">
                {" "}
                <p className="font-mono text-sm font-semibold">{cap.key}</p>{" "}
                <p className="text-sm font-medium">{cap.label}</p>{" "}
                <p className="text-xs">{cap.description}</p>{" "}
              </div>{" "}
              <Switch
                aria-label={`Toggle ${cap.key}`}
                checked={Boolean(enabledCapabilities[cap.key])}
                onCheckedChange={(checked) =>
                  toggleCapability(cap.key, checked)
                }
              />{" "}
            </div>
          ))}{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type CustomFieldType = "text" | "select" | "number" | "date";
type CustomFieldRecord = {
  id: string;
  name: string;
  fieldKey: string;
  fieldType: CustomFieldType;
  section: string;
  required: boolean;
};
export function WorkspaceCustomFieldsScreen() {
  const [sections, setSections] = useState<string[]>([
    "Triage & Impact",
    "Infrastructure Context",
    "Governance & Billing",
  ]);
  const [newSectionName, setNewSectionName] = useState("");
  const [fields, setFields] = useState<CustomFieldRecord[]>([
    {
      id: "customer-impact",
      name: "Customer Impact",
      fieldKey: "customer_impact",
      fieldType: "select",
      section: "Triage & Impact",
      required: true,
    },
    {
      id: "environment",
      name: "Environment",
      fieldKey: "environment",
      fieldType: "select",
      section: "Infrastructure Context",
      required: true,
    },
    {
      id: "cost-center",
      name: "Cost Center",
      fieldKey: "cost_center",
      fieldType: "text",
      section: "Governance & Billing",
      required: false,
    },
    {
      id: "change-risk",
      name: "Change Risk",
      fieldKey: "change_risk",
      fieldType: "select",
      section: "Governance & Billing",
      required: true,
    },
  ]);
  const [name, setName] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [section, setSection] = useState("Triage & Impact");
  const handleCreateField = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim() || "New Custom Field";
    const resolvedKey =
      fieldKey.trim() || trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const slug = resolvedKey.replace(/_/g, "-");
    const targetSection = section.trim() || sections[0] || "General";
    if (!sections.includes(targetSection)) {
      setSections((prev) => [...prev, targetSection]);
    }
    setFields((prev) => [
      ...prev,
      {
        id: slug || `field-${Date.now()}`,
        name: trimmedName,
        fieldKey: resolvedKey,
        fieldType,
        section: targetSection,
        required: false,
      },
    ]);
    setName("");
    setFieldKey("");
  };
  const handleAddSection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newSectionName.trim();
    if (!trimmed || sections.includes(trimmed)) return;
    setSections((prev) => [...prev, trimmed]);
    setNewSectionName("");
  };
  const moveSection = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sections.length) return;
    setSections((prev) => {
      const copy = [...prev];
      const current = copy[index];
      const swap = copy[targetIndex];
      if (current === undefined || swap === undefined) return prev;
      copy[index] = swap;
      copy[targetIndex] = current;
      return copy;
    });
  };
  const moveFieldToNextSection = (fieldId: string) => {
    if (sections.length === 0) return;
    setFields((prev) =>
      prev.map((field) => {
        if (field.id !== fieldId) return field;
        const currentIdx = sections.indexOf(field.section);
        const nextSection =
          sections[(currentIdx + 1) % sections.length] ?? field.section;
        return { ...field, section: nextSection };
      }),
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Custom Fields" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace Custom Fields</h1>{" "}
        <p className="text-sm">
          {" "}
          Define typed custom fields and organize layout sections for work
          items.{" "}
        </p>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Create Custom Field</CardTitle>{" "}
          <CardDescription>
            {" "}
            Add a new schema field and assign it to a form section.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={handleCreateField}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="cf-name">Field Name</Label>{" "}
              <Input
                id="cf-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Affected Region"
                value={name}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="cf-key">Field Key</Label>{" "}
              <Input
                id="cf-key"
                onChange={(event) => setFieldKey(event.target.value)}
                placeholder="affected_region"
                value={fieldKey}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="cf-type">Field Type</Label>{" "}
              <Input
                id="cf-type"
                onChange={(event) =>
                  setFieldType(
                    (event.target.value as CustomFieldType) || "text",
                  )
                }
                value={fieldType}
              />{" "}
              <div className="flex flex-wrap gap-2">
                {" "}
                {(["text", "select", "number", "date"] as const).map(
                  (typeOption) => (
                    <Button
                      key={typeOption}
                      onClick={() => setFieldType(typeOption)}
                      size="sm"
                      type="button"
                      variant={fieldType === typeOption ? "default" : "outline"}
                    >
                      {" "}
                      {typeOption}{" "}
                    </Button>
                  ),
                )}{" "}
              </div>{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="cf-section">Section</Label>{" "}
              <Input
                id="cf-section"
                onChange={(event) => setSection(event.target.value)}
                value={section}
              />{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button type="submit">Create custom field</Button>{" "}
            </div>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <section
        aria-label="Section manager"
        className="space-y-4"
        data-testid="custom-fields-section-manager"
      >
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Section manager</CardTitle>{" "}
            <CardDescription>
              {" "}
              Reorder field sections, create new sections, and move fields
              between sections.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="space-y-4">
            {" "}
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={handleAddSection}
            >
              {" "}
              <Label htmlFor="new-section-name">New Section Name</Label>{" "}
              <Input
                id="new-section-name"
                onChange={(event) => setNewSectionName(event.target.value)}
                placeholder="Compliance & Audit"
                value={newSectionName}
              />{" "}
              <Button type="submit" variant="outline">
                {" "}
                Add section{" "}
              </Button>{" "}
            </form>{" "}
            <div className="space-y-2">
              {" "}
              {sections.map((sectionName, idx) => {
                const sectionFields = fields.filter(
                  (f) => f.section === sectionName,
                );
                return (
                  <div
                    className="flex flex-col gap-2 border rounded-md p-4"
                    key={sectionName}
                  >
                    {" "}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {" "}
                      <div className="flex items-center gap-2">
                        {" "}
                        <span className="text-sm font-semibold">
                          {" "}
                          {sectionName}{" "}
                        </span>{" "}
                        <Badge variant="secondary">
                          {sectionFields.length} fields
                        </Badge>{" "}
                      </div>{" "}
                      <div className="flex items-center gap-2">
                        {" "}
                        <Button
                          disabled={idx === 0}
                          onClick={() => moveSection(idx, -1)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {" "}
                          Move up{" "}
                        </Button>{" "}
                        <Button
                          disabled={idx === sections.length - 1}
                          onClick={() => moveSection(idx, 1)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {" "}
                          Move down{" "}
                        </Button>{" "}
                      </div>{" "}
                    </div>{" "}
                    <div className="flex flex-wrap items-center gap-2">
                      {" "}
                      {sectionFields.map((field) => (
                        <div
                          className="flex items-center gap-2 border rounded-md p-2"
                          key={field.id}
                        >
                          {" "}
                          <span className="text-xs font-medium">
                            {" "}
                            {field.name}{" "}
                          </span>{" "}
                          <Button
                            onClick={() => moveFieldToNextSection(field.id)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {" "}
                            Move section{" "}
                          </Button>{" "}
                        </div>
                      ))}{" "}
                    </div>{" "}
                  </div>
                );
              })}{" "}
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </section>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Custom Fields Directory</CardTitle>{" "}
          <CardDescription>
            Click any field to edit options and portal visibility.
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
                  <th>Field Name</th> <th>Key</th> <th>Type</th>{" "}
                  <th>Section</th> <th>Editor</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {fields.map((field) => (
                  <tr key={field.id}>
                    {" "}
                    <td className="font-medium">{field.name}</td>{" "}
                    <td className="font-mono text-xs">{field.fieldKey}</td>{" "}
                    <td>
                      {" "}
                      <Badge variant="outline">{field.fieldType}</Badge>{" "}
                    </td>{" "}
                    <td>{field.section}</td>{" "}
                    <td>
                      {" "}
                      <Link
                        className="text-sm font-medium"
                        to={
                          `/agent/settings/custom-fields/${field.id}` as never
                        }
                      >
                        {" "}
                        Configure field{" "}
                      </Link>{" "}
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
export function WorkspaceCustomFieldEditorScreen({ id }: { id: string }) {
  const [label, setLabel] = useState(
    id
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(""),
  );
  const [fieldKey, setFieldKey] = useState(id.replace(/-/g, "_"));
  const [fieldType, setFieldType] = useState<CustomFieldType>("select");
  const [required, setRequired] = useState(true);
  const [portalVisible, setPortalVisible] = useState(true);
  const [options, setOptions] = useState<string[]>([
    "Critical - Multi-tenant outage",
    "High - Degraded production feature",
    "Medium - Workaround available",
    "Low - Cosmetic or question",
  ]);
  const [newOption, setNewOption] = useState("");
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const handleAddOption = () => {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    setOptions((prev) => [...prev, trimmed]);
    setNewOption("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Custom Field: ${id}`} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">
            {" "}
            Custom Field Definition: {id}{" "}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            Configure field constraints, portal visibility, and allowed option
            values.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex items-center gap-2">
          {" "}
          <Link
            className="text-sm font-medium"
            to={"/agent/settings/custom-fields" as never}
          >
            {" "}
            Back to Custom Fields{" "}
          </Link>{" "}
          <Button
            onClick={() => setSavedNotice(`Custom field ${label} saved.`)}
            type="button"
          >
            {" "}
            Save{" "}
          </Button>{" "}
        </div>{" "}
      </header>{" "}
      {savedNotice ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Field updated</p>{" "}
            <p className="text-xs">{savedNotice}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Field Metadata & Constraints</CardTitle>{" "}
          <CardDescription>
            {" "}
            Control how this field is validated on agent forms and customer
            portal requests.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="grid gap-4 md:grid-cols-3">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="editor-field-label">Field Label</Label>{" "}
              <Input
                id="editor-field-label"
                onChange={(event) => setLabel(event.target.value)}
                value={label}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="editor-field-key">Field Key</Label>{" "}
              <Input
                id="editor-field-key"
                onChange={(event) => setFieldKey(event.target.value)}
                value={fieldKey}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="editor-field-type">Field Type</Label>{" "}
              <Input
                id="editor-field-type"
                onChange={(event) =>
                  setFieldType(
                    (event.target.value as CustomFieldType) || "select",
                  )
                }
                value={fieldType}
              />{" "}
            </div>{" "}
          </div>{" "}
          <div className="grid gap-4 md:grid-cols-2">
            {" "}
            <div className="flex items-center justify-between gap-4 border rounded-md p-4">
              {" "}
              <div className="space-y-1">
                {" "}
                <Label htmlFor="editor-required-toggle">Required Field</Label>{" "}
                <p className="text-xs">
                  {" "}
                  Require a value before work items can transition out of
                  triage.{" "}
                </p>{" "}
              </div>{" "}
              <Switch
                aria-label="Required Field"
                checked={required}
                id="editor-required-toggle"
                onCheckedChange={setRequired}
              />{" "}
            </div>{" "}
            <div className="flex items-center justify-between gap-4 border rounded-md p-4">
              {" "}
              <div className="space-y-1">
                {" "}
                <Label htmlFor="editor-portal-toggle">
                  Customer Portal Visibility
                </Label>{" "}
                <p className="text-xs">
                  {" "}
                  Display this field on customer-facing intake and request
                  detail views.{" "}
                </p>{" "}
              </div>{" "}
              <Switch
                aria-label="Customer Portal Visibility"
                checked={portalVisible}
                id="editor-portal-toggle"
                onCheckedChange={setPortalVisible}
              />{" "}
            </div>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Allowed Options</CardTitle>{" "}
          <CardDescription>
            {" "}
            Manage allowed values for select and multi-select custom fields.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="flex flex-wrap items-center gap-2">
            {" "}
            <Label htmlFor="new-allowed-option">New Option</Label>{" "}
            <Input
              id="new-allowed-option"
              onChange={(event) => setNewOption(event.target.value)}
              placeholder="Add option value"
              value={newOption}
            />{" "}
            <Button onClick={handleAddOption} type="button" variant="outline">
              {" "}
              Add option{" "}
            </Button>{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            {options.map((opt) => (
              <div
                className="flex items-center justify-between border rounded-md p-2"
                key={opt}
              >
                {" "}
                <span className="text-sm">{opt}</span>{" "}
                <Badge variant="secondary">Allowed</Badge>{" "}
              </div>
            ))}{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type AutomationRuleRecord = {
  id: string;
  name: string;
  triggerEvent: string;
  condition: string;
  action: string;
  enabled: boolean;
};
export function WorkspaceAutomationsScreen() {
  const [rules, setRules] = useState<AutomationRuleRecord[]>([
    {
      id: "auto-1",
      name: "Auto-assign urgent incidents",
      triggerEvent: "work_item.created",
      condition: "priority == 'urgent'",
      action: "assign_team('@tier1-support')",
      enabled: true,
    },
    {
      id: "auto-2",
      name: "Notify Slack/Webhook on SLA breach warning",
      triggerEvent: "sla.warning_threshold",
      condition: "remaining_minutes <= 15",
      action: "emit_webhook('sla-alerts')",
      enabled: true,
    },
    {
      id: "auto-3",
      name: "Reopen work item on customer reply",
      triggerEvent: "comment.created",
      condition: "author.role == 'customer' && status == 'resolved'",
      action: "transition_status('in_progress')",
      enabled: true,
    },
  ]);
  const [name, setName] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("work_item.created");
  const [condition, setCondition] = useState("priority == 'high'");
  const [action, setAction] = useState("assign_team('@platform-sre')");
  const handleCreateRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim() || "New Automation Rule";
    setRules((prev) => [
      ...prev,
      {
        id: `auto-${Date.now()}`,
        name: trimmed,
        triggerEvent: triggerEvent.trim() || "work_item.created",
        condition: condition.trim() || "true",
        action: action.trim() || "noop()",
        enabled: true,
      },
    ]);
    setName("");
  };
  const toggleRule = (id: string, enabled: boolean) => {
    setRules((prev) =>
      prev.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)),
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace Automations" />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">Workspace Automations</h1>{" "}
          <p className="text-sm">
            {" "}
            Event-driven rules evaluated across all projects with deterministic
            loop protection.{" "}
          </p>{" "}
        </div>{" "}
        <Badge variant="secondary">Max depth: 3</Badge>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Create Automation Rule</CardTitle>{" "}
          <CardDescription>
            {" "}
            Define trigger event, condition expression, and automated action.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={handleCreateRule}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="auto-rule-name">Rule Name</Label>{" "}
              <Input
                id="auto-rule-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Escalate high-risk changes"
                value={name}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="auto-rule-trigger">Trigger Event</Label>{" "}
              <Input
                id="auto-rule-trigger"
                onChange={(event) => setTriggerEvent(event.target.value)}
                value={triggerEvent}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="auto-rule-condition">Condition</Label>{" "}
              <Input
                id="auto-rule-condition"
                onChange={(event) => setCondition(event.target.value)}
                value={condition}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="auto-rule-action">Action</Label>{" "}
              <Input
                id="auto-rule-action"
                onChange={(event) => setAction(event.target.value)}
                value={action}
              />{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button type="submit">Create automation rule</Button>{" "}
            </div>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Active Automation Rules</CardTitle>{" "}
          <CardDescription>
            {" "}
            Loop-guard enforces a maximum recursion depth (Max depth: 3) per
            event chain.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          {rules.map((rule) => (
            <div
              className="flex flex-wrap items-center justify-between gap-4 border rounded-md p-4"
              key={rule.id}
            >
              {" "}
              <div className="space-y-1">
                {" "}
                <div className="flex items-center gap-2">
                  {" "}
                  <p className="text-sm font-semibold">{rule.name}</p>{" "}
                  <Badge variant="outline">Max depth: 3</Badge>{" "}
                </div>{" "}
                <p className="font-mono text-xs">
                  {" "}
                  WHEN {rule.triggerEvent} IF {rule.condition} THEN{" "}
                  {rule.action}{" "}
                </p>{" "}
              </div>{" "}
              <Switch
                aria-label={`Enable ${rule.name}`}
                checked={rule.enabled}
                onCheckedChange={(checked) => toggleRule(rule.id, checked)}
              />{" "}
            </div>
          ))}{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type WebhookEndpointRecord = {
  id: string;
  name: string;
  targetUrl: string;
  events: string;
  active: boolean;
};
export function WorkspaceWebhooksListScreen() {
  const [webhooks, setWebhooks] = useState<WebhookEndpointRecord[]>([
    {
      id: "wh-pagerduty",
      name: "PagerDuty Incident Bridge",
      targetUrl: "https://events.pagerduty.com/v2/enqueue",
      events: "work_item.created, sla.breached",
      active: true,
    },
    {
      id: "wh-audit-siem",
      name: "SIEM Audit Collector",
      targetUrl: "https://siem.internal.example/hooks/taskdesk",
      events: "work_item.transitioned, approval.decided",
      active: true,
    },
  ]);
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [events, setEvents] = useState(
    "work_item.created, work_item.transitioned",
  );
  const handleCreateWebhook = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim() || "Outbound Webhook";
    const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    setWebhooks((prev) => [
      ...prev,
      {
        id: `wh-${slug || Date.now()}`,
        name: trimmedName,
        targetUrl: targetUrl.trim() || "https://example.com/webhook",
        events: events.trim() || "work_item.created",
        active: true,
      },
    ]);
    setName("");
    setTargetUrl("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Outbound Webhooks" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Outbound Webhooks</h1>{" "}
        <p className="text-sm">
          {" "}
          Deliver HMAC-signed domain events to external incident and compliance
          endpoints.{" "}
        </p>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Create Webhook</CardTitle>{" "}
          <CardDescription>
            {" "}
            Register an HTTPS target URL and subscribe to domain event keys.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form
            className="grid gap-4 md:grid-cols-3"
            onSubmit={handleCreateWebhook}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="webhook-name">Webhook Name</Label>{" "}
              <Input
                id="webhook-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Slack Ops Relay"
                value={name}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="webhook-url">Target URL</Label>{" "}
              <Input
                id="webhook-url"
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="https://hooks.example.com/taskdesk"
                value={targetUrl}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="webhook-events">Subscribed Events</Label>{" "}
              <Input
                id="webhook-events"
                onChange={(event) => setEvents(event.target.value)}
                value={events}
              />{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button type="submit">Create webhook</Button>{" "}
            </div>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Configured Endpoints</CardTitle>{" "}
          <CardDescription>
            {" "}
            Inspect endpoint configuration or view recent delivery logs.{" "}
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
                  <th>Name</th> <th>Target URL</th> <th>Events</th>{" "}
                  <th>Configuration</th> <th>Deliveries</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {webhooks.map((wh) => (
                  <tr key={wh.id}>
                    {" "}
                    <td className="font-medium">{wh.name}</td>{" "}
                    <td className="font-mono text-xs">{wh.targetUrl}</td>{" "}
                    <td className="font-mono text-xs"> {wh.events} </td>{" "}
                    <td>
                      {" "}
                      <Link
                        className="text-sm font-medium"
                        to={`/agent/settings/webhooks/${wh.id}` as never}
                      >
                        {" "}
                        Edit endpoint{" "}
                      </Link>{" "}
                    </td>{" "}
                    <td>
                      {" "}
                      <Link
                        className="text-sm font-medium"
                        to={
                          `/agent/settings/webhooks/${wh.id}/deliveries` as never
                        }
                      >
                        {" "}
                        Delivery history{" "}
                      </Link>{" "}
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
const WEBHOOK_EVENT_KEYS = [
  "work_item.created",
  "work_item.transitioned",
  "sla.breached",
  "approval.decided",
] as const;
export function WorkspaceWebhookEditorScreen({ id }: { id: string }) {
  const [endpointUrl, setEndpointUrl] = useState(
    `https://hooks.internal.example/endpoints/${id}`,
  );
  const [subscribed, setSubscribed] = useState<Record<string, boolean>>({
    "work_item.created": true,
    "work_item.transitioned": true,
    "sla.breached": true,
    "approval.decided": false,
  });
  const [signingSecret, setSigningSecret] = useState("whsec_94f1a2c8e7d6b5a4");
  const [pingResult, setPingResult] = useState<string | null>(null);
  const handleRotateSecret = () => {
    setSigningSecret(`whsec_rotated_${Date.now().toString(36)}`);
    setPingResult("HMAC signing secret rotated.");
  };
  const handleTestPing = () => {
    setPingResult(
      `Test delivery ping sent to ${endpointUrl} (200 OK in 118ms).`,
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Webhook Editor: ${id}`} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">Webhook Endpoint: {id}</h1>{" "}
          <p className="text-sm">
            {" "}
            Manage endpoint URL, subscribed domain event keys, and HMAC signing
            secrets.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex items-center gap-2">
          {" "}
          <Link
            className="text-sm font-medium"
            to={`/agent/settings/webhooks/${id}/deliveries` as never}
          >
            {" "}
            View delivery history{" "}
          </Link>{" "}
          <Button onClick={handleTestPing} type="button" variant="outline">
            {" "}
            Test delivery ping{" "}
          </Button>{" "}
        </div>{" "}
      </header>{" "}
      {pingResult ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Webhook diagnostic</p>{" "}
            <p className="text-xs">{pingResult}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Endpoint & Signing Secret</CardTitle>{" "}
          <CardDescription>
            {" "}
            Payloads include an X-TaskDesk-Signature-256 header computed with
            this HMAC secret.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="webhook-editor-url">Endpoint URL</Label>{" "}
            <Input
              id="webhook-editor-url"
              onChange={(event) => setEndpointUrl(event.target.value)}
              value={endpointUrl}
            />{" "}
          </div>{" "}
          <div className="flex flex-wrap items-center justify-between gap-4 border rounded-md p-4">
            {" "}
            <div className="space-y-1">
              {" "}
              <p className="text-sm font-medium">HMAC Signing Secret</p>{" "}
              <p className="font-mono text-xs">{signingSecret}</p>{" "}
            </div>{" "}
            <Button
              onClick={handleRotateSecret}
              type="button"
              variant="outline"
            >
              {" "}
              Rotate signing secret{" "}
            </Button>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Subscribed Event Keys</CardTitle>{" "}
          <CardDescription>
            Select which domain events trigger a delivery.
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          {WEBHOOK_EVENT_KEYS.map((eventKey) => (
            <div
              className="flex items-center justify-between border rounded-md p-4"
              key={eventKey}
            >
              {" "}
              <span className="font-mono text-sm">{eventKey}</span>{" "}
              <Switch
                aria-label={`Subscribe to ${eventKey}`}
                checked={Boolean(subscribed[eventKey])}
                onCheckedChange={(checked) =>
                  setSubscribed((prev) => ({ ...prev, [eventKey]: checked }))
                }
              />{" "}
            </div>
          ))}{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type WebhookDeliveryRecord = {
  deliveryId: string;
  eventKey: string;
  httpStatus: string;
  latency: string;
  payloadSummary: string;
  retrying?: boolean;
};
export function WorkspaceWebhookDeliveriesScreen({ id }: { id: string }) {
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRecord[]>([
    {
      deliveryId: "del_901a",
      eventKey: "work_item.created",
      httpStatus: "200 OK",
      latency: "142ms",
      payloadSummary: '{"workItemKey":"SUP-104","priority":"urgent"}',
    },
    {
      deliveryId: "del_901b",
      eventKey: "sla.breached",
      httpStatus: "502 Bad Gateway",
      latency: "2140ms",
      payloadSummary: '{"workItemKey":"SUP-098","target":"first_response"}',
    },
    {
      deliveryId: "del_901c",
      eventKey: "approval.decided",
      httpStatus: "200 OK",
      latency: "96ms",
      payloadSummary: '{"workItemKey":"OPS-221","decision":"approved"}',
    },
  ]);
  const handleRedeliver = (deliveryId: string) => {
    setDeliveries((prev) =>
      prev.map((item) =>
        item.deliveryId === deliveryId
          ? { ...item, httpStatus: "200 OK", latency: "110ms", retrying: true }
          : item,
      ),
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Webhook Deliveries: ${id}`} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">
            {" "}
            Webhook Delivery Attempts: {id}{" "}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            Inspect HTTP status codes, latency, and trigger manual redelivery.{" "}
          </p>{" "}
        </div>{" "}
        <Link
          className="text-sm font-medium"
          to={`/agent/settings/webhooks/${id}` as never}
        >
          {" "}
          Back to Endpoint Editor{" "}
        </Link>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Delivery Log</CardTitle>{" "}
          <CardDescription>
            Recent delivery attempts for webhook {id}.
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
                  <th>Delivery ID</th> <th>Event Key</th> <th>HTTP Status</th>{" "}
                  <th>Latency</th> <th>Payload Summary</th> <th>
                    Actions
                  </th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {deliveries.map((item) => (
                  <tr key={item.deliveryId}>
                    {" "}
                    <td className="font-mono text-xs">{item.deliveryId}</td>{" "}
                    <td className="font-mono text-xs">{item.eventKey}</td>{" "}
                    <td>
                      {" "}
                      <Badge
                        variant={
                          item.httpStatus.startsWith("200")
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {" "}
                        {item.httpStatus}{" "}
                      </Badge>{" "}
                    </td>{" "}
                    <td>{item.latency}</td>{" "}
                    <td className="font-mono text-xs">
                      {" "}
                      {item.payloadSummary}{" "}
                    </td>{" "}
                    <td>
                      {" "}
                      <Button
                        onClick={() => handleRedeliver(item.deliveryId)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {" "}
                        Redeliver{" "}
                      </Button>{" "}
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
type ProjectFeatureModule = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};
export function ProjectFeaturesSettingsScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const [modules, setModules] = useState<ProjectFeatureModule[]>([
    {
      key: "service_desk_intake",
      label: "Service desk intake",
      description:
        "Enable email/portal request queues and triage workflows for this project.",
      enabled: true,
    },
    {
      key: "sla_tracking",
      label: "SLA tracking",
      description: "Attach first-response and resolution timers to work items.",
      enabled: true,
    },
    {
      key: "approvals",
      label: "Approvals",
      description:
        "Require change advisory or manager sign-off on gated status transitions.",
      enabled: true,
    },
    {
      key: "customer_portal_visibility",
      label: "Customer portal visibility",
      description:
        "Allow external customers to submit and track requests in this project.",
      enabled: true,
    },
    {
      key: "cycles",
      label: "Cycles",
      description: "Group engineering work into time-boxed iterations.",
      enabled: false,
    },
    {
      key: "modules",
      label: "Modules",
      description:
        "Organize work items by product subsystem or feature stream.",
      enabled: true,
    },
    {
      key: "time_tracking",
      label: "Time tracking",
      description:
        "Record billable and non-billable effort logs on work items.",
      enabled: false,
    },
  ]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const toggleModule = (key: string, enabled: boolean) => {
    setModules((prev) =>
      prev.map((mod) => (mod.key === key ? { ...mod, enabled } : mod)),
    );
    setSavedNotice(null);
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Project Features · ${projectKey}`} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">
            {" "}
            Project Feature Modules ({projectKey}){" "}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            Enable or disable capabilities scoped to project {projectKey}.{" "}
          </p>{" "}
        </div>{" "}
        <Button
          onClick={() =>
            setSavedNotice(`Feature modules updated for project ${projectKey}.`)
          }
          type="button"
        >
          {" "}
          Save{" "}
        </Button>{" "}
      </header>{" "}
      {savedNotice ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Project configuration saved</p>{" "}
            <p className="text-xs">{savedNotice}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Feature Toggles</CardTitle>{" "}
          <CardDescription>
            {" "}
            Disabling a module hides its navigation tabs and UI panels without
            deleting historical data.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          {modules.map((mod) => (
            <div
              className="flex flex-wrap items-center justify-between gap-4 border rounded-md p-4"
              key={mod.key}
            >
              {" "}
              <div className="space-y-1">
                {" "}
                <p className="text-sm font-semibold">{mod.label}</p>{" "}
                <p className="text-xs">{mod.description}</p>{" "}
              </div>{" "}
              <Switch
                aria-label={`Toggle ${mod.label}`}
                checked={mod.enabled}
                onCheckedChange={(checked) => toggleModule(mod.key, checked)}
              />{" "}
            </div>
          ))}{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type ProjectAutomationRecord = {
  id: string;
  name: string;
  scope: "project" | "workspace_override";
  trigger: string;
  action: string;
  enabled: boolean;
};
export function ProjectAutomationsSettingsScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const [rules, setRules] = useState<ProjectAutomationRecord[]>([
    {
      id: "proj-auto-1",
      name: `Route ${projectKey} security tickets to SecOps`,
      scope: "project",
      trigger: "work_item.created",
      action: "assign_team('@secops')",
      enabled: true,
    },
    {
      id: "proj-auto-2",
      name: "Auto-assign urgent incidents (Workspace Override)",
      scope: "workspace_override",
      trigger: "work_item.created",
      action: "assign_team('@tier1-support')",
      enabled: true,
    },
  ]);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("work_item.transitioned");
  const [action, setAction] = useState("request_approval('project-lead')");
  const [notes, setNotes] = useState("");
  const handleCreateRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim() || `${projectKey} Custom Rule`;
    setRules((prev) => [
      ...prev,
      {
        id: `proj-auto-${Date.now()}`,
        name: trimmed,
        scope: "project",
        trigger: trigger.trim() || "work_item.created",
        action: action.trim() || "noop()",
        enabled: true,
      },
    ]);
    setName("");
    setNotes("");
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`Project Automations · ${projectKey}`} />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">
          {" "}
          Project Automations ({projectKey}){" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Configure project-level automation rules and workspace rule overrides
          for {projectKey}.{" "}
        </p>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Create Project Rule</CardTitle>{" "}
          <CardDescription>
            {" "}
            Rules created here execute only for work items belonging to{" "}
            {projectKey}.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={handleCreateRule}
          >
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="proj-auto-name">Rule Name</Label>{" "}
              <Input
                id="proj-auto-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Require CAB approval on production changes"
                value={name}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="proj-auto-trigger">Trigger Event</Label>{" "}
              <Input
                id="proj-auto-trigger"
                onChange={(event) => setTrigger(event.target.value)}
                value={trigger}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="proj-auto-action">Action</Label>{" "}
              <Input
                id="proj-auto-action"
                onChange={(event) => setAction(event.target.value)}
                value={action}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="proj-auto-notes">Rule Notes</Label>{" "}
              <Textarea
                id="proj-auto-notes"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional governance context"
                value={notes}
              />{" "}
            </div>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button type="submit">Create rule</Button>{" "}
            </div>{" "}
          </form>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Project & Workspace Override Rules</CardTitle>{" "}
          <CardDescription>
            {" "}
            Toggle project rules or override inherited workspace automations.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          {rules.map((rule) => (
            <div
              className="flex flex-wrap items-center justify-between gap-4 border rounded-md p-4"
              key={rule.id}
            >
              {" "}
              <div className="space-y-1">
                {" "}
                <div className="flex items-center gap-2">
                  {" "}
                  <p className="text-sm font-semibold">{rule.name}</p>{" "}
                  <Badge
                    variant={rule.scope === "project" ? "secondary" : "outline"}
                  >
                    {" "}
                    {rule.scope === "project"
                      ? "Project Rule"
                      : "Workspace Override"}{" "}
                  </Badge>{" "}
                </div>{" "}
                <p className="font-mono text-xs">
                  {" "}
                  {rule.trigger} → {rule.action}{" "}
                </p>{" "}
              </div>{" "}
              <Switch
                aria-label={`Toggle ${rule.name}`}
                checked={rule.enabled}
                onCheckedChange={(checked) =>
                  setRules((prev) =>
                    prev.map((item) =>
                      item.id === rule.id
                        ? { ...item, enabled: checked }
                        : item,
                    ),
                  )
                }
              />{" "}
            </div>
          ))}{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
