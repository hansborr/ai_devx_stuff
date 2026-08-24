// Deliberate source-fingerprint tamper tripwire.
//
// Every other harness check compares data to data. This one reads the real
// text of .husky/pre-commit, scripts/lib/verify-engine.sh, and the two
// freshness checkers on purpose, because what it protects is not a value but a
// behavior: that registration admission is actually reached, in the right
// order, before the gate can decide it may skip work. A hook that described
// its own wiring — a generated fragment, an exported contract, a self-report —
// would let the same edit that unwires the gate regenerate its own alibi. The
// text is the evidence precisely because the tampering edit does not control
// it.
//
// The rule this file lives by (docs/ai-harness.md, "Generate What Is Data;
// Fingerprint Only Behavioral Invariants"): anything data-shaped is
// single-sourced instead of matched here — the registration timeout default is
// a shared MUSI_GATE_* constant, and the generated-output projection set is a
// typed descriptor this file compares against the manifest rather than
// restates. What remains is deliberately behavioral, and every fingerprint is
// narrowed to a function name, an assignment, or a call anchor.
//
// Layout is never fingerprinted. Block boundaries are matched structurally
// (`sliceShellBlock`), so `name ()`, `function name`, a brace on its own line,
// an indented `}` or `esac`, and any re-indentation all still find the same
// block; fragments are then matched against `reflowNormalized`, which joins
// line continuations and collapses whitespace runs, so rewrapping a command
// across lines cannot trip a fingerprint either.
//
// Residual sensitivity, deliberate and irreducible: the fragments themselves
// are the hook's literal *tokens* — `snapshot_rc=0`, `return "$snapshot_rc"`,
// `[pre_cache_admission_condition]='musi_precommit_snapshot_fast_mode'`, the
// `*[!0-9]*` / `0*)` case patterns. Renaming a local, requoting a word, or
// respelling a case pattern trips this check even though the hook still
// behaves identically. That is the tripwire, not a defect in it: these tokens
// ARE the behavior being pinned, and the leaf's binding ruling keeps them.
// Narrowing further would mean parsing shell semantically or letting the hook
// describe its own wiring — and a self-described contract is exactly the alibi
// this file exists to deny. When such an edit is genuinely behaviour-preserving,
// update the anchor in the same commit; that edit is the review signal.

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { isObjectLike } from "../lib/records.js";
import {
  VERIFY_STEP_PROJECTION_CHECKER_INPUTS,
  type VerifyStepProjection,
} from "./generate-verify-steps.js";
import type { GeneratedSurfaceRecord } from "./generated-surfaces.js";

export const REGISTRATION_PREFLIGHT_WIRING_REPAIR =
  " Restore the direct registration admission wiring, then run `bun run harness:check`.";

export interface RegistrationPreflightWiringInputs {
  readonly hookSource: string;
  readonly engineSource: string;
  readonly collectorSource: string;
  readonly fixtureClosureSource: string;
  readonly packageScripts: ReadonlyMap<string, string>;
  readonly manifest: unknown;
  readonly generatedSurfaces: readonly GeneratedSurfaceRecord[];
  readonly verifyStepProjections: readonly VerifyStepProjection[];
}

const REGISTRATION_CONTROL_ID = "check/harness-registration-preflight";
const STAGED_SOURCE_NUL_CONTROL_ID = "check/staged-source-nul";
const REGISTRATION_SCRIPT = "harness:registration:check";
const REGISTRATION_SCRIPT_COMMAND = "bun run scripts/harness-registration-check.ts";
const VERIFY_GENERATOR_ID = "check/verify-steps-generator";
/**
 * The descriptor-driven renderer, not the descriptor constant: every owner pass
 * — both freshness checkers and the generator itself — selects its projections
 * through this one function, so a checker that stopped calling it has stopped
 * re-rendering anything, whatever it still imports.
 */
const PROJECTION_RENDERER_ANCHOR = "renderProjectionsFor";
/**
 * The call itself, with the owner it selects for — not the bare identifier. An
 * import and a prose mention of the name are not a consumer, and both checker
 * sources carry the name in a comment as well, so counting occurrences would
 * let the actual call be deleted while the anchor still matched.
 */
