import { matchesAdvancedFilters, type AdvancedFilterValues } from "@/lib/advanced-filters";

export type TaskFilterRecord = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  assignee_name?: string | null;
  creator_id: string | null;
  creator_name?: string | null;
  due_at: string | null;
};

export type TaskAdvancedFilters = {
  text?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  creatorId?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  overdueOnly?: boolean;
};

export type TaskListFilters = {
  status?: string;
  advanced?: TaskAdvancedFilters;
  now?: Date;
};

const TERMINAL_TASK_STATUSES = new Set(["completed", "cancelled"]);

export function isTaskOverdue(task: Pick<TaskFilterRecord, "status" | "due_at">, now = new Date()) {
  if (!task.due_at || TERMINAL_TASK_STATUSES.has(task.status)) return false;
  const dueAt = Date.parse(task.due_at);
  return Number.isFinite(dueAt) && dueAt < now.getTime();
}

export function filterTasksByView<T extends TaskFilterRecord>(
  tasks: T[],
  filters: TaskListFilters,
) {
  const advanced = filters.advanced;
  const now = filters.now ?? new Date();
  const advancedFilters: AdvancedFilterValues = {
    text: advanced?.text,
    status: advanced?.status,
    priority: advanced?.priority,
    assignee: advanced?.assigneeId,
    creator: advanced?.creatorId,
    dueDateFrom: advanced?.dueDateFrom,
    dueDateTo: advanced?.dueDateTo,
    overdue: advanced?.overdueOnly ? true : undefined,
  };

  return tasks.filter((task) => {
    if (filters.status && task.status !== filters.status) return false;

    return matchesAdvancedFilters(
      {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee: task.assignee_id,
        creator: task.creator_id,
        dueDate: task.due_at,
        overdue: isTaskOverdue(task, now),
      },
      advancedFilters,
      ["title", "description"],
      { dateFields: ["dueDate"] },
    );
  });
}
