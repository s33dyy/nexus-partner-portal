import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckSquare, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  AdvancedFilterDateRangeField,
  AdvancedFilterSelectField,
  AdvancedFilterTextField,
  AdvancedFilters,
} from "@/components/advanced-filters";
import { EmptyState, PageHeader } from "@/components/page-header";
import { RecordList, RecordListSkeleton, RecordRow } from "@/components/record-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGrid, FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  createTask,
  deleteTask,
  listTaskAssignees,
  listTasks,
  setTaskProposedCompletion,
  transitionTask,
  updateTask,
} from "@/integrations/local/task-commands";
import { formatDateLabel, formatDateTimeLabel, toDateInputValue } from "@/lib/date-utils";
import { countActiveFilters } from "@/lib/advanced-filters";
import {
  filterTasksByView,
  getTaskEmptyState,
  isTaskOverdue,
  serializeTaskDateInput,
  type TaskAdvancedFilters,
} from "@/lib/task-filters";
import type { TaskAssignee, TaskStatus } from "@/server/task-commands.server";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: TasksPage,
});

type TaskRecord = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: string;
  due_at: string | null;
  proposed_completion_at: string | null;
  blocked_reason: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  partner_id: string | null;
  version: number;
  created_at: string;
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  to_do: "To Do",
  in_progress: "In Progress",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "info" | "danger";

const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  to_do: "neutral",
  in_progress: "brand",
  blocked: "danger",
  completed: "success",
  cancelled: "danger",
};

const PRIORITY_TONE: Record<string, BadgeTone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const EMPTY_DRAFT = {
  title: "",
  description: "",
  priority: "medium",
  due_at: "",
  proposed_completion_at: "",
  assignee_id: "",
};

// Date-only inputs use the shared UTC-noon TIMESTAMPTZ sentinel so the
// serialized Z value retains the selected calendar date after round-tripping.
function dateInputToIso(value: string): string | null {
  return serializeTaskDateInput(value);
}

