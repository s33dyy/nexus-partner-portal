import { expect, test } from "bun:test";

import { validateSequenceSteps, type SequenceStepDraft } from "@/domain/contracts/outreach";
import { swapPreservingSchedule } from "@/components/outreach/sequence-builder";

function step(overrides: Partial<SequenceStepDraft>): SequenceStepDraft {
  return {
    stepType: "email",
    dayOffset: 0,
    subject: "Subject",
    body: "Body",
    taskTitle: "",
    taskPriority: "medium",
    ...overrides,
  };
}

test("reordering keeps each position's day offset, so the result still saves", () => {
  const steps = [
    step({ subject: "First", dayOffset: 0 }),
    step({ subject: "Second", dayOffset: 2 }),
    step({ subject: "Third", dayOffset: 5 }),
  ];

  const moved = swapPreservingSchedule(steps, 1, 0);

  expect(moved.map((s) => s.subject)).toEqual(["Second", "First", "Third"]);
  // The offsets stayed with the SLOTS, not the steps — a naive swap would
  // have produced [2, 0, 5], which validateSequenceSteps rejects outright.
  expect(moved.map((s) => s.dayOffset)).toEqual([0, 2, 5]);
  expect(validateSequenceSteps(moved)).toBeNull();
});

test("a naive swap really would have been rejected — this is what the fix avoids", () => {
  const naive = [
    step({ subject: "Second", dayOffset: 2 }),
    step({ subject: "First", dayOffset: 0 }),
  ];
  expect(validateSequenceSteps(naive)?.index).toBe(1);
});

test("moving down is the mirror of moving up", () => {
  const steps = [step({ subject: "A", dayOffset: 0 }), step({ subject: "B", dayOffset: 3 })];
  expect(swapPreservingSchedule(steps, 0, 1).map((s) => [s.subject, s.dayOffset])).toEqual([
    ["B", 0],
    ["A", 3],
  ]);
});

test("an out-of-range or no-op swap returns the list untouched", () => {
  const steps = [step({ subject: "A" })];
  expect(swapPreservingSchedule(steps, 0, 0)).toBe(steps);
  expect(swapPreservingSchedule(steps, 0, 1)).toBe(steps);
  expect(swapPreservingSchedule(steps, -1, 0)).toBe(steps);
});
