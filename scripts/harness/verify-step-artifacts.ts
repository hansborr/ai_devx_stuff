// Named build artifacts a verify slot can produce or require, and the
// generation-time closure validation that keeps those edges honest.
//
// The one real ordering relationship in the gate — typecheck writes
// packages/{shared,server}/dist, which lint and ratchet read — used to live
// only as hand-coded Bash in scripts/verify/steps-lib.sh. It is declared data
// now: a slot names an artifact id, this module owns the id vocabulary and its
// binding to a hand-written shell probe, and the generator emits both into
// scripts/verify/steps.generated.sh for the parallel runner to consume
// generically. Artifacts are deliberately *not* slot-to-slot edges: a requiring
// slot waits only while its artifact's probe reports the artifact missing.

import { compareByCodepoint } from "../lib/codepoint-compare.js";

/**
 * Artifact ids bind to hand-written shell probes exactly the way dynamic
 * resolver ids bind to hand-written resolver functions
 * (VERIFY_STEP_DYNAMIC_RESOLVER_BINDINGS): the manifest names the id, this
 * table owns the shell function, and the generator emits the id-to-function map
 * the runner reads. A probe takes the repo root and returns 0 when the artifact
 * is already present.
 *
 * `summary` is the artifact's human name, substituted into the runner's
 * deferral diagnostics. It is log prose only — nothing schedules on it — and it
 * exists so those per-slot messages stay readable once the scheduler stops
 * hard-coding one artifact.
 */
const VERIFY_STEP_ARTIFACT_BINDINGS = [
  {
    id: "dist-outputs",
    probeFunctionName: "musi_lint_dist_outputs_present",
    summary: "required dist outputs",
  },
] as const;

type VerifyStepArtifact = (typeof VERIFY_STEP_ARTIFACT_BINDINGS)[number]["id"];

const VERIFY_STEP_ARTIFACTS: readonly VerifyStepArtifact[] = VERIFY_STEP_ARTIFACT_BINDINGS.map(
  (binding) => binding.id,
);

const verifyStepArtifactSet: ReadonlySet<string> = new Set(VERIFY_STEP_ARTIFACTS);

/**
 * Artifact edges describe the slot, not one of its command forms: lint needs
 * the dist outputs whether it runs whole-tree or changed-only. The catalog
 * entry therefore owns them, and a `full` / `changed` / override body that
 * restates one is rejected, so a replacement command can never silently drop
 * its slot out of the scheduler's deferral set.
 */
export const VERIFY_STEP_ARTIFACT_SLOT_KEYS = ["produces", "requiresArtifact"] as const;

export interface VerifyStepSlotArtifacts {
  readonly produces?: VerifyStepArtifact;
  readonly requiresArtifact?: VerifyStepArtifact;
}

function isVerifyStepArtifact(value: unknown): value is VerifyStepArtifact {
  return typeof value === "string" && verifyStepArtifactSet.has(value);
}

/**
 * Shared by every slot parse, so authored catalog entries, gate profile
 * overrides, and legacy materialized slot arrays accept exactly the same
 * artifact vocabulary.
 */
export function parseVerifyStepSlotArtifacts(
  rawSlot: Record<string, unknown>,
  slotName: string,
  failures: string[],
  contextPrefix: string,
): VerifyStepSlotArtifacts {
  const slotPrefix = `${contextPrefix}slot ${slotName}`;
  const artifacts: Record<string, VerifyStepArtifact> = {};
  for (const field of VERIFY_STEP_ARTIFACT_SLOT_KEYS) {
    const rawValue = rawSlot[field];
    if (rawValue === undefined) continue;
    if (!isVerifyStepArtifact(rawValue)) {
      failures.push(`${slotPrefix} ${field} must be one of: ${VERIFY_STEP_ARTIFACTS.join(", ")}`);
      continue;
    }
    artifacts[field] = rawValue;
  }
  // A slot that waits for what it builds can never be released, so reject the
  // self-edge here instead of letting the scheduler stall on it.
  if (artifacts.produces !== undefined && artifacts.produces === artifacts.requiresArtifact) {
    failures.push(`${slotPrefix} must not require the artifact it produces: ${artifacts.produces}`);
    return {};
  }
  return artifacts;
}

interface VerifyArtifactBinding {
  readonly id: string;
  readonly probeFunctionName: string;
  readonly summary: string;
}

/** Structural view of one consumer's resolved slot program. */
export interface VerifyArtifactProgram {
  readonly id: string;
  readonly slots: readonly {
    readonly name: string;
    readonly produces?: string;
    readonly requiresArtifact?: string;
    readonly fastCommitSkip?: boolean;
  }[];
}

const SHELL_FUNCTION_PATTERN = /^[A-Za-z_]\w*$/u;