function TasksPage() {
  const { profile, can } = useAuth();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | TaskStatus>("all");
  const [advancedFilters, setAdvancedFilters] = useState<TaskAdvancedFilters>({});
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reasonPrompt, setReasonPrompt] = useState<{
    task: TaskRecord;
    toStatus: TaskStatus;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [dateEdit, setDateEdit] = useState<{ task: TaskRecord; value: string } | null>(null);
  const [savingDate, setSavingDate] = useState(false);
  const [editTask, setEditTask] = useState<TaskRecord | null>(null);
  const [editDraft, setEditDraft] = useState({
    title: "",
    description: "",
    priority: "medium",
    assignee_id: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const canCreate = can("tasks", "create");
  const canUpdate = can("tasks", "update");
  const canDelete = can("tasks", "delete");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskResult, assigneeResult] = await Promise.all([listTasks(), listTaskAssignees()]);
      if (!taskResult.ok) throw new Error(taskResult.failure.message);
      setTasks(taskResult.data as TaskRecord[]);
      if (assigneeResult.ok) setAssignees(assigneeResult.data);
    } catch (error) {
      console.error("Failed to load tasks", error);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleTasks = useMemo(
    () =>
      filterTasksByView(tasks, {
        status: tab === "all" ? undefined : tab,
        advanced: advancedFilters,
      }),
    [advancedFilters, tasks, tab],
  );

  const emptyState = useMemo(() => getTaskEmptyState(tab, advancedFilters), [advancedFilters, tab]);

  const advancedFilterOptions = useMemo(() => {
    const assigneeOptions = new Map<string, string>();
    for (const assignee of assignees) {
      assigneeOptions.set(assignee.id, assignee.full_name || assignee.email);
    }
    for (const task of tasks) {
      if (task.assignee_id) {
        assigneeOptions.set(task.assignee_id, task.assignee_name || task.assignee_id);
      }
    }

    const creatorOptions = new Map<string, string>();
    for (const task of tasks) {
      if (task.creator_id) {
        creatorOptions.set(task.creator_id, task.creator_name || task.creator_id);
      }
    }

    return {
      assignees: Array.from(assigneeOptions, ([value, label]) => ({ label, value })).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
      creators: Array.from(creatorOptions, ([value, label]) => ({ label, value })).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    };
  }, [assignees, tasks]);

  const updateAdvancedFilter = useCallback(
    (key: keyof TaskAdvancedFilters, value: string | boolean) => {
      setAdvancedFilters((current) => ({ ...current, [key]: value || undefined }));
    },
    [],
  );

  const clearAdvancedFilters = useCallback(() => {
    setAdvancedFilters({});
  }, []);

  const create = async () => {
    if (!draft.title.trim()) {
      toast.error("Give the task a title");
      return;
    }
    setCreating(true);
    try {
      const result = await createTask({
        title: draft.title,
        description: draft.description || null,
        priority: draft.priority,
        dueAt: dateInputToIso(draft.due_at),
        proposedCompletionAt: dateInputToIso(draft.proposed_completion_at),
        assigneeId: draft.assignee_id || profile?.id || null,
      });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }
      toast.success("Task created");
      setDraft(EMPTY_DRAFT);
      setCreateOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (task: TaskRecord) => {
    setEditTask(task);
    setEditDraft({
      title: task.title,
      description: task.description,
      priority: task.priority,
      assignee_id: task.assignee_id ?? profile?.id ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editTask) return;
    setSavingEdit(true);
    try {
      const result = await updateTask({
        taskId: editTask.id,
        expectedVersion: editTask.version,
        patch: {
          title: editDraft.title,
          description: editDraft.description,
          priority: editDraft.priority,
          assigneeId: editDraft.assignee_id || profile?.id || null,
        },
      });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }
      toast.success("Task updated");
      setEditTask(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setSavingEdit(false);
    }
  };

  const removeTask = async (task: TaskRecord) => {
    if (!window.confirm(`Delete “${task.title}”?`)) return;
    const result = await deleteTask({ taskId: task.id, expectedVersion: task.version });
    if (!result.ok) {
      toast.error(result.failure.message);
      return;
    }
    toast.success("Task deleted");
    await load();
  };

  const saveProposedDate = async () => {
    if (!dateEdit) return;
    setSavingDate(true);
    try {
      const result = await setTaskProposedCompletion({
        taskId: dateEdit.task.id,
        expectedVersion: dateEdit.task.version,
        proposedCompletionAt: dateInputToIso(dateEdit.value),
      });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }
      toast.success(
        dateEdit.value ? "Proposed completion date updated" : "Proposed completion date cleared",
      );
      setDateEdit(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update the date");
    } finally {
      setSavingDate(false);
    }
  };

  const applyTransition = async (task: TaskRecord, toStatus: TaskStatus, withReason?: string) => {
    setBusyTaskId(task.id);
    try {
      const result = await transitionTask({
        taskId: task.id,
        expectedVersion: task.version,
        toStatus,
        reason: withReason ?? null,
      });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }
      toast.success(`Task moved to ${STATUS_LABEL[toStatus]}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setBusyTaskId(null);
    }
  };

  const requestTransition = (task: TaskRecord, toStatus: TaskStatus, needsReason: boolean) => {
    if (needsReason) {
      setReason("");
      setReasonPrompt({ task, toStatus });
      return;
    }
    void applyTransition(task, toStatus);
  };

  const confirmReasonPrompt = async () => {
    if (!reasonPrompt) return;
    if (!reason.trim()) {
      toast.error("A reason is required for this change");
      return;
    }
    await applyTransition(reasonPrompt.task, reasonPrompt.toStatus, reason.trim());
    setReasonPrompt(null);
  };

  const actionsFor = (task: TaskRecord) => {
    switch (task.status) {
      case "to_do":
        return (
          <>
            <Button size="sm" onClick={() => requestTransition(task, "in_progress", false)}>
              Start
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => requestTransition(task, "blocked", true)}
            >
              Block
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => requestTransition(task, "completed", false)}
            >
              Complete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => requestTransition(task, "cancelled", true)}
            >
              Cancel
            </Button>
          </>
        );
      case "in_progress":
        return (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => requestTransition(task, "to_do", false)}
            >
              Return to queue
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => requestTransition(task, "blocked", true)}
            >
              Block
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => requestTransition(task, "completed", false)}
            >
              Complete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => requestTransition(task, "cancelled", true)}
            >
              Cancel
            </Button>
          </>
        );
      case "blocked":
        return (
          <>
            <Button size="sm" onClick={() => requestTransition(task, "in_progress", false)}>
              Resume
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => requestTransition(task, "to_do", false)}
            >
              Unblock to queue
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => requestTransition(task, "cancelled", true)}
            >
              Cancel
            </Button>
          </>
        );
      case "completed":
      case "cancelled":
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() => requestTransition(task, "to_do", true)}
          >
            Reopen
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Work management"
        icon={<CheckSquare className="h-3.5 w-3.5" />}
        title="My Tasks"
        description="Track work items through to do, in progress, blocked, completed, and cancelled."
        actions={
          <Button onClick={() => setCreateOpen(true)} disabled={!canCreate}>
            <Plus className="mr-2 h-4 w-4" /> New task
          </Button>
        }
      />

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create task"
        description="Add a new work item to your queue."
        busy={creating}
        submitLabel="Create task"
        busyLabel="Creating…"
        submitDisabled={!draft.title.trim()}
        onCancel={() => setDraft(EMPTY_DRAFT)}
        onSubmit={create}
      >
        <Field label="Title" htmlFor="task-title" required>
          <Input
            id="task-title"
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            autoFocus
          />
        </Field>
        <Field label="Description" htmlFor="task-description">
          <Textarea
            id="task-description"
            rows={3}
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </Field>
        <FieldGrid>
          <Field label="Priority">
            <Select
              value={draft.priority}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, priority: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Due date"
            htmlFor="task-due"
            hint="The hard deadline, if one was set for you."
          >
            <Input
              id="task-due"
              type="date"
              value={draft.due_at}
              onChange={(event) => setDraft((prev) => ({ ...prev, due_at: event.target.value }))}
            />
          </Field>
        </FieldGrid>
        <Field
          label="Proposed completion date"
          htmlFor="task-proposed"
          hint="Your own forecast for when this lands. Reminders are sent against this date."
        >
          <Input
            id="task-proposed"
            type="date"
            value={draft.proposed_completion_at}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, proposed_completion_at: event.target.value }))
            }
          />
        </Field>
        {assignees.length > 0 ? (
          <Field label="Assignee" hint="Choose an in-scope user or keep yourself assigned.">
            <Select
              value={draft.assignee_id || profile?.id || ""}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, assignee_id: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select assignee" />
              </SelectTrigger>
              <SelectContent>
                {profile?.id ? <SelectItem value={profile.id}>Myself</SelectItem> : null}
                {assignees
                  .filter((assignee) => assignee.id !== profile?.id)
                  .map((assignee) => (
                    <SelectItem key={assignee.id} value={assignee.id}>
                      {assignee.full_name || assignee.email}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </FormDialog>

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all">All ({tasks.length})</TabsTrigger>
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
            <TabsTrigger key={status} value={status}>
              {STATUS_LABEL[status]} ({tasks.filter((task) => task.status === status).length})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader className="space-y-3 border-b">
          <div>
            <CardTitle>Tasks</CardTitle>
            <CardDescription>
              Filter the tasks already visible to you by ownership, priority, status, and due date.
            </CardDescription>
          </div>
          <AdvancedFilters
            activeCount={countActiveFilters(advancedFilters)}
            onClearAll={clearAdvancedFilters}
          >
            <AdvancedFilterTextField
              label="Title or description"
              id="task-filter-text"
              value={advancedFilters.text ?? ""}
              onChange={(event) => updateAdvancedFilter("text", event.target.value)}
              placeholder="Search tasks"
            />
            <AdvancedFilterSelectField
              label="Status"
              id="task-filter-status"
              value={advancedFilters.status ?? ""}
              onValueChange={(value) => updateAdvancedFilter("status", value)}
              options={(Object.keys(STATUS_LABEL) as TaskStatus[]).map((value) => ({
                label: STATUS_LABEL[value],
                value,
              }))}
              placeholder="All statuses"
            />
            <AdvancedFilterSelectField
              label="Priority"
              id="task-filter-priority"
              value={advancedFilters.priority ?? ""}
              onValueChange={(value) => updateAdvancedFilter("priority", value)}
              options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ label, value }))}
              placeholder="All priorities"
            />
            <AdvancedFilterSelectField
              label="User / assignee"
              id="task-filter-assignee"
              value={advancedFilters.assigneeId ?? ""}
              onValueChange={(value) => updateAdvancedFilter("assigneeId", value)}
              options={advancedFilterOptions.assignees}
              placeholder="All assignees"
              disabled={advancedFilterOptions.assignees.length === 0}
            />
            <AdvancedFilterSelectField
              label="Creator"
              id="task-filter-creator"
              value={advancedFilters.creatorId ?? ""}
              onValueChange={(value) => updateAdvancedFilter("creatorId", value)}
              options={advancedFilterOptions.creators}
              placeholder="All creators"
              disabled={advancedFilterOptions.creators.length === 0}
            />
            <AdvancedFilterDateRangeField
              label="Due date"
              id="task-filter-due-date"
              fromValue={advancedFilters.dueDateFrom ?? ""}
              toValue={advancedFilters.dueDateTo ?? ""}
              onFromChange={(event) => updateAdvancedFilter("dueDateFrom", event.target.value)}
              onToChange={(event) => updateAdvancedFilter("dueDateTo", event.target.value)}
            />
            <AdvancedFilterSelectField
              label="Due status"
              id="task-filter-due-status"
              value={advancedFilters.overdueOnly ? "overdue" : ""}
              onValueChange={(value) => updateAdvancedFilter("overdueOnly", value === "overdue")}
              options={[{ label: "Overdue only", value: "overdue" }]}
              placeholder="All due statuses"
            />
          </AdvancedFilters>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <RecordListSkeleton rows={5} className="p-3" />
          ) : visibleTasks.length === 0 ? (
            <EmptyState
              icon={<CheckSquare className="h-5 w-5" />}
              title={emptyState.title}
              description={emptyState.description}
              action={
                emptyState.action === "clearFilters" ? (
                  <Button size="sm" variant="outline" onClick={clearAdvancedFilters}>
                    Clear filters
                  </Button>
                ) : emptyState.action === "createTask" ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> New task
                  </Button>
                ) : null
              }
            />
          ) : (
            <RecordList className="p-3">
              {visibleTasks.map((task) => (
                <RecordRow
                  key={task.id}
                  tone={STATUS_TONE[task.status]}
                  title={task.title}
                  subtitle={task.description || undefined}
                  meta={
                    <>
                      <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                      <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"}>
                        {task.priority}
                      </Badge>
                      {isTaskOverdue(task) ? <Badge tone="danger">Overdue</Badge> : null}
                      <span>
                        {task.due_at ? `Due ${formatDateTimeLabel(task.due_at)}` : "No due date"}
                      </span>
                      {task.assignee_name ? <span>Assigned to {task.assignee_name}</span> : null}
                      <button
                        type="button"
                        // An inline text button is still a tap target: give it
                        // 44px of height on touch without changing the inline
                        // look on desktop.
                        className="inline-flex min-h-11 items-center gap-1 rounded-sm underline-offset-2 hover:text-foreground hover:underline lg:min-h-0"
                        onClick={() =>
                          setDateEdit({
                            task,
                            value: toDateInputValue(task.proposed_completion_at),
                          })
                        }
                      >
                        <CalendarClock className="h-3 w-3" />
                        {task.proposed_completion_at
                          ? `Proposed ${formatDateLabel(task.proposed_completion_at)}`
                          : "Set proposed completion"}
                      </button>
                      {task.blocked_reason ? (
                        <span className="text-destructive">Blocked: {task.blocked_reason}</span>
                      ) : null}
                    </>
                  }
                  trailing={
                    <div className="flex flex-wrap gap-2">
                      {canUpdate ? (
                        <Button size="sm" variant="outline" onClick={() => openEdit(task)}>
                          Edit
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button size="sm" variant="ghost" onClick={() => void removeTask(task)}>
                          Delete
                        </Button>
                      ) : null}
                      {busyTaskId === task.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        actionsFor(task)
                      )}
                    </div>
                  }
                />
              ))}
            </RecordList>
          )}
        </CardContent>
      </Card>

      <FormDialog
        open={reasonPrompt !== null}
        onOpenChange={(open) => !open && setReasonPrompt(null)}
        title={reasonPrompt ? `Move to ${STATUS_LABEL[reasonPrompt.toStatus]}` : ""}
        description="A reason is required for this change."
        submitLabel="Confirm"
        submitDisabled={!reason.trim()}
        onSubmit={confirmReasonPrompt}
      >
        <Field label="Reason" htmlFor="task-reason" required>
          <Textarea
            id="task-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this changing?"
            autoFocus
          />
        </Field>
      </FormDialog>

      <FormDialog
        open={editTask !== null}
        onOpenChange={(open) => !open && setEditTask(null)}
        title="Edit task"
        description="Update task details. Lifecycle changes use their named commands."
        busy={savingEdit}
        submitLabel="Save changes"
        busyLabel="Saving…"
        onSubmit={saveEdit}
      >
        <Field label="Title" htmlFor="task-edit-title" required>
          <Input
            id="task-edit-title"
            value={editDraft.title}
            onChange={(event) => setEditDraft((prev) => ({ ...prev, title: event.target.value }))}
          />
        </Field>
        <Field label="Description" htmlFor="task-edit-description">
          <Textarea
            id="task-edit-description"
            rows={3}
            value={editDraft.description}
            onChange={(event) =>
              setEditDraft((prev) => ({ ...prev, description: event.target.value }))
            }
          />
        </Field>
        <Field label="Priority">
          <Select
            value={editDraft.priority}
            onValueChange={(value) => setEditDraft((prev) => ({ ...prev, priority: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {assignees.length > 0 ? (
          <Field label="Assignee" hint="Choose an in-scope user or keep yourself assigned.">
            <Select
              value={editDraft.assignee_id || profile?.id || ""}
              onValueChange={(value) => setEditDraft((prev) => ({ ...prev, assignee_id: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select assignee" />
              </SelectTrigger>
              <SelectContent>
                {profile?.id ? <SelectItem value={profile.id}>Myself</SelectItem> : null}
                {assignees
                  .filter((assignee) => assignee.id !== profile?.id)
                  .map((assignee) => (
                    <SelectItem key={assignee.id} value={assignee.id}>
                      {assignee.full_name || assignee.email}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </FormDialog>

      <FormDialog
        open={dateEdit !== null}
        onOpenChange={(open) => !open && setDateEdit(null)}
        title="Proposed completion date"
        description={
          dateEdit
            ? `When do you expect "${dateEdit.task.title}" to be finished?`
            : "When do you expect this to be finished?"
        }
        busy={savingDate}
        submitLabel="Save date"
        busyLabel="Saving…"
        footerNote="Reminders go out 3 days and 1 day before, on the day, and if it slips."
        onSubmit={saveProposedDate}
      >
        <Field
          label="Proposed completion date"
          htmlFor="task-proposed-edit"
          hint="Leave empty to clear the date and stop reminders for this task."
        >
          <Input
            id="task-proposed-edit"
            type="date"
            value={dateEdit?.value ?? ""}
            onChange={(event) =>
              setDateEdit((current) =>
                current ? { ...current, value: event.target.value } : current,
              )
            }
            autoFocus
          />
        </Field>
      </FormDialog>
    </div>
  );
}
