import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type {
  CompleteLessonInput,
  EnrollInTrackInput,
  SubmitAssessmentInput,
} from "@livey/shared/types/learning-commands";

import { apiFetch } from "./api-client";

export async function enrollInTrack(input: EnrollInTrackInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/learning-commands/enroll-in-track", input);
}

export async function submitAssessmentAttempt(
  input: SubmitAssessmentInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/learning-commands/submit-assessment-attempt", input);
}

export async function completeLesson(input: CompleteLessonInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/learning-commands/complete-lesson", input);
}
