import type {
  LintRatchetConfig,
  LintRatchetParserProfile,
  LintRatchetRuleSource,
} from "./config-types.js";
import { ConfigError } from "./metrics.js";

// The single place ratchet source/parser-profile defaults are defined. Hash
// inputs (baseline-hash.ts, rule-source.ts) and execution (eslint-config.ts)
// must default identically — a copier who changed a default in only one place
// (e.g. defaulting adopters to type-aware-ts) would get silent hash-vs-execution
// divergence: the baseline hashing one identity while the runner executes
// another. Keep these canonical; do not re-derive the `??` defaults elsewhere.
export function ratchetSource(ratchet: LintRatchetConfig): LintRatchetRuleSource {
  return ratchet.source ?? { kind: "local" };
}

export function ratchetParserProfile(ratchet: LintRatchetConfig): LintRatchetParserProfile {
  return ratchet.parserProfile ?? "minimal-ts";
}

export function assertNever(value: never): never {
  throw new ConfigError(`unhandled lint ratchet source kind: ${JSON.stringify(value)}`);
}