function slotArtifactFailures(
  programId: string,
  slot: VerifyArtifactProgram["slots"][number],
  produced: ReadonlySet<string>,
  bound: ReadonlyMap<string, VerifyArtifactBinding>,
): readonly string[] {
  const failures: string[] = [];
  for (const artifact of [slot.produces, slot.requiresArtifact]) {
    if (artifact === undefined) continue;
    const binding = bound.get(artifact);
    if (binding === undefined) {
      failures.push(
        `${programId} slot ${slot.name} names artifact ${artifact}, which has no probe binding in verify-step-artifacts.ts`,
      );
      continue;
    }
    if (!SHELL_FUNCTION_PATTERN.test(binding.probeFunctionName)) {
      failures.push(
        `artifact ${artifact} binds an invalid shell probe function: ${binding.probeFunctionName}`,
      );
    }
  }
  // One conditional hop is the whole model. The runner releases deferred slots
  // one artifact group at a time against the producer's recorded PID, so a slot
  // that produces one artifact while waiting for another resolves — or falsely
  // fails its waiters — purely on manifest slot order.
  if (slot.produces !== undefined && slot.requiresArtifact !== undefined) {
    failures.push(
      `${programId} slot ${slot.name} produces ${slot.produces} and requires ${slot.requiresArtifact}; artifact edges are a single conditional hop, never a chain`,
    );
    return failures;
  }
  if (slot.requiresArtifact !== undefined && !produced.has(slot.requiresArtifact)) {
    failures.push(
      `${programId} slot ${slot.name} requires artifact ${slot.requiresArtifact}, but no slot in ${programId} produces it`,
    );
  }
  return failures;
}

/**
 * A fast-commit run resolves a fastCommitSkip slot to the skip status, so it is
 * never admitted and never gets a PID: at runtime its waiters take the "no
 * producing slot" arm and fail. The manifest declares both halves, so the
 * contradiction belongs at generation time rather than in a gate log.
 */
function skippedProducerFailures(program: VerifyArtifactProgram): readonly string[] {
  const required = new Set<string>();
  for (const slot of program.slots) {
    if (slot.requiresArtifact !== undefined) required.add(slot.requiresArtifact);
  }
  const failures: string[] = [];
  for (const slot of program.slots) {
    if (slot.fastCommitSkip !== true || slot.produces === undefined) continue;
    if (!required.has(slot.produces)) continue;
    failures.push(
      `${program.id} slot ${slot.name} produces ${slot.produces} but declares fastCommitSkip, so a fast-commit run leaves the slots requiring ${slot.produces} with no producer`,
    );
  }
  return failures;
}

/**
 * Closure validation for artifact edges — the piece that turns "looks fully
 * registered but silently races its producer in parallel runs" into a
 * generation-time failure. A requiring slot whose producer is absent from the
 * same program would simply run too early, and nothing downstream would notice.
 *
 * The vocabulary is a parameter, not a closed-over constant, because three of
 * the arms below guard edits to the binding table itself: an id declared with
 * no probe, a probe name that is not a shell identifier (it is emitted into
 * generated shell), and a chain across two artifacts. Manifest input can reach
 * none of them while the table has one entry — parseVerifyStepSlotArtifacts
 * only admits ids the table defines and already rejects the self-edge — so
 * passing the vocabulary in is what keeps those three guards tested instead of
 * dead. Production has exactly one caller and always takes the default.
 */
export function collectVerifyArtifactFailures(
  programs: readonly VerifyArtifactProgram[],
  bindings: readonly VerifyArtifactBinding[] = VERIFY_STEP_ARTIFACT_BINDINGS,
): readonly string[] {
  const failures: string[] = [];
  const bound = new Map(bindings.map((binding) => [binding.id, binding] as const));
  const producerNames = new Map<string, Set<string>>();

  for (const program of programs) {
    const produced = new Set<string>();
    for (const slot of program.slots) {
      if (slot.produces === undefined) continue;
      produced.add(slot.produces);
      producerNames.set(
        slot.produces,
        (producerNames.get(slot.produces) ?? new Set<string>()).add(slot.name),
      );
    }
    for (const slot of program.slots) {
      failures.push(...slotArtifactFailures(program.id, slot, produced, bound));
    }
    failures.push(...skippedProducerFailures(program));
  }

  // One producing slot name per artifact across every program: the runner names
  // that slot in its deferral diagnostics, and two producers would also make
  // "wait for the producer" ambiguous inside a single program.
  for (const [artifact, names] of producerNames) {
    if (names.size === 1) continue;
    failures.push(
      `artifact ${artifact} is produced by more than one slot: ${[...names].sort(compareByCodepoint).join(", ")}`,
    );
  }
  return failures;
}

/**
 * Probe/summary assignments for the artifacts these programs actually name, in
 * binding-table order. Only referenced artifacts are emitted: a probe function
 * lives in a hand-written shell library the runner has to have sourced, so
 * advertising an unreferenced binding would promise a function an adopter never
 * copied.
 */
export function renderVerifyArtifactBindings(
  programs: readonly VerifyArtifactProgram[],
  quote: (value: string) => string,
): readonly string[] {
  const referenced = new Set<string>();
  for (const program of programs) {
    for (const slot of program.slots) {
      for (const artifact of [slot.produces, slot.requiresArtifact]) {
        if (artifact !== undefined) referenced.add(artifact);
      }
    }
  }
  return VERIFY_STEP_ARTIFACT_BINDINGS.filter((binding) => referenced.has(binding.id)).flatMap(
    (binding) => [
      `MUSI_VERIFY_ARTIFACT_PROBE_FUNC[${quote(binding.id)}]=${quote(binding.probeFunctionName)}`,
      `MUSI_VERIFY_ARTIFACT_SUMMARY[${quote(binding.id)}]=${quote(binding.summary)}`,
    ],
  );
}
