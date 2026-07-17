import type { CallExpression } from "ts-morph";

export type CliArgs = { mode: "check" } | { mode: "all" } | { mode: "single"; file: string };
type Verdict = "ERROR" | "WARN";

export type Finding = {
  category: string;
  file: string;
  line: number;
  message: string;
  suggestion: string;
  target: string;
  verdict: Verdict;
};

export type DelegateCall = {
  call: CallExpression;
  delegate: string;
  method: string;
};

export type PatternAConfig = {
  delegate: string;
  rowKey: string;
  checkedFunctions: Set<string>;
};

export type PatternBConfig = {
  delegate: string;
  countersByFunction: Map<string, string>;
};

export type EncounterShape = {
  fields: string[];
};

export type NonCasHelperShape = {
  dataFields?: string[];
  dataPropertyRequired?: boolean;
  delegate: string;
  functionName: string;
  method: string;
  updateFields?: string[];
  upsertCreateFields?: string[];
  whereFields: string[];
};

export type HandledHelperMutator = "handled-helper-mutator";
export type PatternClassification = Finding | HandledHelperMutator | undefined;

export type ConcurrencyGuardCodemodArgs = string[];
