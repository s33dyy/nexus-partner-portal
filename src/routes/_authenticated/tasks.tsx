import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckSquare, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/page-header";
import { RecordList, RecordRow } from "@/components/record-list";
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
import { supabase } from "@/integrations/local/client";
import {
  createTask,
  setTaskProposedCompletion,
  transitionTask,
} from "@/integrations/local/task-commands";
import { formatDateLabel, formatDateTimeLabel, toDateInputValue } from "@/lib/date-utils";
import type { TaskStatus } from "@/server/task-commands.server";

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

const EMPTY_DRAFT = {
  title: "",
  description: "",
  priority: "medium",
  due_at: "",
  proposed_completion_at: "",
};

// A date input yields "YYYY-MM-DD" with no time. Anchoring it at midday
// rather than midnight means the stored instant lands on the intended
// calendar day in every timezone from UTC-11 to UTC+13, instead of silently
// slipping to the day before for anyone west of Greenwich.
function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function TasksPage() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | TaskStatus>("all");
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setTasks((data ?? []) as TaskRecord[]);
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
    () => (tab === "all" ? tasks : tasks.filter((task) => task.status === tab)),
    [tasks, tab],
  );

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
        assigneeId: profile?.id ?? null,
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
          <Button onClick={() => setCreateOpen(true)}>
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
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <CardDescription>Structured filters replace free-text search.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : visibleTasks.length === 0 ? (
            <EmptyState
              icon={<CheckSquare className="h-5 w-5" />}
              title="No tasks in this view"
              description={
                tab === "all"
                  ? "Create a task to start tracking work and get reminders on its proposed completion date."
                  : "Nothing sits in this status right now. Try another tab."
              }
              action={
                tab === "all" ? (
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
                      <span>
                        {task.due_at ? `Due ${formatDateTimeLabel(task.due_at)}` : "No due date"}
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:text-foreground hover:underline"
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