function projectionRendererCall(owner: string): string {
  return `${PROJECTION_RENDERER_ANCHOR}("${owner}"`;
}
const REGISTRATION_TIMEOUT_DEFAULT =
  'MUSI_PRECOMMIT_REGISTRATION_TIMEOUT="${MUSI_PRECOMMIT_REGISTRATION_TIMEOUT:-$MUSI_GATE_PRECOMMIT_REGISTRATION_TIMEOUT_DEFAULT}"';

/** `name() {`, `name ()  {`, `function name {`, or the brace on the next line. */
const SNAPSHOT_FUNCTION_OPEN =
  /^[ \t]*(?:function[ \t]+)?musi_precommit_snapshot_fast_mode[ \t]*(?:\([ \t]*\)[ \t]*)?(?:\r?\n[ \t]*)?\{[ \t]*$/mu;
/** A line that is only the closing brace, at any indentation. */
const SHELL_BLOCK_CLOSE = /^[ \t]*\}[ \t]*$/mu;
const REGISTRATION_TIMEOUT_CASE_OPEN =
  /^[ \t]*case[ \t]+"\$MUSI_PRECOMMIT_REGISTRATION_TIMEOUT"[ \t]+in[ \t]*$/mu;
/** A line that is only `esac`, at any indentation. */
const SHELL_CASE_CLOSE = /^[ \t]*esac[ \t]*$/mu;

function failure(message: string): string {
  return `${message}.${REGISTRATION_PREFLIGHT_WIRING_REPAIR}`;
}

/**
 * Scope a fingerprint to one block without fingerprinting the block's own
 * punctuation. The boundaries are matched as structure — an opening line for
 * this construct, then the first line that is only its terminator — so every
 * layout a shell accepts for the same block yields the same body, and a missing
 * block still yields `""` and fails closed.
 */
function sliceShellBlock(source: string, open: RegExp, close: RegExp): string {
  const opened = open.exec(source);
  if (opened === null) return "";
  const body = source.slice(opened.index + opened[0].length);
  const closed = close.exec(body);
  return closed === null ? "" : body.slice(0, closed.index);
}

/**
 * The view every fragment below is matched against: shell line continuations
 * joined and whitespace runs collapsed. Rewrapping a command across lines or
 * re-indenting it cannot change this view, so only an edit to what the hook
 * runs can trip a fragment.
 */
function reflowNormalized(source: string): string {
  return source.replace(/\\\r?\n/gu, " ").replace(/\s+/gu, " ");
}

function manifestControl(manifest: unknown, id: string): Record<string, unknown> | undefined {
  if (!isObjectLike(manifest) || !Array.isArray(manifest.controls)) return undefined;
  for (const entry of manifest.controls) {
    if (isObjectLike(entry) && entry.id === id) return entry;
  }
  return undefined;
}

function checkFastMarkerSelection(source: string): string | undefined {
  const admissionAssignment = "REGISTRATION_ADMISSION_HOOK='musi_precommit_registration_admission'";
  const snapshotFunction = reflowNormalized(
    sliceShellBlock(source, SNAPSHOT_FUNCTION_OPEN, SHELL_BLOCK_CLOSE),
  );
  const normalized = reflowNormalized(source);
  // Name and assignment anchors only: reflowing the hook must not trip this,
  // but rebinding either branch of the snapshot must.
  const snapshotFragments = [
    "$(musi_precommit_fast_marker)",
    "MUSI_FAST_COMMIT_ENABLED_SNAPSHOT=1",
    "FAST_COMMIT_RECORD_PENDING=1",
    "snapshot_rc=0",
    "MUSI_FAST_COMMIT_ENABLED_SNAPSHOT=0",
    "FAST_COMMIT_RECORD_PENDING=0",
    "snapshot_rc=1",
    "musi_warn_generated_surfaces_stale || true",
    'return "$snapshot_rc"',
  ] as const;
  if (
    snapshotFragments.some((fragment) => !snapshotFunction.includes(fragment)) ||
    !normalized.includes('[ "${MUSI_FAST_COMMIT_ENABLED_SNAPSHOT:-0}" -eq 1 ]') ||
    occurrenceCount(normalized, admissionAssignment) !== 1 ||
    !normalized.includes("[pre_cache_admission_condition]='musi_precommit_snapshot_fast_mode'")
  ) {
    return failure(
      "pre-commit does not bind registration admission and provenance to one under-lock fast-mode snapshot",
    );
  }
  return undefined;
}

