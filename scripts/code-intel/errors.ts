export class CodeIntelError extends Error {
  constructor(message: string) {
    super(`code:intel: ${message}`);
    this.name = "CodeIntelError";
  }
}
