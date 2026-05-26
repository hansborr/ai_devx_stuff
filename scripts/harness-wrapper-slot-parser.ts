export type VerifyWrapperMode = "full" | "changed" | "parallel";

export interface WrapperSlot {
  readonly name: string;
  readonly script: string;
}

export interface WrapperSlotParseResult {
  readonly slots: readonly WrapperSlot[];
  readonly diagnostics: readonly string[];
}

const BUN_RUN_PATTERN = /\bbun\s+run\s+([^\s")]+)/u;

function extractShellBunRunScript(command: string): string | undefined {
  return command.match(BUN_RUN_PATTERN)?.[1];
}

function extractVerifyModeBody(text: string, mode: VerifyWrapperMode): string | undefined {
  const modeCase = text.match(/^case "\$MODE" in\n([\s\S]*?)^esac/mu)?.[1];
  if (modeCase === undefined) return undefined;
  const selector = mode === "full" ? "\\*" : mode;
  return modeCase.match(new RegExp(`^\\s*${selector}\\)\\n([\\s\\S]*?)^\\s*;;`, "mu"))?.[1];
}

function parseCommandAssignments(text: string): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const match of text.matchAll(/^\s*([A-Z_]+_CMD)=\(([^)]*)\)/gmu)) {
    const variable = match[1];
    const command = match[2];
    if (variable === undefined || command === undefined) continue;
    const script = extractShellBunRunScript(command);
    if (script !== undefined) assignments.set(variable, script);
  }
  return assignments;
}

function parseVerifySteps(text: string, mode: VerifyWrapperMode): Map<string, string> {
  const steps = new Map<string, string>();
  const pattern =
    mode === "full"
      ? /\brun_step\s+([a-z][\w-]*)\s+"\$\{([A-Z_]+_CMD)\[@\]\}"/gu
      : /\bmusi_run_parallel_step\s+"\$META_MODE"\s+"\$LABEL"\s+([a-z][\w-]*)\s+"\$\{([A-Z_]+_CMD)\[@\]\}"/gu;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    const variable = match[2];
    if (name === undefined || variable === undefined) continue;
    steps.set(name, variable);
  }
  return steps;
}

export function parseVerifyWrapperSlots(
  text: string,
  mode: VerifyWrapperMode,
): WrapperSlotParseResult {
  const diagnostics: string[] = [];
  const modeBody = extractVerifyModeBody(text, mode);
  if (modeBody === undefined) {
    return { slots: [], diagnostics: [`could not find verify.sh ${mode} mode block`] };
  }
  const assignments = parseCommandAssignments(modeBody);
  const typecheckScript = text.match(/^\s*TYPECHECK_CMD=\(([^)]*)\)/mu);
  const typecheckCommand = typecheckScript?.[1];
  const parsedTypecheck =
    typecheckCommand === undefined ? undefined : extractShellBunRunScript(typecheckCommand);
  if (parsedTypecheck !== undefined) assignments.set("TYPECHECK_CMD", parsedTypecheck);

  const slots: WrapperSlot[] = [];
  for (const [name, variable] of parseVerifySteps(text, mode)) {
    const script = assignments.get(variable);
    if (script === undefined) {
      diagnostics.push(`slot ${name} uses ${variable}, but no bun-run assignment was found`);
    } else {
      slots.push({ name, script });
    }
  }
  return { slots, diagnostics };
}

export function parsePreCommitSlots(text: string): WrapperSlotParseResult {
  const diagnostics: string[] = [];
  const slots = new Map<string, string>();
  const normalizedText = text.replaceAll(/\\\n\s*/gu, " ");
  for (const match of normalizedText.matchAll(
    /^[^\S\r\n]*musi_run_parallel_step[^\S\r\n]+parallel-precommit[^\S\r\n]+""[^\S\r\n]+([a-z][\w-]*)[^\S\r\n]+(\S[^\r\n]*)$/gmu,
  )) {
    const name = match[1];
    const command = match[2];
    if (name === undefined || command === undefined) continue;
    const script = extractShellBunRunScript(command);
    if (script === undefined) {
      diagnostics.push(`pre-commit slot ${name} does not invoke a bun-run script`);
      continue;
    }
    const priorScript = slots.get(name);
    if (priorScript !== undefined && priorScript !== script) {
      diagnostics.push(`pre-commit slot ${name} invokes both ${priorScript} and ${script}`);
      continue;
    }
    slots.set(name, script);
  }
  return {
    slots: Array.from(slots, ([name, script]) => ({ name, script })),
    diagnostics,
  };
}