function checkRegistrationTimeout(source: string): string | undefined {
  const normalized = reflowNormalized(source);
  // Anchored on the case block itself rather than on one reflow-sensitive
  // regex over the whole validation, and on the shared-constant fallback
  // rather than on the literal seconds: the number lives once, in
  // scripts/lib/verify-state-paths.sh. The two rejected case patterns are
  // anchored separately so their spacing around `|` is not pinned.
  const validation = reflowNormalized(
    sliceShellBlock(source, REGISTRATION_TIMEOUT_CASE_OPEN, SHELL_CASE_CLOSE),
  );
  const validationAnchors = [
    "*[!0-9]*",
    "0*)",
    "invalid MUSI_PRECOMMIT_REGISTRATION_TIMEOUT=",
    "expected positive whole seconds without a suffix or leading zero",
    "exit 2",
  ];
  if (
    !normalized.includes(REGISTRATION_TIMEOUT_DEFAULT) ||
    validationAnchors.some((anchor) => !validation.includes(anchor))
  ) {
    return failure("pre-commit does not default and validate MUSI_PRECOMMIT_REGISTRATION_TIMEOUT");
  }
  if (
    !/timeout --foreground --signal=TERM --kill-after=1s "\$\{MUSI_PRECOMMIT_REGISTRATION_TIMEOUT\}s" bun run harness:registration:check/u.test(
      normalized,
    )
  ) {
    return failure(
      "pre-commit does not run the direct registration command with its configured timeout",
    );
  }
  return undefined;
}

function checkHookWiring(source: string, requiresStagedNul: boolean): string | undefined {
  const policyBinding = '[pre_cache_admission_hook]="$REGISTRATION_ADMISSION_HOOK"';
  const timeoutFailure = checkRegistrationTimeout(source);
  if (timeoutFailure !== undefined) return timeoutFailure;
  if (!source.includes(policyBinding)) {
    return failure("pre-commit does not bind the registration admission into the gate policy");
  }
  const unstaged = source.indexOf("musi_changed_gate_fail_if_unstaged");
  const stagedNul = source.indexOf("musi_staged_source_blobs_reject_nul");
  const sourceRelevant = source.indexOf("musi_staged_has_source_relevant_change");
  const timeoutValidation = source.search(REGISTRATION_TIMEOUT_CASE_OPEN);
  const binding = source.indexOf(policyBinding);
  const gate = source.lastIndexOf("musi_verify_run_gate PRECOMMIT_GATE_POLICY");
  const positions = [unstaged, sourceRelevant, timeoutValidation, binding, gate];
  const stagedNulIsInvalid =
    (requiresStagedNul && stagedNul < 0) ||
    (stagedNul >= 0 && !(unstaged < stagedNul && stagedNul < sourceRelevant));
  if (
    positions.some((position) => position < 0) ||
    positions.join(",") !== [...positions].sort((left, right) => left - right).join(",") ||
    stagedNulIsInvalid
  ) {
    return failure(
      "pre-commit registration admission is not ordered after rejection/NUL/source selection and before gate dispatch",
    );
  }
  return undefined;
}

function checkEngineWiring(source: string): string | undefined {
  const admission = source.indexOf('musi_verify_gate_run_pre_cache_admission "$policy_name"');
  const marker = source.indexOf('if [ -f "${policy_ref[marker_path]}" ]');
  const bridge = source.indexOf('if [ -n "${policy_ref[bridge_predicate]:-}" ]');
  if (admission < 0 || marker < 0 || bridge < 0 || !(admission < marker && marker < bridge)) {
    return failure(
      "verify engine admission is not called before native-marker and bridge evaluation",
    );
  }
  return undefined;
}

