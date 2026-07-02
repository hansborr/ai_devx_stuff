import type {
  LintRatchetConfig,
  LintRatchetParserProfile,
  LintRatchetRuleSource,
} from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";

export function ratchetSource(ratchet: LintRatchetConfig): LintRatchetRuleSource {
  return ratchet.source ?? { kind: "local" };
}

export function ratchetParserProfile(ratchet: LintRatchetConfig): LintRatchetParserProfile {
  return ratchet.parserProfile ?? "minimal-ts";
}

export function isReportOnlyRatchet(ratchet: LintRatchetConfig): boolean {
  return ratchet.mode === "report-only";
}

export function baselineRatchets(
  ratchets: readonly LintRatchetConfig[],
): readonly LintRatchetConfig[] {
  return ratchets.filter((ratchet) => !isReportOnlyRatchet(ratchet));
}

export function assertNever(value: never): never {
  throw new ConfigError(`unhandled lint ratchet source kind: ${JSON.stringify(value)}`);
}
