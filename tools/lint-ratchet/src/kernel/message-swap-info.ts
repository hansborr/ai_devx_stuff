import type { LintRatchetCurrentItem, LintRatchetInfo } from "./baseline.js";
import type { LintRatchetConfig } from "./config-types.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";

export interface EqualCountMessageSwapContext {
  readonly ratchet: LintRatchetConfig;
  readonly path: string;
  readonly baselineItem: LintRatchetMetricItem | undefined;
  readonly current: LintRatchetCurrentItem;
  readonly baselineCount: number;
}

export function equalCountMessageSwapInfo(
  context: EqualCountMessageSwapContext,
): LintRatchetInfo | undefined {
  if (context.ratchet.metric !== "message-count") return undefined;
  if (context.current.count !== context.baselineCount) return undefined;
  if (context.baselineItem?.messagesFingerprint === undefined) return undefined;
  if (context.current.messagesFingerprint === undefined) return undefined;
  if (context.current.messagesFingerprint === context.baselineItem.messagesFingerprint) {
    return undefined;
  }
  return {
    testId: context.ratchet.id,
    ruleId: context.ratchet.ruleId,
    path: context.path,
    baselineCount: context.baselineCount,
    currentCount: context.current.count,
    reason: "equal-count-message-swap",
  };
}
