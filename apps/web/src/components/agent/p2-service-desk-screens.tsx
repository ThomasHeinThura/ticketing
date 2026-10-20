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

type ZoomLevel = "week" | "month" | "quarter";
type MilestoneStatus = "On track" | "At risk" | "Completed";
type MilestoneItem = {
  id: string;
  key: string;
  title: string;
  targetDate: string;
  prerequisiteKey: string;
  status: MilestoneStatus;
  criticalPath: boolean;
  baselineDate: string;
};
const INITIAL_MILESTONES: MilestoneItem[] = [
  {
    id: "ms-1",
    key: "MS-101",
    title: "Service catalog taxonomy sign-off",
    targetDate: "2026-11-05",
    prerequisiteKey: "INIT-01",
    status: "Completed",
    criticalPath: true,
    baselineDate: "2026-11-03",
  },
  {
    id: "ms-2",
    key: "MS-102",
    title: "Incident & request workflow verification",
    targetDate: "2026-11-18",
    prerequisiteKey: "MS-101",
    status: "On track",
    criticalPath: true,
    baselineDate: "2026-11-18",
  },
  {
    id: "ms-3",
    key: "MS-103",
    title: "SLA calendar & breach alert calibration",
    targetDate: "2026-12-02",
    prerequisiteKey: "MS-102",
    status: "At risk",
    criticalPath: false,
    baselineDate: "2026-11-28",
  },
];
function milestoneBadgeVariant(status: MilestoneStatus) {
  if (status === "Completed") return "success" as const;
  if (status === "At risk") return "warning" as const;
  return "info" as const;
}
export function ProjectPlanScreen({ projectKey }: { projectKey: string }) {
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [showBaseline, setShowBaseline] = useState(true);
  const [criticalPathOnly, setCriticalPathOnly] = useState(false);
  const [milestones, setMilestones] =
    useState<MilestoneItem[]>(INITIAL_MILESTONES);
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("2026-12-15");
  const [prerequisiteKey, setPrerequisiteKey] = useState("MS-102");
  const visibleMilestones = milestones.filter((ms) =>
    criticalPathOnly ? ms.criticalPath : true,
  );
  const handleAddMilestone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const nextNumber = 101 + milestones.length;
    const nextMilestone: MilestoneItem = {
      id: `ms-${Date.now()}`,
      key: `MS-${nextNumber}`,
      title: trimmedTitle,
      targetDate: targetDate || "2026-12-15",
      prerequisiteKey: prerequisiteKey.trim() || "MS-101",
      status: "On track",
      criticalPath: true,
      baselineDate: targetDate || "2026-12-15",
    };
    setMilestones((prev) => [...prev, nextMilestone]);
    setTitle("");
  };
  const handleMarkComplete = (id: string) => {
    setMilestones((prev) =>
      prev.map((ms) =>
        ms.id === id ? { ...ms, status: "Completed" as const } : ms,
      ),
    );
  };
  return (
    <main
      className="flex min-h-full w-full flex-col gap-6 p-6"
      data-testid="project-plan-screen"
    >
      {" "}
      <PageTitle title={`Plan · ${projectKey}`} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <p className="font-mono text-xs"> {projectKey} </p>{" "}
          <h1 className="font-semibold text-2xl">Milestones & prerequisites</h1>{" "}
          <p className="text-sm">
            {" "}
            Track delivery checkpoints, prerequisite dependencies, and baseline
            variance across the project schedule.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex flex-wrap items-center gap-2">
          {" "}
          {(["week", "month", "quarter"] as const).map((level) => (
            <Button
              key={level}
              type="button"
              size="sm"
              variant={zoom === level ? "default" : "outline"}
              aria-pressed={zoom === level}
              onClick={() => setZoom(level)}
            >
              {" "}
              {level === "week"
                ? "Week"
                : level === "month"
                  ? "Month"
                  : "Quarter"}{" "}
            </Button>
          ))}{" "}
        </div>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Schedule display controls</CardTitle>{" "}
          <CardDescription>
            {" "}
            Active horizon: <span className="font-mono">{zoom}</span> view{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="flex flex-wrap items-center gap-6">
          {" "}
          <div className="flex items-center gap-2">
            {" "}
            <Switch
              id="plan-baseline-toggle"
              aria-label="Show baseline dates"
              checked={showBaseline}
              onCheckedChange={(checked) => setShowBaseline(Boolean(checked))}
            />{" "}
            <Label htmlFor="plan-baseline-toggle">
              Show baseline dates
            </Label>{" "}
          </div>{" "}
          <div className="flex items-center gap-2">
            {" "}
            <Switch
              id="plan-critical-path-toggle"
              aria-label="Critical-path filter"
              checked={criticalPathOnly}
              onCheckedChange={(checked) =>
                setCriticalPathOnly(Boolean(checked))
              }
            />{" "}
            <Label htmlFor="plan-critical-path-toggle">
              {" "}
              Critical-path filter{" "}
            </Label>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <div className="grid gap-6 md:grid-cols-3">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Add milestone</CardTitle>{" "}
            <CardDescription>
              {" "}
              Register a delivery milestone and link its prerequisite key.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <form className="flex flex-col gap-4" onSubmit={handleAddMilestone}>
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="milestone-title-input">Milestone title</Label>{" "}
                <Input
                  id="milestone-title-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Cutover readiness review"
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="milestone-target-date-input">Target date</Label>{" "}
                <Input
                  id="milestone-target-date-input"
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="milestone-prerequisite-input">
                  {" "}
                  Prerequisite key{" "}
                </Label>{" "}
                <Input
                  id="milestone-prerequisite-input"
                  value={prerequisiteKey}
                  onChange={(event) => setPrerequisiteKey(event.target.value)}
                  placeholder="MS-102"
                />{" "}
              </div>{" "}
              <Button type="submit">Add milestone</Button>{" "}
            </form>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card className="md:col-span-2">
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Milestones ({visibleMilestones.length})</CardTitle>{" "}
            <CardDescription>
              {" "}
              Prerequisite links and status progression for {projectKey}.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="flex flex-col gap-3">
            {" "}
            {visibleMilestones.map((ms) => (
              <div
                key={ms.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4"
                data-testid={`milestone-row-${ms.key}`}
              >
                {" "}
                <div className="space-y-1">
                  {" "}
                  <div className="flex flex-wrap items-center gap-2">
                    {" "}
                    <span className="font-mono text-xs"> {ms.key} </span>{" "}
                    <span className="font-medium text-base">{ms.title}</span>{" "}
                    <Badge variant={milestoneBadgeVariant(ms.status)}>
                      {" "}
                      {ms.status}{" "}
                    </Badge>{" "}
                    {ms.criticalPath && (
                      <Badge variant="outline">Critical path</Badge>
                    )}{" "}
                  </div>{" "}
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    {" "}
                    <span>Target: {ms.targetDate}</span>{" "}
                    {showBaseline && <span>Baseline: {ms.baselineDate}</span>}{" "}
                    <span>
                      {" "}
                      Prerequisite:{""}{" "}
                      <Link
                        to="/agent/projects/$projectKey/plan"
                        params={{ projectKey }}
                        className="font-mono"
                      >
                        {" "}
                        {ms.prerequisiteKey}{" "}
                      </Link>{" "}
                    </span>{" "}
                  </div>{" "}
                </div>{" "}
                <div className="flex items-center gap-2">
                  {" "}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={ms.status === "Completed"}
                    onClick={() => handleMarkComplete(ms.id)}
                  >
                    {" "}
                    {ms.status === "Completed"
                      ? "Completed"
                      : "Mark complete"}{" "}
                  </Button>{" "}
                </div>{" "}
              </div>
            ))}{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
    </main>
  );
}
type StakeholderRole = "Approver" | "Informed" | "Sponsor";
type StakeholderItem = {
  id: string;
  name: string;
  email: string;
  role: StakeholderRole;
};
const INITIAL_STAKEHOLDERS: StakeholderItem[] = [
  {
    id: "stk-1",
    name: "Elena Rostova",
    email: "elena.rostova@example.com",
    role: "Sponsor",
  },
  {
    id: "stk-2",
    name: "Marcus Vance",
    email: "marcus.vance@example.com",
    role: "Approver",
  },
  {
    id: "stk-3",
    name: "Priya Nair",
    email: "priya.nair@example.com",
    role: "Informed",
  },
];
function stakeholderRoleVariant(role: StakeholderRole) {
  if (role === "Sponsor") return "default" as const;
  if (role === "Approver") return "warning" as const;
  return "secondary" as const;
}
export function ProjectStakeholdersScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [stakeholders, setStakeholders] =
    useState<StakeholderItem[]>(INITIAL_STAKEHOLDERS);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StakeholderRole>("Approver");
  const filteredStakeholders = stakeholders.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.email.toLowerCase().includes(q) ||
      item.role.toLowerCase().includes(q)
    );
  });
  const handleAddStakeholder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) return;
    setStakeholders((prev) => [
      ...prev,
      { id: `stk-${Date.now()}`, name: trimmedName, email: trimmedEmail, role },
    ]);
    setName("");
    setEmail("");
  };
  const handleRemoveStakeholder = (id: string) => {
    setStakeholders((prev) => prev.filter((item) => item.id !== id));
  };
  return (
    <main
      className="flex min-h-full w-full flex-col gap-6 p-6"
      data-testid="project-stakeholders-screen"
    >
      {" "}
      <PageTitle title={`Stakeholders · ${projectKey}`} />{" "}
      <header className="space-y-1">
        {" "}
        <p className="font-mono text-xs">{projectKey}</p>{" "}
        <h1 className="font-semibold text-2xl">Project stakeholders</h1>{" "}
        <p className="text-sm">
          {" "}
          Manage project sponsors, change approvers, and informed stakeholders.{" "}
        </p>{" "}
      </header>{" "}
      <div className="grid gap-6 md:grid-cols-3">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Add stakeholder</CardTitle>{" "}
            <CardDescription>
              {" "}
              Assign a stakeholder role for {projectKey}.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <form
              className="flex flex-col gap-4"
              onSubmit={handleAddStakeholder}
            >
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="stakeholder-name-input">Full name</Label>{" "}
                <Input
                  id="stakeholder-name-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Devon Brooks"
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="stakeholder-email-input">Email address</Label>{" "}
                <Input
                  id="stakeholder-email-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="devon.brooks@example.com"
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="stakeholder-role-group">Role</Label>{" "}
                <div
                  id="stakeholder-role-group"
                  className="flex flex-wrap gap-2"
                >
                  {" "}
                  {(["Approver", "Informed", "Sponsor"] as const).map(
                    (option) => (
                      <Button
                        key={option}
                        type="button"
                        size="sm"
                        variant={role === option ? "default" : "outline"}
                        aria-pressed={role === option}
                        onClick={() => setRole(option)}
                      >
                        {" "}
                        {option}{" "}
                      </Button>
                    ),
                  )}{" "}
                </div>{" "}
              </div>{" "}
              <Button type="submit">Add stakeholder</Button>{" "}
            </form>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card className="md:col-span-2">
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>
              {" "}
              Registered stakeholders ({filteredStakeholders.length}){" "}
            </CardTitle>{" "}
            <CardDescription>
              {" "}
              Filter by name, email, or governance role.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="flex flex-col gap-4">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="stakeholder-search-input">
                {" "}
                Search stakeholders{" "}
              </Label>{" "}
              <Input
                id="stakeholder-search-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by name, email, or role..."
              />{" "}
            </div>{" "}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {" "}
                <thead>
                  {" "}
                  <tr>
                    {" "}
                    <th>Name</th> <th>Email</th> <th>Role</th> <th>
                      Actions
                    </th>{" "}
                  </tr>{" "}
                </thead>{" "}
                <tbody>
                  {" "}
                  {filteredStakeholders.map((person) => (
                    <tr key={person.id}>
                      {" "}
                      <td className="font-medium">{person.name}</td>{" "}
                      <td className=""> {person.email} </td>{" "}
                      <td>
                        {" "}
                        <Badge variant={stakeholderRoleVariant(person.role)}>
                          {" "}
                          {person.role}{" "}
                        </Badge>{" "}
                      </td>{" "}
                      <td>
                        {" "}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleRemoveStakeholder(person.id)}
                        >
                          {" "}
                          Remove{" "}
                        </Button>{" "}
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
type HierarchyLevel = "L0" | "L1" | "L2";
type WorkItemTypeRow = {
  id: string;
  name: string;
  key: string;
  hierarchyLevel: HierarchyLevel;
  defaultWorkflow: string;
  active: boolean;
};
const INITIAL_WORK_ITEM_TYPES: WorkItemTypeRow[] = [
  {
    id: "wit-incident",
    name: "Incident",
    key: "INC",
    hierarchyLevel: "L1",
    defaultWorkflow: "Incident Fast-Track",
    active: true,
  },
  {
    id: "wit-service-request",
    name: "Service Request",
    key: "SRQ",
    hierarchyLevel: "L1",
    defaultWorkflow: "Standard Service Desk Workflow",
    active: true,
  },
  {
    id: "wit-change",
    name: "Change",
    key: "CHG",
    hierarchyLevel: "L0",
    defaultWorkflow: "Change Management Approval Workflow",
    active: true,
  },
  {
    id: "wit-problem",
    name: "Problem",
    key: "PRB",
    hierarchyLevel: "L0",
    defaultWorkflow: "Standard Service Desk Workflow",
    active: true,
  },
  {
    id: "wit-task",
    name: "Task",
    key: "TSK",
    hierarchyLevel: "L2",
    defaultWorkflow: "Standard Service Desk Workflow",
    active: true,
  },
];
export function WorkspaceWorkItemTypesScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [types, setTypes] = useState<WorkItemTypeRow[]>(
    INITIAL_WORK_ITEM_TYPES,
  );
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>("L1");
  const [defaultWorkflow, setDefaultWorkflow] = useState(
    "Standard Service Desk Workflow",
  );
  const filteredTypes = types.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.key.toLowerCase().includes(q) ||
      item.defaultWorkflow.toLowerCase().includes(q)
    );
  });
  const handleCreateType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedKey = key.trim().toUpperCase();
    if (!trimmedName || !trimmedKey) return;
    setTypes((prev) => [
      ...prev,
      {
        id: `wit-${Date.now()}`,
        name: trimmedName,
        key: trimmedKey,
        hierarchyLevel,
        defaultWorkflow:
          defaultWorkflow.trim() || "Standard Service Desk Workflow",
        active: true,
      },
    ]);
    setName("");
    setKey("");
  };
  const handleToggleActive = (id: string) => {
    setTypes((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, active: !item.active } : item,
      ),
    );
  };
  return (
    <main
      className="flex min-h-full w-full flex-col gap-6 p-6"
      data-testid="workspace-work-item-types-screen"
    >
      {" "}
      <PageTitle title="Workspace — work item types" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl">Workspace — work item types</h1>{" "}
        <p className="text-sm">
          {" "}
          Configure ITSM and work management item types, hierarchy levels, and
          default workflow bindings.{" "}
        </p>{" "}
      </header>{" "}
      <div className="grid gap-6 md:grid-cols-3">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Create work item type</CardTitle>{" "}
            <CardDescription>
              {" "}
              Define a new classification and bind its default workflow.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <form className="flex flex-col gap-4" onSubmit={handleCreateType}>
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="wit-name-input">Type name</Label>{" "}
                <Input
                  id="wit-name-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Access Request"
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="wit-key-input">Short key</Label>{" "}
                <Input
                  id="wit-key-input"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="ACC"
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="wit-hierarchy-group">Hierarchy level</Label>{" "}
                <div id="wit-hierarchy-group" className="flex flex-wrap gap-2">
                  {" "}
                  {(["L0", "L1", "L2"] as const).map((level) => (
                    <Button
                      key={level}
                      type="button"
                      size="sm"
                      variant={hierarchyLevel === level ? "default" : "outline"}
                      aria-pressed={hierarchyLevel === level}
                      onClick={() => setHierarchyLevel(level)}
                    >
                      {" "}
                      {level}{" "}
                    </Button>
                  ))}{" "}
                </div>{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="wit-workflow-input">Default workflow</Label>{" "}
                <Input
                  id="wit-workflow-input"
                  value={defaultWorkflow}
                  onChange={(event) => setDefaultWorkflow(event.target.value)}
                />{" "}
              </div>{" "}
              <Button type="submit">Create work item type</Button>{" "}
            </form>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card className="md:col-span-2">
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Work item types ({filteredTypes.length})</CardTitle>{" "}
            <CardDescription>
              {" "}
              Active types available across workspace projects.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="flex flex-col gap-4">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="wit-search-input">Filter work item types</Label>{" "}
              <Input
                id="wit-search-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by type name, key, or workflow..."
              />{" "}
            </div>{" "}
            <div className="flex flex-col gap-3">
              {" "}
              {filteredTypes.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4"
                >
                  {" "}
                  <div className="space-y-1">
                    {" "}
                    <div className="flex flex-wrap items-center gap-2">
                      {" "}
                      <span className="font-mono text-xs"> {item.key} </span>{" "}
                      <span className="font-medium text-base">{item.name}</span>{" "}
                      <Badge variant="outline">{item.hierarchyLevel}</Badge>{" "}
                      <Badge variant={item.active ? "success" : "secondary"}>
                        {" "}
                        {item.active ? "Active" : "Inactive"}{" "}
                      </Badge>{" "}
                    </div>{" "}
                    <p className="text-xs">
                      {" "}
                      Workflow binding: {item.defaultWorkflow}{" "}
                    </p>{" "}
                  </div>{" "}
                  <div className="flex items-center gap-2">
                    {" "}
                    <Switch
                      id={`wit-toggle-${item.id}`}
                      aria-label={`Toggle ${item.name} active state`}
                      checked={item.active}
                      onCheckedChange={() => handleToggleActive(item.id)}
                    />{" "}
                    <Label htmlFor={`wit-toggle-${item.id}`}>
                      {" "}
                      {item.active ? "Enabled" : "Disabled"}{" "}
                    </Label>{" "}
                  </div>{" "}
                </div>
              ))}{" "}
            </div>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
    </main>
  );
}
type WorkflowSummary = {
  id: string;
  name: string;
  description: string;
  statesCount: number;
};
const INITIAL_WORKFLOWS: WorkflowSummary[] = [
  {
    id: "wf-standard-service-desk",
    name: "Standard Service Desk Workflow",
    description:
      "End-to-end triage, fulfillment, customer wait pause, and resolution flow.",
    statesCount: 6,
  },
  {
    id: "wf-change-approval",
    name: "Change Management Approval Workflow",
    description:
      "CAB and peer approval gates before scheduled implementation and closure.",
    statesCount: 6,
  },
  {
    id: "wf-incident-fast-track",
    name: "Incident Fast-Track",
    description:
      "Accelerated major-incident response path with post-incident review.",
    statesCount: 5,
  },
];
export function WorkspaceWorkflowsListScreen() {
  const [workflows, setWorkflows] =
    useState<WorkflowSummary[]>(INITIAL_WORKFLOWS);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const handleCreateWorkflow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setWorkflows((prev) => [
      ...prev,
      {
        id: `wf-${slug || Date.now()}`,
        name: trimmedName,
        description:
          description.trim() || "Custom workspace state machine workflow.",
        statesCount: 6,
      },
    ]);
    setName("");
    setDescription("");
  };
  return (
    <main
      className="flex min-h-full w-full flex-col gap-6 p-6"
      data-testid="workspace-workflows-list-screen"
    >
      {" "}
      <PageTitle title="Workspace — workflows" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="font-semibold text-2xl">Workspace — workflows</h1>{" "}
        <p className="text-sm">
          {" "}
          Define state machines, transition guards, and approval gates for
          workspace work item types.{" "}
        </p>{" "}
      </header>{" "}
      <div className="grid gap-6 md:grid-cols-3">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Create workflow</CardTitle>{" "}
            <CardDescription>
              {" "}
              Add a reusable state machine for workspace work items.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <form
              className="flex flex-col gap-4"
              onSubmit={handleCreateWorkflow}
            >
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="workflow-name-input">Workflow name</Label>{" "}
                <Input
                  id="workflow-name-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Security Incident Escalation"
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="workflow-description-input">Description</Label>{" "}
                <Textarea
                  id="workflow-description-input"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe the states and approval checkpoints..."
                />{" "}
              </div>{" "}
              <Button type="submit">Create workflow</Button>{" "}
            </form>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card className="md:col-span-2">
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Configured workflows ({workflows.length})</CardTitle>{" "}
            <CardDescription>
              {" "}
              Select a workflow to edit states, transition rules, and approval
              gates.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent className="flex flex-col gap-3">
            {" "}
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4"
              >
                {" "}
                <div className="space-y-1">
                  {" "}
                  <div className="flex flex-wrap items-center gap-2">
                    {" "}
                    <span className="font-medium text-base">{wf.name}</span>{" "}
                    <Badge variant="outline">
                      {wf.statesCount} states
                    </Badge>{" "}
                  </div>{" "}
                  <p className="text-sm"> {wf.description} </p>{" "}
                </div>{" "}
                <Link
                  to="/agent/settings/workflows/$id"
                  params={{ id: wf.id }}
                  className="font-medium text-sm"
                >
                  {" "}
                  Open workflow editor{" "}
                </Link>{" "}
              </div>
            ))}{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
    </main>
  );
}
const WORKFLOW_STATES = [
  "Triage",
  "In Progress",
  "Waiting for Approval",
  "Waiting for Customer",
  "Resolved",
  "Closed",
] as const;
type WorkflowTransition = {
  id: string;
  fromState: string;
  toState: string;
  guardRule: string;
  requiresApproval: boolean;
};
const INITIAL_TRANSITIONS: WorkflowTransition[] = [
  {
    id: "tr-1",
    fromState: "Triage",
    toState: "In Progress",
    guardRule: "assignee_present",
    requiresApproval: false,
  },
  {
    id: "tr-2",
    fromState: "In Progress",
    toState: "Waiting for Approval",
    guardRule: "risk_assessment_completed",
    requiresApproval: true,
  },
  {
    id: "tr-3",
    fromState: "Waiting for Approval",
    toState: "Resolved",
    guardRule: "approval_granted",
    requiresApproval: true,
  },
  {
    id: "tr-4",
    fromState: "In Progress",
    toState: "Waiting for Customer",
    guardRule: "public_comment_posted",
    requiresApproval: false,
  },
  {
    id: "tr-5",
    fromState: "Resolved",
    toState: "Closed",
    guardRule: "resolution_verified",
    requiresApproval: false,
  },
];
export function WorkspaceWorkflowEditorScreen({ id }: { id: string }) {
  const [transitions, setTransitions] =
    useState<WorkflowTransition[]>(INITIAL_TRANSITIONS);
  const [fromState, setFromState] = useState("Triage");
  const [toState, setToState] = useState("In Progress");
  const [guardRule, setGuardRule] = useState("assignee_present");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const handleAddTransition = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fromState.trim() || !toState.trim()) return;
    setTransitions((prev) => [
      ...prev,
      {
        id: `tr-${Date.now()}`,
        fromState: fromState.trim(),
        toState: toState.trim(),
        guardRule: guardRule.trim() || "none",
        requiresApproval,
      },
    ]);
  };
  const handleDeleteTransition = (transitionId: string) => {
    setTransitions((prev) => prev.filter((item) => item.id !== transitionId));
  };
  return (
    <main
      className="flex min-h-full w-full flex-col gap-6 p-6"
      data-testid="workspace-workflow-editor-screen"
    >
      {" "}
      <PageTitle title={`Workflow editor · ${id}`} />{" "}
      <header className="space-y-1">
        {" "}
        <p className="font-mono text-xs">{id}</p>{" "}
        <h1 className="font-semibold text-2xl">Workflow editor</h1>{" "}
        <p className="text-sm">
          {" "}
          Inspect workflow states and manage allowed state transitions, guard
          expressions, and approval requirements.{" "}
        </p>{" "}
      </header>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>States ({WORKFLOW_STATES.length})</CardTitle>{" "}
          <CardDescription>
            {" "}
            Canonical lifecycle states registered in this state machine.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="flex flex-wrap gap-2">
          {" "}
          {WORKFLOW_STATES.map((stateName) => (
            <Badge key={stateName} variant="outline" size="lg">
              {" "}
              {stateName}{" "}
            </Badge>
          ))}{" "}
        </CardContent>{" "}
      </Card>{" "}
      <div className="grid gap-6 md:grid-cols-3">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Add transition</CardTitle>{" "}
            <CardDescription>
              {" "}
              Connect two lifecycle states with optional guard and approval
              rules.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <form
              className="flex flex-col gap-4"
              onSubmit={handleAddTransition}
            >
              {" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="transition-from-input">From state</Label>{" "}
                <Input
                  id="transition-from-input"
                  value={fromState}
                  onChange={(event) => setFromState(event.target.value)}
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="transition-to-input">To state</Label>{" "}
                <Input
                  id="transition-to-input"
                  value={toState}
                  onChange={(event) => setToState(event.target.value)}
                />{" "}
              </div>{" "}
              <div className="space-y-2">
                {" "}
                <Label htmlFor="transition-guard-input">Guard rule</Label>{" "}
                <Input
                  id="transition-guard-input"
                  value={guardRule}
                  onChange={(event) => setGuardRule(event.target.value)}
                  placeholder="assignee_present"
                />{" "}
              </div>{" "}
              <div className="flex items-center gap-2">
                {" "}
                <Switch
                  id="transition-approval-switch"
                  aria-label="Requires approval"
                  checked={requiresApproval}
                  onCheckedChange={(checked) =>
                    setRequiresApproval(Boolean(checked))
                  }
                />{" "}
                <Label htmlFor="transition-approval-switch">
                  {" "}
                  Requires approval{" "}
                </Label>{" "}
              </div>{" "}
              <Button type="submit">Add transition</Button>{" "}
            </form>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card className="md:col-span-2">
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Transitions ({transitions.length})</CardTitle>{" "}
            <CardDescription>
              {" "}
              Active state transitions evaluated by the workflow domain engine.{" "}
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
                    <th>From</th> <th>To</th> <th>Guard rule</th>{" "}
                    <th>Approval gate</th> <th>Actions</th>{" "}
                  </tr>{" "}
                </thead>{" "}
                <tbody>
                  {" "}
                  {transitions.map((tr) => (
                    <tr key={tr.id}>
                      {" "}
                      <td className="font-medium"> {tr.fromState} </td>{" "}
                      <td className="font-medium">{tr.toState}</td>{" "}
                      <td className="font-mono text-xs"> {tr.guardRule} </td>{" "}
                      <td>
                        {" "}
                        <Badge
                          variant={
                            tr.requiresApproval ? "warning" : "secondary"
                          }
                        >
                          {" "}
                          {tr.requiresApproval ? "Required" : "None"}{" "}
                        </Badge>{" "}
                      </td>{" "}
                      <td>
                        {" "}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteTransition(tr.id)}
                        >
                          {" "}
                          Delete{" "}
                        </Button>{" "}
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
const SLA_POLICIES = ["Standard Support SLA", "Enterprise 24x7 SLA"] as const;
const SERVICE_CALENDARS = [
  "Default Business Hours",
  "24x7 Follow-the-Sun",
] as const;
export function ProjectSlaSettingsScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const [selectedPolicy, setSelectedPolicy] = useState<string>(SLA_POLICIES[0]);
  const [selectedCalendar, setSelectedCalendar] = useState<string>(
    SERVICE_CALENDARS[0],
  );
  const [pauseOnCustomerWait, setPauseOnCustomerWait] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);
  const handleSave = () => {
    setSavedNotice(true);
  };
  return (
    <main
      className="flex min-h-full w-full flex-col gap-6 p-6"
      data-testid="project-sla-settings-screen"
    >
      {" "}
      <PageTitle title={`SLA & calendar · ${projectKey}`} />{" "}
      <header className="space-y-1">
        {" "}
        <p className="font-mono text-xs">{projectKey}</p>{" "}
        <h1 className="font-semibold text-2xl">Project — SLA & calendar</h1>{" "}
        <p className="text-sm">
          {" "}
          Bind an SLA target policy and working-hours calendar for work items in
          {""} {projectKey}.{" "}
        </p>{" "}
      </header>{" "}
      {savedNotice && (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">SLA configuration saved</p>{" "}
            <p className="text-xs">
              {" "}
              Bound {selectedPolicy} with {selectedCalendar} (pause on customer
              wait: {pauseOnCustomerWait ? "enabled" : "disabled"}).{" "}
            </p>{" "}
          </CardContent>
        </Card>
      )}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>SLA policy & calendar binding</CardTitle>{" "}
          <CardDescription>
            {" "}
            First response and resolution clocks evaluate against the bound
            service calendar.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="flex flex-col gap-6">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="sla-policy-selector">Bound SLA policy</Label>{" "}
            <div id="sla-policy-selector" className="flex flex-wrap gap-2">
              {" "}
              {SLA_POLICIES.map((policy) => (
                <Button
                  key={policy}
                  type="button"
                  variant={selectedPolicy === policy ? "default" : "outline"}
                  aria-pressed={selectedPolicy === policy}
                  onClick={() => {
                    setSelectedPolicy(policy);
                    setSavedNotice(false);
                  }}
                >
                  {" "}
                  {policy}{" "}
                </Button>
              ))}{" "}
            </div>{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="service-calendar-selector">Service calendar</Label>{" "}
            <div
              id="service-calendar-selector"
              className="flex flex-wrap gap-2"
            >
              {" "}
              {SERVICE_CALENDARS.map((calendar) => (
                <Button
                  key={calendar}
                  type="button"
                  variant={
                    selectedCalendar === calendar ? "default" : "outline"
                  }
                  aria-pressed={selectedCalendar === calendar}
                  onClick={() => {
                    setSelectedCalendar(calendar);
                    setSavedNotice(false);
                  }}
                >
                  {" "}
                  {calendar}{" "}
                </Button>
              ))}{" "}
            </div>{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="flex items-center gap-3">
            {" "}
            <Switch
              id="pause-customer-wait-switch"
              aria-label="Pause SLA clock on Waiting for Customer"
              checked={pauseOnCustomerWait}
              onCheckedChange={(checked) => {
                setPauseOnCustomerWait(Boolean(checked));
                setSavedNotice(false);
              }}
            />{" "}
            <Label htmlFor="pause-customer-wait-switch">
              {" "}
              Pause SLA clock when work item is in Waiting for Customer state{" "}
            </Label>{" "}
          </div>{" "}
          <div>
            {" "}
            <Button type="button" onClick={handleSave}>
              {" "}
              Save SLA settings{" "}
            </Button>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type AuditCategory = "all" | "auth" | "rbac" | "workflow" | "sla";
type AuditEventRow = {
  id: string;
  timestamp: string;
  actor: string;
  category: Exclude<AuditCategory, "all">;
  eventKey: string;
  targetResource: string;
  originIp: string;
};
const AUDIT_EVENTS: AuditEventRow[] = [
  {
    id: "aud-101",
    timestamp: "2026-10-20 08:12:04 UTC",
    actor: "marcus.vance@example.com",
    category: "workflow",
    eventKey: "work_item.transitioned",
    targetResource: "OPS-42 (In Progress -> Waiting for Approval)",
    originIp: "10.24.18.92",
  },
  {
    id: "aud-102",
    timestamp: "2026-10-20 08:10:49 UTC",
    actor: "elena.rostova@example.com",
    category: "workflow",
    eventKey: "approval.decided",
    targetResource: "APR-8812 (approved)",
    originIp: "10.24.18.14",
  },
  {
    id: "aud-103",
    timestamp: "2026-10-20 08:05:00 UTC",
    actor: "system:sla-evaluator",
    category: "sla",
    eventKey: "sla.breach.warning",
    targetResource: "OPS-39 (First Response < 30m)",
    originIp: "internal-worker",
  },
  {
    id: "aud-104",
    timestamp: "2026-10-20 07:48:19 UTC",
    actor: "admin@example.com",
    category: "auth",
    eventKey: "identity.provider.updated",
    targetResource: "idp:oidc-okta-primary",
    originIp: "192.0.2.44",
  },
  {
    id: "aud-105",
    timestamp: "2026-10-20 07:30:11 UTC",
    actor: "admin@example.com",
    category: "rbac",
    eventKey: "rbac.role.binding.created",
    targetResource: "role:service_desk_agent -> priya.nair@example.com",
    originIp: "192.0.2.44",
  },
];
export function GodModeAuditLogScreen() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<AuditCategory>("all");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const filteredEvents = AUDIT_EVENTS.filter((ev) => {
    if (category !== "all" && ev.category !== category) {
      return false;
    }
    const query = q.trim().toLowerCase();
    if (!query) return true;
    return (
      ev.actor.toLowerCase().includes(query) ||
      ev.eventKey.toLowerCase().includes(query) ||
      ev.targetResource.toLowerCase().includes(query)
    );
  });
  return (
    <main
      className="flex min-h-full w-full flex-col gap-6 p-6"
      data-testid="god-mode-audit-log-screen"
    >
      {" "}
      <PageTitle title="Audit log · God Mode" />{" "}
      <header className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="font-semibold text-2xl">Audit log</h1>{" "}
          <p className="text-sm">
            {" "}
            Immutable instance-wide security, governance, workflow, and SLA
            event ledger.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex flex-wrap items-center gap-2">
          {" "}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setExportStatus(
                `Exported ${filteredEvents.length} audit events as JSON.`,
              )
            }
          >
            {" "}
            Export JSON{" "}
          </Button>{" "}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setExportStatus(
                `Exported ${filteredEvents.length} audit events as CSV.`,
              )
            }
          >
            {" "}
            Export CSV{" "}
          </Button>{" "}
        </div>{" "}
      </header>{" "}
      {exportStatus && (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Audit export ready</p>{" "}
            <p className="text-xs">{exportStatus}</p>{" "}
          </CardContent>
        </Card>
      )}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Filter audit stream</CardTitle>{" "}
          <CardDescription>
            {" "}
            Filter by actor, event key, or domain category.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="flex flex-col gap-4">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="audit-query-input">Actor or action filter</Label>{" "}
            <Input
              id="audit-query-input"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search actor, event key (e.g. work_item.transitioned), or resource..."
            />{" "}
          </div>{" "}
          <div className="flex flex-wrap items-center gap-2">
            {" "}
            {(["all", "auth", "rbac", "workflow", "sla"] as const).map(
              (cat) => (
                <Button
                  key={cat}
                  type="button"
                  size="sm"
                  variant={category === cat ? "default" : "outline"}
                  aria-pressed={category === cat}
                  onClick={() => setCategory(cat)}
                >
                  {" "}
                  {cat.toUpperCase()}{" "}
                </Button>
              ),
            )}{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Audit events ({filteredEvents.length})</CardTitle>{" "}
          <CardDescription>
            {" "}
            Showing chronological append-only records.{" "}
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
                  <th>Timestamp</th> <th>Actor</th> <th>Event key</th>{" "}
                  <th>Target resource</th> <th>IP / origin</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {filteredEvents.map((ev) => (
                  <tr key={ev.id}>
                    {" "}
                    <td className="font-mono text-xs"> {ev.timestamp} </td>{" "}
                    <td className="font-medium">{ev.actor}</td>{" "}
                    <td>
                      {" "}
                      <Badge variant="outline" className="font-mono">
                        {" "}
                        {ev.eventKey}{" "}
                      </Badge>{" "}
                    </td>{" "}
                    <td>{ev.targetResource}</td>{" "}
                    <td className="font-mono text-xs"> {ev.originIp} </td>{" "}
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
