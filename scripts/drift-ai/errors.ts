export class DriftAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriftAiError";
  }
}
