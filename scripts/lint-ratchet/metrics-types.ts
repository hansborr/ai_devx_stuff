export class ConfigError extends Error {}

export interface LintRatchetComplexityFunction {
  readonly line: number;
  readonly label: string;
  readonly complexity: number;
}

export interface LintRatchetMetricItem {
  readonly count: number;
  readonly lines?: number;
  readonly maxComplexity?: number;
  readonly perFunction?: readonly LintRatchetComplexityFunction[];
  readonly messagesFingerprint?: string;
}

export interface LintRatchetComplexityMessage {
  readonly message: string;
  readonly line?: number;
  readonly messageId?: string;
}

export interface ComplexityDelta {
  readonly baselineComplexity: number;
  readonly currentComplexity: number;
  readonly line?: number;
  readonly regression: boolean;
}
