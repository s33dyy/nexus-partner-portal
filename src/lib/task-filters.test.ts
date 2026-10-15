import { describe, expect, it } from "vitest";

import { filterTasksByView, isTaskOverdue, type TaskFilterRecord } from "./task-filters";

const TASKS: TaskFilterRecord[] = [
  {
    id: "task-1",
    title: "Renew North Star contract",
    description: "Prepare the renewal brief",
    status: "in_progress",
    priority: "high",
    assignee_id: "user-1",
    assignee_name: "Asha",
    creator_id: "user-2",
    creator_name: "Bala",
    due_at: "2026-10-10T12:00:00.000Z",
  },
  {
    id: "task-2",
    title: "Send onboarding notes",
    description: "Share notes with the partner team",
    status: "to_do",
    priority: "medium",
    assignee_id: "user-2",
    assignee_name: "Bala",
    creator_id: "user-1",
    creator_name: "Asha",
    due_at: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "task-3",
    title: "Archive old brief",
    description: "No further action needed",
    status: "completed",
    priority: "low",
    assignee_id: "user-1",
    assignee_name: "Asha",
    creator_id: "user-1",
    creator_name: "Asha",
    due_at: "2026-10-01T12:00:00.000Z",
  },
];

describe("task filters", () => {
  it("combines text, exact options, and an inclusive due-date range", () => {
    expect(
      filterTasksByView(TASKS, {
        advanced: {
          text: "renewal",
          status: "in_progress",
          priority: "high",
          assigneeId: "user-1",
          creatorId: "user-2",
          dueDateFrom: "2026-10-10",
          dueDateTo: "2026-10-10",
        },
      }).map((task) => task.id),
    ).toEqual(["task-1"]);
  });

  it("applies the existing tab status after the scoped task set", () => {
    expect(filterTasksByView(TASKS, { status: "to_do" }).map((task) => task.id)).toEqual([
      "task-2",
    ]);
  });

  it("marks only unfinished tasks with a past due date as overdue", () => {
    const now = new Date("2026-10-15T12:00:00.000Z");

    expect(isTaskOverdue(TASKS[0], now)).toBe(true);
    expect(isTaskOverdue(TASKS[2], now)).toBe(false);
    expect(
      filterTasksByView(TASKS, { advanced: { overdueOnly: true }, now }).map((task) => task.id),
    ).toEqual(["task-1"]);
  });
});
