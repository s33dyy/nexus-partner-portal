export const TASK_STATUSES = ["to_do", "in_progress", "blocked", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  priority?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  assigneeId?: string | null;
  dueAt?: string | null;
  partnerId?: string | null;
};
