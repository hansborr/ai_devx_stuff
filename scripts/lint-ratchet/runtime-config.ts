import type {
  LintRatchetConfig,
  LintRatchetParserProfile,
  LintRatchetRuleSource,
} from "../lint-ratchet-config.js";
import { ConfigError } from "../lint-ratchet-metrics.js";

export function ratchetSource(ratchet: LintRatchetConfig): LintRatchetRuleSource {
  return ratchet.source ?? { kind: "local" };
}

export function ratchetParserProfile(ratchet: LintRatchetConfig): LintRatchetParserProfile {
  return ratchet.parserProfile ?? "minimal-ts";
}

export function assertNever(value: never): never {
  throw new ConfigError(`unhandled lint ratchet source kind: ${JSON.stringify(value)}`);
}
