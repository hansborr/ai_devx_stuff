const CODE_INTEL_ERROR_PREFIX = "code:intel: ";

export class CodeIntelError extends Error {
  constructor(message: string) {
    const normalizedMessage = message.startsWith(CODE_INTEL_ERROR_PREFIX)
      ? message.slice(CODE_INTEL_ERROR_PREFIX.length)
      : message;
    super(`${CODE_INTEL_ERROR_PREFIX}${normalizedMessage}`);
    this.name = "CodeIntelError";
  }
}
