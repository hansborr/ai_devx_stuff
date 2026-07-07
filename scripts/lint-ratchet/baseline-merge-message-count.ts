import type { LintRatchetMetricItem } from "./lint-ratchet-metrics-types.js";

export interface MergeMessageCountSameCountItemResult {
  readonly item: LintRatchetMetricItem;
  readonly postMergeTruthUpRequired: boolean;
}

function messageCountItem(
  count: number,
  messagesFingerprint: string | undefined,
): LintRatchetMetricItem {
  return messagesFingerprint === undefined ? { count } : { count, messagesFingerprint };
}

function deterministicMessagesFingerprint(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left === right) return left;
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left < right ? left : right;
}

export function mergeMessageCountSameCountItem(
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
): MergeMessageCountSameCountItemResult {
  const leftFingerprint = left.messagesFingerprint;
  const rightFingerprint = right.messagesFingerprint;
  return {
    item: messageCountItem(
      left.count,
      deterministicMessagesFingerprint(leftFingerprint, rightFingerprint),
    ),
    postMergeTruthUpRequired: leftFingerprint !== rightFingerprint,
  };
}
