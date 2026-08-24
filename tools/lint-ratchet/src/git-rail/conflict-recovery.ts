import type { LintRatchetWorkflowVocabulary } from "../kernel/engine-context.js";

export function renderLintRatchetConflictRecovery(
  path: string,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
): string {
  return `lint-ratchet baseline conflict: ${path} is generated, so do not hand-merge it.
Git kept the 'ours' side in the working tree so the JSON stays parseable.
That is the current branch during git merge and git cherry-pick.
During git rebase the sides are swapped: the kept version is the upstream
base, not the branch being rebased.

Resolve every other (non-baseline) conflict first, then run:
  ${workflowVocabulary.updateCommand}

Then inspect the baseline diff against both sides:
  git diff HEAD -- ${path}
  git diff MERGE_HEAD -- ${path}

MERGE_HEAD exists only during git merge; use REBASE_HEAD during a rebase or
CHERRY_PICK_HEAD during a cherry-pick.

If the other side had lower floors, preserve them before adding the baseline
or explicitly accept the regression in the merge review.

Then run:
  git add ${path}

If update asks for --allow-worse, the merged code regressed past the kept floor.
Fix the findings, or accept the debt with:
  ${workflowVocabulary.regressionUpdateCommand}`;
}
