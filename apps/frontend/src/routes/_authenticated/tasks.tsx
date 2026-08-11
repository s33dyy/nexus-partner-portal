import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createTask, transitionTask } from "@/integrations/local/task-commands";
import { formatDateTimeLabel } from "@/lib/date-utils";
import type { TaskStatus } from "@livey/shared/types/task-commands";

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

const STATUS_TONE: Record<TaskStatus, "secondary" | "outline" | "destructive" | "default"> = {
  to_do: "outline",
  in_progress: "default",
  blocked: "destructive",
  completed: "secondary",
  cancelled: "destructive",
};

const EMPTY_DRAFT = { title: "", description: "", priority: "medium", due_at: "" };

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
        dueAt: draft.due_at ? new Date(draft.due_at).toISOString() : null,
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <CheckSquare className="h-3.5 w-3.5" /> Work management
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">My Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track work items through to do, in progress, blocked, completed, and cancelled.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create task</DialogTitle>
              <DialogDescription>Add a new work item to your queue.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="task-title">Title</Label>
                <Input
                  id="task-title"
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="task-description">Description</Label>
                <Textarea
                  id="task-description"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Priority</Label>
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
                </div>
                <div>
                  <Label htmlFor="task-due">Due date</Label>
                  <Input
                    id="task-due"
                    type="date"
                    value={draft.due_at}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, due_at: event.target.value }))
                    }
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button disabled={creating} onClick={() => void create()}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create task
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
            <div className="py-16 text-center text-sm text-muted-foreground">
              No tasks in this view.
            </div>
          ) : (
            <div className="divide-y">
              {visibleTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-6 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{task.title}</span>
                      <Badge variant={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                      <Badge variant="outline">{task.priority}</Badge>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                    )}
                    {task.blocked_reason && (
                      <p className="mt-1 text-xs text-destructive">
                        Blocked: {task.blocked_reason}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {task.due_at ? `Due ${formatDateTimeLabel(task.due_at)}` : "No due date"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {busyTaskId === task.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      actionsFor(task)
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={reasonPrompt !== null} onOpenChange={(open) => !open && setReasonPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonPrompt ? `Move to ${STATUS_LABEL[reasonPrompt.toStatus]}` : ""}
            </DialogTitle>
            <DialogDescription>A reason is required for this change.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this changing?"
          />
          <DialogFooter>
            <Button onClick={() => void confirmReasonPrompt()}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
