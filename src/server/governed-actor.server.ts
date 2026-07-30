import { makePolicyDenial } from "@/domain/contracts/commands";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";

export type GovernedActor = {
  userId: string;
  assignment: AssignmentRecord;
  activeContext: ActiveContextRecord;
};

export type ResolveGovernedActorInput = {
  userId: string | null;
  assignment: AssignmentRecord | null;
  activeContext: ActiveContextRecord | null;
};

export function resolveGovernedActor(
  input: ResolveGovernedActorInput,
):
  | { ok: true; actor: GovernedActor }
  | { ok: false; failure: ReturnType<typeof makePolicyDenial> } {
  if (!input.userId || !input.assignment || !input.activeContext) {
    return { ok: false, failure: makePolicyDenial(null, "Active context is required") };
  }
  return {
    ok: true,
    actor: {
      userId: input.userId,
      assignment: input.assignment,
      activeContext: input.activeContext,
    },
  };
}
