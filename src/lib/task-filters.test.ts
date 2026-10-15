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

  it("compares date-only ranges by the date encoded in the task value", () => {
    const taskWithPositiveOffset: TaskFilterRecord = {
      ...TASKS[0],
      id: "task-positive-offset",
      due_at: "2026-10-10T12:00:00+14:00",
    };

    expect(
      filterTasksByView([taskWithPositiveOffset], {
        advanced: { dueDateFrom: "2026-10-10", dueDateTo: "2026-10-10" },
      }).map((task) => task.id),
    ).toEqual(["task-positive-offset"]);
  });

  it("applies the existing tab status after the scoped task set", () => {
    expect(filterTasksByView(TASKS, { status: "to_do" }).map((task) => task.id)).toEqual([
      "task-2",
    ]);
  });

  it("starts a date-only task overdue after its calendar day ends", () => {
    const dateOnlyTask = { ...TASKS[0], due_at: "2026-10-15" };

    expect(isTaskOverdue(dateOnlyTask, new Date("2026-10-15T23:59:59.999Z"))).toBe(false);
    expect(isTaskOverdue(dateOnlyTask, new Date("2026-10-16T00:00:00.000Z"))).toBe(true);
    expect(isTaskOverdue(TASKS[2], new Date("2026-10-15T12:00:00.000Z"))).toBe(false);
    expect(
      filterTasksByView([dateOnlyTask], {
        advanced: { overdueOnly: true },
        now: new Date("2026-10-16T00:00:00.000Z"),
      }).map((task) => task.id),
    ).toEqual(["task-1"]);
  });
});