function checkManifestWiring(inputs: RegistrationPreflightWiringInputs): string | undefined {
  if (inputs.packageScripts.get(REGISTRATION_SCRIPT) !== REGISTRATION_SCRIPT_COMMAND) {
    return failure(
      `package.json ${REGISTRATION_SCRIPT} does not run ${REGISTRATION_SCRIPT_COMMAND}`,
    );
  }
  const control = manifestControl(inputs.manifest, REGISTRATION_CONTROL_ID);
  if (
    control?.source !== "scripts/harness-registration-check.ts" ||
    control.invocation !== `bun run ${REGISTRATION_SCRIPT}`
  ) {
    return failure(`harness.controls.json does not declare ${REGISTRATION_CONTROL_ID} exactly`);
  }
  return undefined;
}

function occurrenceCount(source: string, token: string): number {
  return source.split(token).length - 1;
}

function sortedPaths(paths: readonly string[]): string {
  return [...paths].sort(compareByCodepoint).join(", ");
}

/**
 * Every advertised output must actually be reachable by the pass that writes
 * and checks it. Path-set parity alone would pass a projection whose
 * `checkedBy` names an owner that cannot supply the inputs its renderer needs;
 * the other owner never selects it, so the output would have no writer at all.
 * `renderProjectionsFor` also refuses such a projection at run time, but it can
 * only do so on a run that reaches it — this names the mis-tag up front, with
 * the input that is missing.
 */
function checkProjectionReachability(
  projections: readonly VerifyStepProjection[],
): string | undefined {
  for (const projection of projections) {
    const supplied = VERIFY_STEP_PROJECTION_CHECKER_INPUTS[projection.checkedBy];
    const unsupplied = projection.requires.filter((input) => !supplied.includes(input));
    if (unsupplied.length === 0) continue;
    return failure(
      `the ${projection.outputPath} projection is checkedBy "${projection.checkedBy}", which never supplies ${unsupplied.join(", ")}, so nothing writes or re-checks it`,
    );
  }
  return undefined;
}

/**
 * Exact, two-way parity between the generator's projection descriptor and the
 * manifest's registration of the same outputs — no occurrence counting, so a
 * projection added on one side and forgotten on the other is named rather than
 * merely undercounted. The owner anchors below stay text checks by design:
 * they are what proves each freshness checker still renders through the
 * descriptor instead of having quietly stopped checking anything.
 */
function checkProjectionParity(inputs: RegistrationPreflightWiringInputs): string | undefined {
  const verifyGenerator = inputs.generatedSurfaces.find(
    (record) => record.id === VERIFY_GENERATOR_ID,
  );
  if (verifyGenerator === undefined) {
    return failure(`harness.controls.json does not declare ${VERIFY_GENERATOR_ID}`);
  }
  const declared = sortedPaths(verifyGenerator.outputPaths);
  const projected = sortedPaths(inputs.verifyStepProjections.map((entry) => entry.outputPath));
  if (declared !== projected) {
    return failure(
      `the verify:steps projection descriptor and ${VERIFY_GENERATOR_ID} generatedSurface.outputPaths disagree (descriptor: ${projected}; manifest: ${declared})`,
    );
  }
  const owners = [
    ["collector", inputs.collectorSource],
    ["fixtureClosure", inputs.fixtureClosureSource],
  ] as const;
  for (const [owner, source] of owners) {
    if (!inputs.verifyStepProjections.some((entry) => entry.checkedBy === owner)) continue;
    if (!source.includes(projectionRendererCall(owner))) {
      return failure(
        `the ${owner} freshness checker no longer calls ${projectionRendererCall(owner)}, …)`,
      );
    }
  }
  return undefined;
}

export function checkRegistrationPreflightWiring(
  inputs: RegistrationPreflightWiringInputs,
): readonly string[] {
  const requiresStagedNul =
    manifestControl(inputs.manifest, STAGED_SOURCE_NUL_CONTROL_ID) !== undefined;
  for (const check of [
    checkFastMarkerSelection(inputs.hookSource),
    checkHookWiring(inputs.hookSource, requiresStagedNul),
    checkEngineWiring(inputs.engineSource),
    checkManifestWiring(inputs),
    checkProjectionReachability(inputs.verifyStepProjections),
    checkProjectionParity(inputs),
  ]) {
    if (check !== undefined) return [check];
  }
  return [];
}
